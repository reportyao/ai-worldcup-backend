import {
  buildFailureStructuredOutput,
  computeConsensusSummary,
  computeMatchFeatures,
  FEATURE_VERSION,
  generateStructuredPrediction,
  type AiGatewayMatchContext,
  type AiGatewayModelConfig,
  type ExternalPromptTemplate,
  type HistoricalMatch,
  type MatchContext,
  type StructuredPrediction,
  AUTO_PREDICTION_SCHEDULES,
} from '@ai-worldcup/shared';
import {
  PredictionTaskStatus,
  PredictionTrigger,
  PredictionVersion,
  PrismaClient,
  type AiModel,
  type ModelPersona,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

import { logger } from '../logger.js';
import { QueueName } from '../queues.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

function createConnection(): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

const prisma = new PrismaClient();
let schedulerQueue: Queue | undefined;

const DirectPredictionPayloadSchema = z.object({
  matchId: z.string(),
  version: z.nativeEnum(PredictionVersion),
  /** 触发原因：cron 调度还是人工补偿 */
  trigger: z.nativeEnum(PredictionTrigger).default(PredictionTrigger.CRON),
  /** 人工重跑时允许覆盖既有结果 */
  rerun: z.coerce.boolean().default(false),
});

const SchedulerPayloadSchema = z.object({
  mode: z.literal('SCHEDULE_DUE'),
  windowMinutes: z.coerce.number().int().min(1).max(120).default(10),
});

export const PredictionGeneratorPayloadSchema = z.union([
  DirectPredictionPayloadSchema,
  SchedulerPayloadSchema,
]);

export type PredictionGeneratorPayload = z.infer<
  typeof PredictionGeneratorPayloadSchema
>;

type PredictionTaskResult =
  | { ok: true; mode: 'SCHEDULE_DUE'; enqueued: number }
  | { ok: true; mode: 'GENERATE'; taskId: string; successCount: number; failureCount: number };

export const PREDICTION_SCHEDULES = AUTO_PREDICTION_SCHEDULES.map((schedule) => ({
  version: schedule.version as PredictionVersion,
  targetMs: schedule.targetMs,
})) as Array<{ version: PredictionVersion; targetMs: number }>;

const MANUAL_ONLY_PREDICTION_VERSIONS = new Set<PredictionVersion>([PredictionVersion.T_MINUS_2H]);

function getRuntimeConfig() {
  return {
    timeoutMs: Number(process.env.AI_GATEWAY_TIMEOUT_MS ?? 30_000),
    defaultBaseUrl: process.env.AI_GATEWAY_BASE_URL,
    openaiApiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.AI_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.AI_OPENAI_BASE_URL,
    googleApiKey: process.env.AI_GOOGLE_API_KEY,
    googleBaseUrl: process.env.AI_GOOGLE_BASE_URL,
    anthropicApiKey: process.env.AI_ANTHROPIC_API_KEY,
    anthropicBaseUrl: process.env.AI_ANTHROPIC_BASE_URL,
    allowMock: process.env.AI_ALLOW_MOCK === 'true',
  };
}

function toModelConfig(model: AiModel): AiGatewayModelConfig {
  return {
    id: model.id,
    modelId: model.modelId,
    displayName: model.displayName,
    provider: model.provider,
    persona: model.persona as ModelPersona,
    config: model.config && typeof model.config === 'object' && !Array.isArray(model.config)
      ? (model.config as Record<string, unknown>)
      : null,
  };
}

function toMatchContext(
  match: Awaited<ReturnType<typeof loadMatchContext>>,
  featureSummary?: string | null,
  featureDataQuality?: 'HIGH' | 'MEDIUM' | 'LOW' | null,
): AiGatewayMatchContext {
  return {
    id: match.id,
    competitionName: match.competition.name,
    competitionSeason: match.competition.season,
    competitionPriority: (match.competition as { priority?: string }).priority ?? undefined,
    matchday: match.matchday,
    stage: match.stage,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: {
      code: match.homeTeam.code,
      name: match.homeTeam.name,
      shortName: match.homeTeam.shortName,
      countryCode: match.homeTeam.countryCode,
    },
    awayTeam: {
      code: match.awayTeam.code,
      name: match.awayTeam.name,
      shortName: match.awayTeam.shortName,
      countryCode: match.awayTeam.countryCode,
    },
    featureSummary: featureSummary ?? null,
    featureDataQuality: featureDataQuality ?? null,
  };
}

async function loadMatchContext(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { competition: true, homeTeam: true, awayTeam: true },
  });
  if (!match) throw new Error(`Match not found: ${matchId}`);
  return match;
}

function getSchedulerQueue(): Queue {
  if (!schedulerQueue) {
    schedulerQueue = new Queue(QueueName.PredictionGenerator, { connection: createConnection() });
  }
  return schedulerQueue;
}

async function scheduleDuePredictions(windowMinutes: number): Promise<PredictionTaskResult> {
  const now = new Date();
  const windows = PREDICTION_SCHEDULES;
  let enqueued = 0;
  const queue = getSchedulerQueue();

  for (const schedule of windows) {
    const from = new Date(now.getTime() + schedule.targetMs - windowMinutes * 60 * 1000);
    const to = new Date(now.getTime() + schedule.targetMs + windowMinutes * 60 * 1000);
    const matches = await prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        kickoffAt: { gte: from, lte: to },
        predictionTasks: { none: { version: schedule.version } },
      },
      select: { id: true },
      take: 200,
    });

    for (const match of matches) {
      await queue.add(
        'generate-prediction',
        { matchId: match.id, version: schedule.version, trigger: PredictionTrigger.CRON, rerun: false },
        {
          attempts: 1,
          removeOnComplete: 200,
          removeOnFail: 500,
          jobId: `prediction:${match.id}:${schedule.version}`,
        },
      );
      enqueued += 1;
    }
  }

  logger.info({ enqueued, windowMinutes }, 'scheduled due prediction jobs');
  return { ok: true, mode: 'SCHEDULE_DUE', enqueued };
}

async function loadActivePromptTemplate(): Promise<ExternalPromptTemplate | null> {
  const template = await prisma.promptTemplate.findFirst({
    where: { scene: 'MATCH_PREDICTION', status: 'ACTIVE' },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
  if (!template) return null;
  return { version: template.version, systemPrompt: template.systemPrompt, userPrompt: template.userPrompt };
}

async function persistFailedModelPrediction(taskId: string, model: AiModel, reason: string) {
  const modelConfig = toModelConfig(model);
  await prisma.modelPrediction.upsert({
    where: { predictionTaskId_aiModelId: { predictionTaskId: taskId, aiModelId: model.id } },
    create: {
      predictionTaskId: taskId,
      aiModelId: model.id,
      structuredOutput: buildFailureStructuredOutput(modelConfig, reason),
      rawOutput: null,
      promptVersion: null,
      promptSnapshot: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      isSuccess: false,
      errorMessage: reason.slice(0, 1000),
    },
    update: {
      structuredOutput: buildFailureStructuredOutput(modelConfig, reason),
      rawOutput: null,
      promptVersion: null,
      promptSnapshot: null,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      isSuccess: false,
      errorMessage: reason.slice(0, 1000),
    },
  });
}

async function runSingleModel(taskId: string, model: AiModel, matchContext: AiGatewayMatchContext, version: PredictionVersion, promptTemplate: ExternalPromptTemplate | null) {
  const modelConfig = toModelConfig(model);
  const result = await generateStructuredPrediction(modelConfig, matchContext, version, getRuntimeConfig(), promptTemplate);
  await prisma.modelPrediction.upsert({
    where: { predictionTaskId_aiModelId: { predictionTaskId: taskId, aiModelId: model.id } },
    create: {
      predictionTaskId: taskId,
      aiModelId: model.id,
      structuredOutput: result.structuredOutput,
      rawOutput: result.rawOutput,
      promptVersion: result.prompt.version,
      promptSnapshot: result.prompt.promptSnapshot,
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      isSuccess: true,
      errorMessage: null,
    },
    update: {
      structuredOutput: result.structuredOutput,
      rawOutput: result.rawOutput,
      promptVersion: result.prompt.version,
      promptSnapshot: result.prompt.promptSnapshot,
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      isSuccess: true,
      errorMessage: null,
    },
  });
  return result.structuredOutput;
}

const HISTORY_LIMIT = 30;

async function fetchTeamHistory(teamId: string, beforeDate: Date): Promise<HistoricalMatch[]> {
  return prisma.match.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: 'FINISHED',
      kickoffAt: { lt: beforeDate },
    },
    orderBy: { kickoffAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      kickoffAt: true,
      status: true,
      competitionId: true,
    },
  });
}

async function fetchH2HHistory(homeTeamId: string, awayTeamId: string, beforeDate: Date): Promise<HistoricalMatch[]> {
  return prisma.match.findMany({
    where: {
      OR: [
        { homeTeamId, awayTeamId },
        { homeTeamId: awayTeamId, awayTeamId: homeTeamId },
      ],
      status: 'FINISHED',
      kickoffAt: { lt: beforeDate },
    },
    orderBy: { kickoffAt: 'desc' },
    take: 10,
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      kickoffAt: true,
      status: true,
      competitionId: true,
    },
  });
}

function mapPriority(priority?: string | null): 'P0' | 'P1' | 'P2' | 'P3' {
  if (priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3') return priority;
  return 'P2';
}

async function computeAndPersistFeature(match: Awaited<ReturnType<typeof loadMatchContext>>) {
  const context: MatchContext = {
    matchId: match.id,
    homeTeamId: match.homeTeamId,
    homeTeamName: match.homeTeam.name,
    homeTeamCode: match.homeTeam.code,
    awayTeamId: match.awayTeamId,
    awayTeamName: match.awayTeam.name,
    awayTeamCode: match.awayTeam.code,
    competitionId: match.competitionId,
    competitionName: match.competition.name,
    competitionSeason: match.competition.season,
    competitionPriority: mapPriority((match.competition as { priority?: string | null }).priority),
    kickoffAt: match.kickoffAt,
    stage: match.stage,
    matchday: match.matchday,
  };
  const [homeHistory, awayHistory, h2hHistory] = await Promise.all([
    fetchTeamHistory(match.homeTeamId, match.kickoffAt),
    fetchTeamHistory(match.awayTeamId, match.kickoffAt),
    fetchH2HHistory(match.homeTeamId, match.awayTeamId, match.kickoffAt),
  ]);
  const result = computeMatchFeatures(context, homeHistory, awayHistory, h2hHistory);
  return prisma.matchFeature.upsert({
    where: { matchId_featureVersion: { matchId: match.id, featureVersion: FEATURE_VERSION } },
    create: {
      matchId: match.id,
      featureVersion: FEATURE_VERSION,
      featuresJson: JSON.parse(JSON.stringify(result.features)),
      summaryText: result.summaryText,
      dataQuality: result.dataQuality,
      missingSignals: result.missingSignals,
      computedAt: new Date(),
    },
    update: {
      featuresJson: JSON.parse(JSON.stringify(result.features)),
      summaryText: result.summaryText,
      dataQuality: result.dataQuality,
      missingSignals: result.missingSignals,
      computedAt: new Date(),
    },
  });
}

async function loadOrComputeFeature(match: Awaited<ReturnType<typeof loadMatchContext>>): Promise<{ summaryText: string; dataQuality: string; featureId: string }> {
  const existing = await prisma.matchFeature.findFirst({
    where: { matchId: match.id, featureVersion: FEATURE_VERSION },
    orderBy: { computedAt: 'desc' },
  });
  const feature = existing ?? await computeAndPersistFeature(match);
  if (!feature?.id) throw new Error(`Feature snapshot was not created for match ${match.id}`);
  return {
    summaryText: feature.summaryText ?? '',
    dataQuality: feature.dataQuality,
    featureId: feature.id,
  };
}

async function generatePrediction(payload: z.infer<typeof DirectPredictionPayloadSchema>): Promise<PredictionTaskResult> {
  if (payload.trigger === PredictionTrigger.CRON && MANUAL_ONLY_PREDICTION_VERSIONS.has(payload.version)) {
    throw new Error(`${payload.version} predictions must be triggered manually`);
  }
  const match = await loadMatchContext(payload.matchId);
  const featureData = await loadOrComputeFeature(match);
  const activeModels = await prisma.aiModel.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  if (activeModels.length === 0) throw new Error('No active AI models configured');

  const task = await prisma.predictionTask.upsert({
    where: { matchId_version: { matchId: payload.matchId, version: payload.version } },
    create: {
      matchId: payload.matchId,
      version: payload.version,
      trigger: payload.trigger,
      status: PredictionTaskStatus.RUNNING,
      featureSnapshotId: featureData.featureId,
      modelCount: activeModels.length,
      successCount: 0,
      failureCount: 0,
      consensusLevel: null,
      consensusSummary: undefined,
      errorMessage: null,
      publishedAt: undefined,
    },
    update: {
      trigger: payload.trigger,
      status: PredictionTaskStatus.RUNNING,
      featureSnapshotId: featureData.featureId,
      modelCount: activeModels.length,
      successCount: 0,
      failureCount: 0,
      consensusLevel: null,
      consensusSummary: undefined,
      errorMessage: null,
      publishedAt: payload.rerun ? null : undefined,
    },
  });

  if (payload.rerun) {
    await prisma.modelPrediction.deleteMany({ where: { predictionTaskId: task.id } });
  }

  const matchContext = toMatchContext(
    match,
    featureData.summaryText,
    featureData.dataQuality as 'HIGH' | 'MEDIUM' | 'LOW' | null,
  );
  const promptTemplate = await loadActivePromptTemplate();
  const successfulPredictions: StructuredPrediction[] = [];
  const failures: string[] = [];

  for (const model of activeModels) {
    try {
      const structured = await runSingleModel(task.id, model, matchContext, payload.version, promptTemplate);
      successfulPredictions.push(structured);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${model.displayName}: ${reason}`);
      logger.warn({ taskId: task.id, modelId: model.modelId, error: reason }, 'single model prediction failed');
      await persistFailedModelPrediction(task.id, model, reason);
    }
  }

  const successCount = successfulPredictions.length;
  const failureCount = activeModels.length - successCount;
  const consensus = computeConsensusSummary(successfulPredictions);
  const finalStatus = successCount === 0
    ? PredictionTaskStatus.FAILED
    : failureCount === 0
      ? PredictionTaskStatus.SUCCEEDED
      : PredictionTaskStatus.PARTIAL_SUCCESS;
  const errorMessage = failures.length > 0 ? failures.join('\n').slice(0, 2000) : null;

  const updated = await prisma.predictionTask.update({
    where: { id: task.id },
    data: {
      status: finalStatus,
      modelCount: activeModels.length,
      successCount,
      failureCount,
      consensusLevel: consensus?.level ?? null,
      consensusSummary: consensus ?? undefined,
      errorMessage,
    },
  });

  // Auto-publish only for CRON-triggered tasks; MANUAL triggers require admin review
  if (successCount > 0 && payload.trigger === PredictionTrigger.CRON) {
    await prisma.predictionTask.update({ where: { id: updated.id }, data: { status: PredictionTaskStatus.REVIEWED } });
    await prisma.predictionTask.update({
      where: { id: updated.id },
      data: { status: PredictionTaskStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  logger.info(
    { taskId: task.id, matchId: payload.matchId, version: payload.version, successCount, failureCount },
    'prediction generation completed',
  );
  return { ok: true, mode: 'GENERATE', taskId: task.id, successCount, failureCount };
}

export async function processPredictionGenerator(job: Job<unknown>): Promise<PredictionTaskResult> {
  const payload = PredictionGeneratorPayloadSchema.parse(job.data);
  logger.info({ jobId: job.id, payload }, 'prediction-generator running');
  if ('mode' in payload && payload.mode === 'SCHEDULE_DUE') {
    return scheduleDuePredictions(payload.windowMinutes);
  }
  const directPayload = payload as z.infer<typeof DirectPredictionPayloadSchema>;
  return generatePrediction(directPayload);
}

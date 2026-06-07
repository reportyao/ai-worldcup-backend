/**
 * Lindy AI 预测定时任务
 *
 * 每天北京时间14:00扫描未来24小时未开赛比赛，自动向 Lindy webhook 发送预测请求。
 * 已经成功或正在等待回调的 Lindy 模型不会重复触发。
 */
import {
  MatchStatus,
  PredictionTaskStatus,
  PredictionTrigger,
  PredictionVersion,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '../logger.js';

const prisma = new PrismaClient();

/** Lindy 模型 provider 标识 */
const LINDY_PROVIDER = 'lindy';

/** Lindy 支持的模型映射 */
const LINDY_MODEL_MAP: Record<string, string> = {
  o3: 'lindy-o3',
  gpt5_5: 'lindy-gpt5_5',
  claude: 'lindy-claude',
};

/** 默认模型 */
const LINDY_DEFAULT_MODEL = 'claude';

/** 配置存储 key */
const LINDY_SETTINGS_KEY = 'lindy_prediction_settings';

// ─── Payload Schema ──────────────────────────────────────────────────────────

const LindyPredictionPayloadSchema = z.object({
  mode: z.enum(['SCAN_AND_TRIGGER', 'SINGLE_MATCH']),
  windowMinutes: z.coerce.number().int().min(1).max(60).default(10),
  matchId: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
});

export type LindyPredictionPayload = z.infer<typeof LindyPredictionPayloadSchema>;

// ─── Main Processor ──────────────────────────────────────────────────────────

export async function processLindyPrediction(job: Job): Promise<unknown> {
  const parsed = LindyPredictionPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error({ jobId: job.id, errors: parsed.error.flatten() }, 'lindy-prediction: invalid payload');
    return { success: false, error: 'Invalid payload' };
  }

  const payload = parsed.data;
  logger.info({ jobId: job.id, mode: payload.mode }, 'lindy-prediction: processing');

  if (payload.mode === 'SCAN_AND_TRIGGER') {
    return scanAndTrigger(payload.windowMinutes);
  }

  if (payload.mode === 'SINGLE_MATCH' && payload.matchId) {
    return triggerSingleMatch(payload.matchId, payload.model, payload.prompt);
  }

  return { success: false, error: 'Unknown mode or missing matchId' };
}

// ─── Scan & Trigger ──────────────────────────────────────────────────────────

async function scanAndTrigger(windowMinutes: number) {
  const settings = await getSettings();
  if (!settings.enabled) {
    logger.info('lindy-prediction: disabled, skipping scan');
    return { scanned: 0, triggered: 0, errors: ['Lindy 预测功能未启用'] };
  }

  const now = new Date();
  const from = now;
  const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 获取活跃的 Lindy 模型
  const lindyModels = await prisma.aiModel.findMany({
    where: { provider: LINDY_PROVIDER, isActive: true },
  });

  if (lindyModels.length === 0) {
    logger.warn('lindy-prediction: no active Lindy models found');
    return { scanned: 0, triggered: 0, errors: ['无活跃的 Lindy 模型'] };
  }

  // 查找窗口内的 SCHEDULED 比赛
  const matches = await prisma.match.findMany({
    where: {
      status: MatchStatus.SCHEDULED,
      kickoffAt: { gte: from, lte: to },
    },
    include: { homeTeam: true, awayTeam: true, competition: true },
    take: 200,
  });

  logger.info({ matchCount: matches.length, from: from.toISOString(), to: to.toISOString() }, 'lindy-prediction: scan window');

  const errors: string[] = [];
  let triggered = 0;

  for (const match of matches) {
    // 已成功或正在等待回调的模型不重复触发；失败模型允许下次扫描重试
    const activeLindyPredictionCount = await prisma.modelPrediction.count({
      where: {
        predictionTask: { matchId: match.id, version: PredictionVersion.T_MINUS_7H },
        aiModelId: { in: lindyModels.map(m => m.id) },
        OR: [
          { isSuccess: true },
          { errorMessage: { contains: '等待 Lindy 回调' } },
        ],
      },
    });

    if (activeLindyPredictionCount >= lindyModels.length) {
      continue; // 所有 Lindy 模型已完成或正在等待回调
    }

    try {
      const result = await sendPredictionRequest({
        match,
        settings,
        lindyModels,
        version: PredictionVersion.T_MINUS_7H,
        trigger: PredictionTrigger.CRON,
      });
      if (result.requestsSent > 0) triggered++;
      if (result.errors.length > 0) errors.push(...result.errors);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Match ${match.id}: ${msg}`);
      logger.error({ matchId: match.id, error: msg }, 'lindy-prediction: trigger failed');
    }
  }

  logger.info({ scanned: matches.length, triggered, errorCount: errors.length }, 'lindy-prediction: scan completed');
  return { scanned: matches.length, triggered, errors: errors.slice(0, 20) };
}

// ─── Single Match Trigger ────────────────────────────────────────────────────

async function triggerSingleMatch(matchId: string, model?: string, prompt?: string) {
  const settings = await getSettings();
  if (!settings.enabled) {
    return { success: false, errors: ['Lindy 预测功能未启用'] };
  }

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });
  if (!match) {
    return { success: false, errors: [`比赛不存在: ${matchId}`] };
  }

  const lindyModels = model
    ? await prisma.aiModel.findMany({
        where: { provider: LINDY_PROVIDER, modelId: LINDY_MODEL_MAP[model], isActive: true },
      })
    : await prisma.aiModel.findMany({
        where: { provider: LINDY_PROVIDER, isActive: true },
      });

  if (lindyModels.length === 0) {
    return { success: false, errors: ['无匹配的活跃 Lindy 模型'] };
  }

  const result = await sendPredictionRequest({
    match,
    settings,
    lindyModels,
    version: PredictionVersion.T_MINUS_7H,
    trigger: PredictionTrigger.MANUAL,
    customPrompt: prompt,
  });

  return { success: result.requestsSent > 0, ...result };
}

// ─── Send Request ────────────────────────────────────────────────────────────

interface SendOptions {
  match: {
    id: string;
    homeTeam: { name: string; shortName: string | null };
    awayTeam: { name: string; shortName: string | null };
    competition: { name: string };
  };
  settings: LindySettingsResolved;
  lindyModels: Array<{ id: string; modelId: string; displayName: string }>;
  version: PredictionVersion;
  trigger: PredictionTrigger;
  customPrompt?: string;
}

async function sendPredictionRequest(options: SendOptions) {
  const { match, settings, lindyModels, version, trigger, customPrompt } = options;
  const prompt = customPrompt || settings.defaultPrompt;

  // 确保 PredictionTask 存在
  const task = await prisma.predictionTask.upsert({
    where: { matchId_version: { matchId: match.id, version } },
    create: {
      matchId: match.id,
      version,
      trigger,
      status: PredictionTaskStatus.RUNNING,
      modelCount: 0,
      successCount: 0,
      failureCount: 0,
      errorMessage: null,
    },
    update: {
      trigger,
      status: PredictionTaskStatus.RUNNING,
      errorMessage: null,
      publishedAt: null,
    },
  });

  const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const callbackUrl = `${publicBaseUrl}/api/lindy-prediction/callback`;

  const errors: string[] = [];
  let requestsSent = 0;

  for (const aiModel of lindyModels) {
    // 反查 model key
    const modelKey = Object.entries(LINDY_MODEL_MAP).find(([, v]) => v === aiModel.modelId)?.[0] || LINDY_DEFAULT_MODEL;

    // 创建占位 ModelPrediction
    await prisma.modelPrediction.upsert({
      where: { predictionTaskId_aiModelId: { predictionTaskId: task.id, aiModelId: aiModel.id } },
      create: {
        predictionTaskId: task.id,
        aiModelId: aiModel.id,
        structuredOutput: Prisma.JsonNull,
        rawOutput: null,
        promptVersion: 'lindy-webhook',
        promptSnapshot: prompt,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        isSuccess: false,
        errorMessage: '等待 Lindy 回调...',
        generatedAt: new Date(),
      },
      update: {
        structuredOutput: Prisma.JsonNull,
        rawOutput: null,
        promptVersion: 'lindy-webhook',
        promptSnapshot: prompt,
        isSuccess: false,
        errorMessage: '等待 Lindy 回调...',
        generatedAt: new Date(),
      },
    });

    // 发送请求到 Lindy webhook
    const homeTeamName = match.homeTeam.shortName || match.homeTeam.name;
    const awayTeamName = match.awayTeam.shortName || match.awayTeam.name;

    const payload = {
      home_team: homeTeamName,
      away_team: awayTeamName,
      model: modelKey,
      prompt: `${prompt}\n\n比赛: ${homeTeamName} vs ${awayTeamName}\n赛事: ${match.competition.name}`,
      callbackUrl: `${callbackUrl}?taskId=${task.id}&matchId=${match.id}&aiModelId=${aiModel.id}`,
    };

    try {
      const response = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const errMsg = `${modelKey}: HTTP ${response.status} - ${body.slice(0, 200)}`;
        errors.push(errMsg);
        await markRequestDispatchFailed(task.id, aiModel.id, errMsg);
        logger.warn({ matchId: match.id, model: modelKey, status: response.status }, 'lindy-prediction: request failed');
        continue;
      }

      requestsSent++;
      logger.info({ matchId: match.id, model: modelKey, taskId: task.id }, 'lindy-prediction: request sent');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const errMsg = `${modelKey}: ${msg}`;
      errors.push(errMsg);
      await markRequestDispatchFailed(task.id, aiModel.id, errMsg);
      logger.error({ matchId: match.id, model: modelKey, error: msg }, 'lindy-prediction: request error');
    }
  }

  await updateTaskStats(task.id);

  return { requestsSent, errors };
}

async function markRequestDispatchFailed(taskId: string, aiModelId: string, errorMessage: string): Promise<void> {
  await prisma.modelPrediction.update({
    where: { predictionTaskId_aiModelId: { predictionTaskId: taskId, aiModelId } },
    data: {
      structuredOutput: Prisma.JsonNull,
      rawOutput: null,
      isSuccess: false,
      errorMessage,
      generatedAt: new Date(),
    },
  });
}

async function updateTaskStats(taskId: string): Promise<void> {
  const lindyModels = await prisma.aiModel.findMany({
    where: { provider: LINDY_PROVIDER },
    select: { id: true },
  });
  const lindyModelIds = lindyModels.map(m => m.id);
  const predictions = await prisma.modelPrediction.findMany({
    where: { predictionTaskId: taskId, aiModelId: { in: lindyModelIds } },
  });
  const successCount = predictions.filter(p => p.isSuccess).length;
  const failureCount = predictions.filter(p => !p.isSuccess && !isWaitingForCallback(p.errorMessage)).length;
  const pendingCount = predictions.filter(p => !p.isSuccess && isWaitingForCallback(p.errorMessage)).length;

  const status = pendingCount > 0
    ? PredictionTaskStatus.RUNNING
    : successCount === 0
      ? PredictionTaskStatus.FAILED
      : failureCount === 0
        ? PredictionTaskStatus.SUCCEEDED
        : PredictionTaskStatus.PARTIAL_SUCCESS;

  await prisma.predictionTask.update({
    where: { id: taskId },
    data: {
      modelCount: predictions.length,
      successCount,
      failureCount,
      status,
      errorMessage: failureCount > 0
        ? predictions.filter(p => !p.isSuccess && !isWaitingForCallback(p.errorMessage)).map(p => p.errorMessage).filter(Boolean).join('\n').slice(0, 2000)
        : null,
    },
  });
}

function isWaitingForCallback(errorMessage: string | null): boolean {
  return (errorMessage ?? '').includes('等待 Lindy 回调');
}

// ─── Settings Helper ─────────────────────────────────────────────────────────

interface LindySettingsResolved {
  webhookUrl: string;
  authToken: string;
  defaultPrompt: string;
  enabled: boolean;
}

async function getSettings(): Promise<LindySettingsResolved> {
  const record = await prisma.activityConfig.findUnique({ where: { key: LINDY_SETTINGS_KEY } });
  const config = toJsonRecord(record?.config);
  return {
    webhookUrl: str(config.webhookUrl) || process.env.LINDY_WEBHOOK_URL || 'https://public.lindy.ai/api/v1/webhooks/lindy/95a33b13-3f97-4ae8-9917-1b23975c1046',
    authToken: str(config.authToken) || process.env.LINDY_AUTH_TOKEN || '5a894750d5ddd716c5a855bc88b4b8dfc5ec186c7cf817cecca698e822fded1f',
    defaultPrompt: str(config.defaultPrompt) || process.env.LINDY_DEFAULT_PROMPT || '请综合分析双方近期状态、伤病情况、历史交锋、主客场优势，给出详细预测分析。',
    enabled: config.enabled === true || config.enabled === 'true' || (config.enabled === undefined && true),
  };
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}

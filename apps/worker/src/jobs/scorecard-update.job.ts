import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * T4-04: 模型战绩更新 Worker Job
 *
 * 在复盘完成后触发，更新所有参与模型的战绩统计。
 * 幂等键: scorecard:{matchId}
 */

export const ScorecardUpdatePayloadSchema = z.object({
  matchId: z.string().min(1),
  trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
});

export type ScorecardUpdatePayload = z.infer<typeof ScorecardUpdatePayloadSchema>;

interface PredictionConclusion {
  winLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  likelyScores?: Array<{ home: number; away: number }>;
  goalsRange?: { min: number; max: number };
}

interface StructuredPredictionOutput {
  conclusion?: PredictionConclusion;
}

const prisma = new PrismaClient();

export async function processScorecardUpdate(job: Job<unknown>): Promise<{ ok: true; modelsUpdated: number }> {
  const payload = ScorecardUpdatePayloadSchema.parse(job.data);
  const { matchId } = payload;

  logger.info({ jobId: job.id, matchId }, 'scorecard-update: starting');

  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    select: {
      id: true,
      competitionId: true,
      homeScore: true,
      awayScore: true,
      status: true,
    },
  });

  if (match.status !== 'FINISHED' || match.homeScore == null || match.awayScore == null) {
    logger.warn({ matchId, status: match.status }, 'scorecard-update: match not finished, skipping');
    return { ok: true, modelsUpdated: 0 };
  }

  // 确定实际胜平负
  let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  if (match.homeScore > match.awayScore) {
    actualResult = 'HOME_WIN';
  } else if (match.homeScore < match.awayScore) {
    actualResult = 'AWAY_WIN';
  } else {
    actualResult = 'DRAW';
  }

  // 获取所有成功的模型预测
  const predictions = await prisma.modelPrediction.findMany({
    where: {
      predictionTask: { matchId },
      isSuccess: true,
    },
    include: { aiModel: true, predictionTask: true },
    orderBy: { predictionTask: { version: 'desc' } },
  });

  // 按模型分组，取最新版本
  const modelPredictions = new Map<string, typeof predictions[0]>();
  for (const pred of predictions) {
    if (!modelPredictions.has(pred.aiModelId)) {
      modelPredictions.set(pred.aiModelId, pred);
    }
  }

  let modelsUpdated = 0;

  for (const [aiModelId, prediction] of modelPredictions) {
    const output = prediction.structuredOutput as unknown as StructuredPredictionOutput;
    const conclusion = output?.conclusion;

    const accuracy = evaluateAccuracy(conclusion, match.homeScore, match.awayScore, actualResult);

    // 更新 OVERALL
    await upsertScorecard(aiModelId, 'OVERALL', null, matchId, accuracy);

    // 更新 COMPETITION
    await upsertScorecard(aiModelId, 'COMPETITION', match.competitionId, matchId, accuracy);

    // 更新 RECENT_10
    await updateRecent10(aiModelId, matchId);

    modelsUpdated++;
    logger.info({ aiModelId, accuracy }, 'scorecard-update: model scorecard updated');
  }

  logger.info({ matchId, modelsUpdated }, 'scorecard-update: completed');
  return { ok: true, modelsUpdated };
}

function evaluateAccuracy(
  conclusion: PredictionConclusion | undefined,
  actualHomeScore: number,
  actualAwayScore: number,
  actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
): { winDrawLossCorrect: boolean; scoreExact: boolean; goalRangeHit: boolean } {
  if (!conclusion) {
    return { winDrawLossCorrect: false, scoreExact: false, goalRangeHit: false };
  }

  const winDrawLossCorrect = conclusion.winLossDraw === actualResult;

  const scoreExact = conclusion.likelyScores?.some(
    (s) => s.home === actualHomeScore && s.away === actualAwayScore,
  ) ?? false;

  const totalGoals = actualHomeScore + actualAwayScore;
  const goalRangeHit = conclusion.goalsRange
    ? totalGoals >= conclusion.goalsRange.min && totalGoals <= conclusion.goalsRange.max
    : false;

  return { winDrawLossCorrect, scoreExact, goalRangeHit };
}

async function upsertScorecard(
  aiModelId: string,
  scopeType: string,
  scopeId: string | null,
  matchId: string,
  accuracy: { winDrawLossCorrect: boolean; scoreExact: boolean; goalRangeHit: boolean },
): Promise<void> {
  const existing = await prisma.modelScorecard.findFirst({
    where: { aiModelId, scopeType, scopeId },
  });

  const newTotal = (existing?.totalMatches ?? 0) + 1;
  const newWDLCorrect = (existing?.winDrawLossCorrect ?? 0) + (accuracy.winDrawLossCorrect ? 1 : 0);
  const newScoreExact = (existing?.scoreExact ?? 0) + (accuracy.scoreExact ? 1 : 0);
  const newGoalRangeHit = (existing?.goalRangeHit ?? 0) + (accuracy.goalRangeHit ? 1 : 0);
  const newWinRate = newTotal > 0 ? newWDLCorrect / newTotal : 0;

  const formChar = accuracy.winDrawLossCorrect ? 'W' : 'L';
  const existingForm = existing?.recentForm ?? '';
  const newForm = (existingForm + formChar).slice(-10);

  if (existing) {
    await prisma.modelScorecard.update({
      where: { id: existing.id },
      data: {
        totalMatches: newTotal,
        winDrawLossCorrect: newWDLCorrect,
        scoreExact: newScoreExact,
        goalRangeHit: newGoalRangeHit,
        winRate: newWinRate,
        recentForm: newForm,
        lastMatchId: matchId,
      },
    });
  } else {
    await prisma.modelScorecard.create({
      data: {
        aiModelId,
        scopeType,
        scopeId,
        totalMatches: newTotal,
        winDrawLossCorrect: newWDLCorrect,
        scoreExact: newScoreExact,
        goalRangeHit: newGoalRangeHit,
        winRate: newWinRate,
        recentForm: newForm,
        lastMatchId: matchId,
      },
    });
  }
}

async function updateRecent10(aiModelId: string, matchId: string): Promise<void> {
  const recentPredictions = await prisma.modelPrediction.findMany({
    where: {
      aiModelId,
      isSuccess: true,
      predictionTask: {
        match: { status: 'FINISHED' },
      },
    },
    include: {
      predictionTask: {
        include: { match: true },
      },
    },
    orderBy: { generatedAt: 'desc' },
    take: 10,
  });

  let wdlCorrect = 0;
  let scoreExact = 0;
  let goalRangeHit = 0;
  let form = '';

  for (const pred of recentPredictions) {
    const m = pred.predictionTask.match;
    if (m.homeScore == null || m.awayScore == null) continue;

    let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    if (m.homeScore > m.awayScore) actualResult = 'HOME_WIN';
    else if (m.homeScore < m.awayScore) actualResult = 'AWAY_WIN';
    else actualResult = 'DRAW';

    const output = pred.structuredOutput as unknown as StructuredPredictionOutput;
    const accuracy = evaluateAccuracy(output?.conclusion, m.homeScore, m.awayScore, actualResult);

    if (accuracy.winDrawLossCorrect) wdlCorrect++;
    if (accuracy.scoreExact) scoreExact++;
    if (accuracy.goalRangeHit) goalRangeHit++;
    form += accuracy.winDrawLossCorrect ? 'W' : 'L';
  }

  const totalMatches = recentPredictions.length;
  const winRate = totalMatches > 0 ? wdlCorrect / totalMatches : 0;

  const existing = await prisma.modelScorecard.findFirst({
    where: { aiModelId, scopeType: 'RECENT_10', scopeId: null },
  });

  const data = {
    totalMatches,
    winDrawLossCorrect: wdlCorrect,
    scoreExact,
    goalRangeHit,
    winRate,
    recentForm: form,
    lastMatchId: matchId,
  };

  if (existing) {
    await prisma.modelScorecard.update({ where: { id: existing.id }, data });
  } else {
    await prisma.modelScorecard.create({
      data: { aiModelId, scopeType: 'RECENT_10', scopeId: null, ...data },
    });
  }
}

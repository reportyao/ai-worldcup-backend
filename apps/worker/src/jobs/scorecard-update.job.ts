import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * T4-04: 模型战绩更新 Worker Job
 *
 * 在复盘完成后触发，更新所有参与模型的战绩统计。
 * 5维度命中判定：胜负平、让球胜负平、大小球、比分、半全场
 * anyHit = 5维度中任一命中即计红
 *
 * 幂等键: scorecard:{matchId}
 */

export const ScorecardUpdatePayloadSchema = z.object({
  matchId: z.string().min(1),
  trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
});

export type ScorecardUpdatePayload = z.infer<typeof ScorecardUpdatePayloadSchema>;

interface PredictionConclusion {
  winLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  handicapWinLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  overUnderResult?: 'OVER' | 'UNDER' | 'EQUAL';
  halfFullTime?: string;
  likelyScores?: Array<{ home: number; away: number }>;
  goalsRange?: { min: number; max: number };
}

interface StructuredPredictionOutput {
  conclusion?: PredictionConclusion;
}

interface FiveDimensionAccuracy {
  winDrawLossCorrect: boolean;
  handicapCorrect: boolean;
  overUnderCorrect: boolean;
  scoreExact: boolean;
  halfFullCorrect: boolean;
  goalRangeHit: boolean;
  anyHit: boolean;
}

const prisma = new PrismaClient();

/**
 * 根据让球盘口计算让球后的胜负平结果
 */
function computeHandicapResult(
  homeScore: number,
  awayScore: number,
  handicapLine: number | null,
): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
  if (handicapLine == null) return null;
  const adjustedHome = homeScore + handicapLine;
  if (adjustedHome > awayScore) return 'HOME_WIN';
  if (adjustedHome < awayScore) return 'AWAY_WIN';
  return 'DRAW';
}

/**
 * 根据大小球盘口计算大小球结果
 */
function computeOverUnderResult(
  homeScore: number,
  awayScore: number,
  overUnderLine: number | null,
): 'OVER' | 'UNDER' | 'EQUAL' | null {
  if (overUnderLine == null) return null;
  const totalGoals = homeScore + awayScore;
  if (totalGoals > overUnderLine) return 'OVER';
  if (totalGoals < overUnderLine) return 'UNDER';
  return 'EQUAL';
}

/**
 * 根据半场和全场比分计算半全场结果
 */
function computeHalfFullTime(
  homeHalfScore: number | null,
  awayHalfScore: number | null,
  homeScore: number,
  awayScore: number,
): string | null {
  if (homeHalfScore == null || awayHalfScore == null) return null;
  const halfResult = homeHalfScore > awayHalfScore ? 'HOME' :
    homeHalfScore < awayHalfScore ? 'AWAY' : 'DRAW';
  const fullResult = homeScore > awayScore ? 'HOME' :
    homeScore < awayScore ? 'AWAY' : 'DRAW';
  return `${halfResult}_${fullResult}`;
}

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
      homeHalfScore: true,
      awayHalfScore: true,
      handicapLine: true,
      overUnderLine: true,
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

  // 计算实际让球结果
  const actualHandicapResult = computeHandicapResult(
    match.homeScore, match.awayScore, match.handicapLine,
  );

  // 计算实际大小球结果
  const actualOverUnderResult = computeOverUnderResult(
    match.homeScore, match.awayScore, match.overUnderLine,
  );

  // 计算实际半全场结果
  const actualHalfFullTime = computeHalfFullTime(
    match.homeHalfScore, match.awayHalfScore,
    match.homeScore, match.awayScore,
  );

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

    const accuracy = evaluateAccuracy(
      conclusion, match.homeScore, match.awayScore,
      actualResult, actualHandicapResult, actualOverUnderResult, actualHalfFullTime,
    );

    // 更新 OVERALL
    await upsertScorecard(aiModelId, 'OVERALL', null, matchId, accuracy);

    // 更新 COMPETITION
    await upsertScorecard(aiModelId, 'COMPETITION', match.competitionId, matchId, accuracy);

    // 更新 RECENT_10
    await updateRecent10(aiModelId, matchId);

    modelsUpdated++;
    logger.info({ aiModelId, anyHit: accuracy.anyHit }, 'scorecard-update: model scorecard updated');
  }

  logger.info({ matchId, modelsUpdated }, 'scorecard-update: completed');
  return { ok: true, modelsUpdated };
}

function evaluateAccuracy(
  conclusion: PredictionConclusion | undefined,
  actualHomeScore: number,
  actualAwayScore: number,
  actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
  actualHandicapResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null,
  actualOverUnderResult: 'OVER' | 'UNDER' | 'EQUAL' | null,
  actualHalfFullTime: string | null,
): FiveDimensionAccuracy {
  if (!conclusion) {
    return {
      winDrawLossCorrect: false,
      handicapCorrect: false,
      overUnderCorrect: false,
      scoreExact: false,
      halfFullCorrect: false,
      goalRangeHit: false,
      anyHit: false,
    };
  }

  const winDrawLossCorrect = conclusion.winLossDraw === actualResult;

  const handicapCorrect = actualHandicapResult != null && conclusion.handicapWinLossDraw != null
    ? conclusion.handicapWinLossDraw === actualHandicapResult
    : false;

  const overUnderCorrect = actualOverUnderResult != null && conclusion.overUnderResult != null
    ? conclusion.overUnderResult === actualOverUnderResult
    : false;

  const scoreExact = conclusion.likelyScores?.some(
    (s) => s.home === actualHomeScore && s.away === actualAwayScore,
  ) ?? false;

  const halfFullCorrect = actualHalfFullTime != null && conclusion.halfFullTime != null
    ? conclusion.halfFullTime === actualHalfFullTime
    : false;

  const totalGoals = actualHomeScore + actualAwayScore;
  const goalRangeHit = conclusion.goalsRange
    ? totalGoals >= conclusion.goalsRange.min && totalGoals <= conclusion.goalsRange.max
    : false;

  // 任一命中即为红单
  const anyHit = winDrawLossCorrect || handicapCorrect || overUnderCorrect || scoreExact || halfFullCorrect;

  return { winDrawLossCorrect, handicapCorrect, overUnderCorrect, scoreExact, halfFullCorrect, goalRangeHit, anyHit };
}

async function upsertScorecard(
  aiModelId: string,
  scopeType: string,
  scopeId: string | null,
  matchId: string,
  accuracy: FiveDimensionAccuracy,
): Promise<void> {
  const existing = await prisma.modelScorecard.findFirst({
    where: { aiModelId, scopeType, scopeId },
  });

  const newTotal = (existing?.totalMatches ?? 0) + 1;
  const newWDLCorrect = (existing?.winDrawLossCorrect ?? 0) + (accuracy.winDrawLossCorrect ? 1 : 0);
  const newScoreExact = (existing?.scoreExact ?? 0) + (accuracy.scoreExact ? 1 : 0);
  const newGoalRangeHit = (existing?.goalRangeHit ?? 0) + (accuracy.goalRangeHit ? 1 : 0);
  const newHandicapCorrect = (existing?.handicapCorrect ?? 0) + (accuracy.handicapCorrect ? 1 : 0);
  const newOverUnderCorrect = (existing?.overUnderCorrect ?? 0) + (accuracy.overUnderCorrect ? 1 : 0);
  const newHalfFullCorrect = (existing?.halfFullCorrect ?? 0) + (accuracy.halfFullCorrect ? 1 : 0);
  const newAnyHit = (existing?.anyHit ?? 0) + (accuracy.anyHit ? 1 : 0);
  const newHitRate = newTotal > 0 ? newAnyHit / newTotal : 0;
  const newWinRate = newTotal > 0 ? newWDLCorrect / newTotal : 0;

  // recentForm: R=红单(anyHit), M=黑单
  const formChar = accuracy.anyHit ? 'R' : 'M';
  const existingForm = existing?.recentForm ?? '';
  const newForm = (existingForm + formChar).slice(-10);

  const data = {
    totalMatches: newTotal,
    winDrawLossCorrect: newWDLCorrect,
    scoreExact: newScoreExact,
    goalRangeHit: newGoalRangeHit,
    handicapCorrect: newHandicapCorrect,
    overUnderCorrect: newOverUnderCorrect,
    halfFullCorrect: newHalfFullCorrect,
    anyHit: newAnyHit,
    hitRate: newHitRate,
    winRate: newWinRate,
    recentForm: newForm,
    lastMatchId: matchId,
  };

  if (existing) {
    await prisma.modelScorecard.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await prisma.modelScorecard.create({
      data: { aiModelId, scopeType, scopeId, ...data },
    });
  }
}

async function updateRecent10(aiModelId: string, matchId: string): Promise<void> {
  // 获取该模型最近10场已完成比赛的预测
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
  let handicapCorrect = 0;
  let overUnderCorrect = 0;
  let halfFullCorrect = 0;
  let anyHitCount = 0;
  let form = '';

  for (const pred of recentPredictions) {
    const m = pred.predictionTask.match;
    if (m.homeScore == null || m.awayScore == null) continue;

    let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    if (m.homeScore > m.awayScore) actualResult = 'HOME_WIN';
    else if (m.homeScore < m.awayScore) actualResult = 'AWAY_WIN';
    else actualResult = 'DRAW';

    const actualHandicap = computeHandicapResult(m.homeScore, m.awayScore, m.handicapLine);
    const actualOU = computeOverUnderResult(m.homeScore, m.awayScore, m.overUnderLine);
    const actualHF = computeHalfFullTime(m.homeHalfScore, m.awayHalfScore, m.homeScore, m.awayScore);

    const output = pred.structuredOutput as unknown as StructuredPredictionOutput;
    const accuracy = evaluateAccuracy(
      output?.conclusion, m.homeScore, m.awayScore,
      actualResult, actualHandicap, actualOU, actualHF,
    );

    if (accuracy.winDrawLossCorrect) wdlCorrect++;
    if (accuracy.scoreExact) scoreExact++;
    if (accuracy.goalRangeHit) goalRangeHit++;
    if (accuracy.handicapCorrect) handicapCorrect++;
    if (accuracy.overUnderCorrect) overUnderCorrect++;
    if (accuracy.halfFullCorrect) halfFullCorrect++;
    if (accuracy.anyHit) anyHitCount++;
    form += accuracy.anyHit ? 'R' : 'M';
  }

  const totalMatches = recentPredictions.length;
  const hitRate = totalMatches > 0 ? anyHitCount / totalMatches : 0;
  const winRate = totalMatches > 0 ? wdlCorrect / totalMatches : 0;

  const existing = await prisma.modelScorecard.findFirst({
    where: { aiModelId, scopeType: 'RECENT_10', scopeId: null },
  });

  const data = {
    totalMatches,
    winDrawLossCorrect: wdlCorrect,
    scoreExact,
    goalRangeHit,
    handicapCorrect,
    overUnderCorrect,
    halfFullCorrect,
    anyHit: anyHitCount,
    hitRate,
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

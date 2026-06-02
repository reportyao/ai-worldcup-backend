import { MatchStatus, PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * Sprint A: 模型战绩更新 Worker Job
 *
 * 目标：
 * 1. 只评估 isSuccess=true 的模型预测；失败输出不参与准确率与共识。
 * 2. 将每条 ModelPrediction 的赛后评估结果落库，形成可回测样本。
 * 3. 使用 Brier Score / Log Loss 衡量概率质量，而不仅仅看命中率。
 * 4. 幂等重算 ModelScorecard，避免同一比赛重复触发导致统计重复累加。
 */

export const ScorecardUpdatePayloadSchema = z.object({
  matchId: z.string().min(1).optional(),
  trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
  mode: z.enum(['MATCH', 'SCAN_FINISHED']).default('MATCH'),
  lookbackDays: z.coerce.number().int().positive().max(30).default(7),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type ScorecardUpdatePayload = z.infer<typeof ScorecardUpdatePayloadSchema>;

type MatchOutcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
type OverUnderOutcome = 'OVER' | 'UNDER' | 'EQUAL';

interface ProbabilityTriple {
  home?: number;
  draw?: number;
  away?: number;
}

interface PredictionConclusion {
  winLossDraw?: MatchOutcome;
  handicapWinLossDraw?: MatchOutcome;
  overUnderResult?: OverUnderOutcome;
  halfFullTime?: string;
  likelyScores?: Array<{ home: number; away: number }>;
  goalsRange?: { min: number; max: number };
  winProbability?: ProbabilityTriple;
}

interface StructuredPredictionOutput {
  conclusion?: PredictionConclusion;
}

interface EvaluationResult {
  winDrawLossCorrect: boolean;
  handicapCorrect: boolean;
  overUnderCorrect: boolean;
  scoreExact: boolean;
  halfFullCorrect: boolean;
  goalRangeHit: boolean;
  anyHit: boolean;
  actualOutcome: MatchOutcome;
  brierScore: number | null;
  logLoss: number | null;
  outcomeProbability: number | null;
}

const prisma = new PrismaClient();
const EVALUATION_VERSION = 'sprint-a-v1';
const EPSILON = 1e-15;

function computeActualOutcome(homeScore: number, awayScore: number): MatchOutcome {
  if (homeScore > awayScore) return 'HOME_WIN';
  if (homeScore < awayScore) return 'AWAY_WIN';
  return 'DRAW';
}

function computeHandicapResult(homeScore: number, awayScore: number, handicapLine: number | null): MatchOutcome | null {
  if (handicapLine == null) return null;
  const adjustedHome = homeScore + handicapLine;
  if (adjustedHome > awayScore) return 'HOME_WIN';
  if (adjustedHome < awayScore) return 'AWAY_WIN';
  return 'DRAW';
}

function computeOverUnderResult(homeScore: number, awayScore: number, overUnderLine: number | null): OverUnderOutcome | null {
  if (overUnderLine == null) return null;
  const totalGoals = homeScore + awayScore;
  if (totalGoals > overUnderLine) return 'OVER';
  if (totalGoals < overUnderLine) return 'UNDER';
  return 'EQUAL';
}

function computeHalfFullTime(
  homeHalfScore: number | null,
  awayHalfScore: number | null,
  homeScore: number,
  awayScore: number,
): string | null {
  if (homeHalfScore == null || awayHalfScore == null) return null;
  const halfResult = homeHalfScore > awayHalfScore ? 'HOME' : homeHalfScore < awayHalfScore ? 'AWAY' : 'DRAW';
  const fullResult = homeScore > awayScore ? 'HOME' : homeScore < awayScore ? 'AWAY' : 'DRAW';
  return `${halfResult}_${fullResult}`;
}

function normalizeProbabilities(probability?: ProbabilityTriple): { home: number; draw: number; away: number } | null {
  if (!probability) return null;
  const home = Number(probability.home);
  const draw = Number(probability.draw);
  const away = Number(probability.away);
  if (![home, draw, away].every(Number.isFinite)) return null;
  const clamped = [home, draw, away].map((value) => Math.min(1, Math.max(0, value)));
  const sum = clamped.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return null;
  return { home: clamped[0] / sum, draw: clamped[1] / sum, away: clamped[2] / sum };
}

function probabilityForOutcome(probability: { home: number; draw: number; away: number }, outcome: MatchOutcome): number {
  if (outcome === 'HOME_WIN') return probability.home;
  if (outcome === 'AWAY_WIN') return probability.away;
  return probability.draw;
}

function computeProbabilityScores(conclusion: PredictionConclusion | undefined, actualOutcome: MatchOutcome) {
  const probability = normalizeProbabilities(conclusion?.winProbability);
  if (!probability) return { brierScore: null, logLoss: null, outcomeProbability: null };
  const actual = {
    home: actualOutcome === 'HOME_WIN' ? 1 : 0,
    draw: actualOutcome === 'DRAW' ? 1 : 0,
    away: actualOutcome === 'AWAY_WIN' ? 1 : 0,
  };
  const brierScore = ((probability.home - actual.home) ** 2)
    + ((probability.draw - actual.draw) ** 2)
    + ((probability.away - actual.away) ** 2);
  const outcomeProbability = probabilityForOutcome(probability, actualOutcome);
  const logLoss = -Math.log(Math.min(1 - EPSILON, Math.max(EPSILON, outcomeProbability)));
  return { brierScore, logLoss, outcomeProbability };
}

function evaluateAccuracy(
  conclusion: PredictionConclusion | undefined,
  actualHomeScore: number,
  actualAwayScore: number,
  actualResult: MatchOutcome,
  actualHandicapResult: MatchOutcome | null,
  actualOverUnderResult: OverUnderOutcome | null,
  actualHalfFullTime: string | null,
): EvaluationResult {
  const winDrawLossCorrect = conclusion?.winLossDraw === actualResult;
  const handicapCorrect = actualHandicapResult != null && conclusion?.handicapWinLossDraw != null
    ? conclusion.handicapWinLossDraw === actualHandicapResult
    : false;
  const overUnderCorrect = actualOverUnderResult != null && conclusion?.overUnderResult != null
    ? conclusion.overUnderResult === actualOverUnderResult
    : false;
  const scoreExact = conclusion?.likelyScores?.some(
    (score) => score.home === actualHomeScore && score.away === actualAwayScore,
  ) ?? false;
  const halfFullCorrect = actualHalfFullTime != null && conclusion?.halfFullTime != null
    ? conclusion.halfFullTime === actualHalfFullTime
    : false;
  const totalGoals = actualHomeScore + actualAwayScore;
  const goalRangeHit = conclusion?.goalsRange
    ? totalGoals >= conclusion.goalsRange.min && totalGoals <= conclusion.goalsRange.max
    : false;
  const anyHit = winDrawLossCorrect || handicapCorrect || overUnderCorrect || scoreExact || halfFullCorrect || goalRangeHit;
  const probabilityScores = computeProbabilityScores(conclusion, actualResult);

  return {
    winDrawLossCorrect,
    handicapCorrect,
    overUnderCorrect,
    scoreExact,
    halfFullCorrect,
    goalRangeHit,
    anyHit,
    actualOutcome: actualResult,
    ...probabilityScores,
  };
}

export async function processScorecardUpdate(job: Job<unknown>): Promise<{ ok: true; modelsUpdated: number; matchesProcessed: number }> {
  const payload = ScorecardUpdatePayloadSchema.parse(job.data);

  if (payload.mode === 'SCAN_FINISHED') {
    return processFinishedMatchScan(job, payload);
  }

  if (!payload.matchId) throw new Error('scorecard-update MATCH mode requires matchId');
  return evaluateSingleMatch(payload.matchId, payload.trigger, job.id);
}

async function processFinishedMatchScan(
  job: Job<unknown>,
  payload: ScorecardUpdatePayload,
): Promise<{ ok: true; modelsUpdated: number; matchesProcessed: number }> {
  const since = new Date(Date.now() - payload.lookbackDays * 24 * 60 * 60 * 1000);
  const matches = await prisma.match.findMany({
    where: {
      status: MatchStatus.FINISHED,
      kickoffAt: { gte: since },
      homeScore: { not: null },
      awayScore: { not: null },
      predictionTasks: {
        some: {
          predictions: {
            some: {
              isSuccess: true,
              evaluatedAt: null,
            },
          },
        },
      },
    },
    select: { id: true },
    orderBy: { kickoffAt: 'desc' },
    take: payload.limit,
  });

  let modelsUpdated = 0;
  for (const match of matches) {
    const result = await evaluateSingleMatch(match.id, payload.trigger, job.id);
    modelsUpdated += result.modelsUpdated;
  }
  logger.info({ jobId: job.id, matchesProcessed: matches.length, modelsUpdated }, 'scorecard-update: finished-match scan completed');
  return { ok: true, matchesProcessed: matches.length, modelsUpdated };
}

async function evaluateSingleMatch(
  matchId: string,
  trigger: ScorecardUpdatePayload['trigger'],
  jobId?: string,
): Promise<{ ok: true; modelsUpdated: number; matchesProcessed: number }> {
  logger.info({ jobId, matchId, trigger }, 'scorecard-update: starting');

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
    return { ok: true, modelsUpdated: 0, matchesProcessed: 0 };
  }

  const actualResult = computeActualOutcome(match.homeScore, match.awayScore);
  const actualHandicapResult = computeHandicapResult(match.homeScore, match.awayScore, match.handicapLine);
  const actualOverUnderResult = computeOverUnderResult(match.homeScore, match.awayScore, match.overUnderLine);
  const actualHalfFullTime = computeHalfFullTime(
    match.homeHalfScore,
    match.awayHalfScore,
    match.homeScore,
    match.awayScore,
  );

  const predictions = await prisma.modelPrediction.findMany({
    where: {
      predictionTask: { matchId },
      isSuccess: true,
    },
    include: { predictionTask: true },
    orderBy: [
      { predictionTask: { version: 'desc' } },
      { generatedAt: 'desc' },
    ],
  });

  const latestByModel = new Map<string, typeof predictions[number]>();
  for (const prediction of predictions) {
    if (!latestByModel.has(prediction.aiModelId)) latestByModel.set(prediction.aiModelId, prediction);
  }

  for (const prediction of latestByModel.values()) {
    const output = prediction.structuredOutput as unknown as StructuredPredictionOutput;
    const accuracy = evaluateAccuracy(
      output?.conclusion,
      match.homeScore,
      match.awayScore,
      actualResult,
      actualHandicapResult,
      actualOverUnderResult,
      actualHalfFullTime,
    );
    await prisma.modelPrediction.update({
      where: { id: prediction.id },
      data: {
        winDrawLossCorrect: accuracy.winDrawLossCorrect,
        handicapCorrect: accuracy.handicapCorrect,
        overUnderCorrect: accuracy.overUnderCorrect,
        scoreExact: accuracy.scoreExact,
        halfFullCorrect: accuracy.halfFullCorrect,
        goalRangeHit: accuracy.goalRangeHit,
        anyHit: accuracy.anyHit,
        brierScore: accuracy.brierScore,
        logLoss: accuracy.logLoss,
        outcomeProbability: accuracy.outcomeProbability,
        actualOutcome: accuracy.actualOutcome,
        evaluationVersion: EVALUATION_VERSION,
        evaluatedAt: new Date(),
      },
    });
    logger.info(
      { aiModelId: prediction.aiModelId, anyHit: accuracy.anyHit, brierScore: accuracy.brierScore, logLoss: accuracy.logLoss },
      'scorecard-update: model prediction evaluated',
    );
  }

  for (const aiModelId of latestByModel.keys()) {
    await recomputeScorecard(aiModelId, 'OVERALL', null, matchId);
    await recomputeScorecard(aiModelId, 'COMPETITION', match.competitionId, matchId);
    await recomputeRecent10(aiModelId, matchId);
  }

  logger.info({ matchId, modelsUpdated: latestByModel.size }, 'scorecard-update: completed');
  return { ok: true, modelsUpdated: latestByModel.size, matchesProcessed: 1 };
}

type EvaluatedPrediction = Awaited<ReturnType<typeof loadEvaluatedPredictions>>[number];

async function loadEvaluatedPredictions(aiModelId: string, scopeType: string, scopeId: string | null, take?: number) {
  return prisma.modelPrediction.findMany({
    where: {
      aiModelId,
      isSuccess: true,
      evaluatedAt: { not: null },
      predictionTask: {
        match: {
          status: 'FINISHED',
          ...(scopeType === 'COMPETITION' && scopeId ? { competitionId: scopeId } : {}),
        },
      },
    },
    include: { predictionTask: { include: { match: true } } },
    orderBy: { generatedAt: 'desc' },
    ...(take ? { take } : {}),
  });
}

function aggregateEvaluated(predictions: EvaluatedPrediction[]) {
  const totalMatches = predictions.length;
  const winDrawLossCorrect = predictions.filter((prediction) => prediction.winDrawLossCorrect).length;
  const scoreExact = predictions.filter((prediction) => prediction.scoreExact).length;
  const goalRangeHit = predictions.filter((prediction) => prediction.goalRangeHit).length;
  const handicapCorrect = predictions.filter((prediction) => prediction.handicapCorrect).length;
  const overUnderCorrect = predictions.filter((prediction) => prediction.overUnderCorrect).length;
  const halfFullCorrect = predictions.filter((prediction) => prediction.halfFullCorrect).length;
  const anyHit = predictions.filter((prediction) => prediction.anyHit).length;
  const probabilityPredictions = predictions.filter(
    (prediction) => prediction.brierScore != null && prediction.logLoss != null,
  );
  const probabilitySamples = probabilityPredictions.length;
  const brierScoreAvg = probabilitySamples > 0
    ? probabilityPredictions.reduce((sum, prediction) => sum + (prediction.brierScore ?? 0), 0) / probabilitySamples
    : 0;
  const logLossAvg = probabilitySamples > 0
    ? probabilityPredictions.reduce((sum, prediction) => sum + (prediction.logLoss ?? 0), 0) / probabilitySamples
    : 0;
  const recentForm = predictions.slice(0, 10).map((prediction) => (prediction.anyHit ? 'R' : 'M')).join('');
  return {
    totalMatches,
    winDrawLossCorrect,
    scoreExact,
    goalRangeHit,
    handicapCorrect,
    overUnderCorrect,
    halfFullCorrect,
    anyHit,
    hitRate: totalMatches > 0 ? anyHit / totalMatches : 0,
    winRate: totalMatches > 0 ? winDrawLossCorrect / totalMatches : 0,
    brierScoreAvg,
    logLossAvg,
    probabilitySamples,
    recentForm,
  };
}

async function recomputeScorecard(aiModelId: string, scopeType: 'OVERALL' | 'COMPETITION', scopeId: string | null, lastMatchId: string) {
  const predictions = await loadEvaluatedPredictions(aiModelId, scopeType, scopeId);
  const scopeKey = scopeId ?? '';
  const data = { ...aggregateEvaluated(predictions), lastMatchId };
  await prisma.modelScorecard.upsert({
    where: { aiModelId_scopeType_scopeId: { aiModelId, scopeType, scopeId: scopeKey } },
    create: { aiModelId, scopeType, scopeId: scopeKey, ...data },
    update: data,
  });
}

async function recomputeRecent10(aiModelId: string, lastMatchId: string) {
  const predictions = await loadEvaluatedPredictions(aiModelId, 'RECENT_10', null, 10);
  const data = { ...aggregateEvaluated(predictions), lastMatchId };
  await prisma.modelScorecard.upsert({
    where: { aiModelId_scopeType_scopeId: { aiModelId, scopeType: 'RECENT_10', scopeId: '' } },
    create: { aiModelId, scopeType: 'RECENT_10', scopeId: '', ...data },
    update: data,
  });
}

import type { Job } from 'bullmq';
import { PrismaClient, ConsensusLevel } from '@prisma/client';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * T4-01: AI 共识指数计算与观点聚合 Worker Job
 *
 * 在所有模型预测完成（或超时）后触发。
 * 计算共识等级、聚合观点并写入 PredictionTask.consensusLevel 和 consensusSummary。
 *
 * 幂等键: consensus:{predictionTaskId}
 */

export const ConsensusCalculatorPayloadSchema = z.object({
  predictionTaskId: z.string().min(1),
  trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
});

export type ConsensusCalculatorPayload = z.infer<typeof ConsensusCalculatorPayloadSchema>;

interface PredictionConclusion {
  winLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  winProbability?: { home: number; draw: number; away: number };
  goalsRange?: { min: number; max: number; expectation?: number };
  likelyScores?: Array<{ home: number; away: number; weight?: number }>;
}

interface StructuredPredictionOutput {
  modelId?: string;
  modelDisplayName?: string;
  conclusion?: PredictionConclusion;
  strengths?: { home?: string[]; away?: string[] };
  weaknesses?: { home?: string[]; away?: string[] };
  risks?: string[];
  keyVariables?: string[];
  trend?: string;
  matchNature?: string;
}

interface AggregatedProbability {
  home: number;
  draw: number;
  away: number;
}

interface AggregatedGoalsRange {
  avgMin: number;
  avgMax: number;
  avgExpectation: number | null;
}

interface ViewpointCluster {
  direction: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  models: string[];
  avgProbability: number;
  keyArguments: string[];
}

interface ConsensusResult {
  level: ConsensusLevel;
  agreementRate: number;
  majorityResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  majorityCount: number;
  totalModels: number;
  divergencePoints: string[];
  highlight: string;
  aggregatedProbability: AggregatedProbability;
  aggregatedGoalsRange: AggregatedGoalsRange | null;
  viewpointClusters: ViewpointCluster[];
  sharedStrengths: { home: string[]; away: string[] };
  sharedRisks: string[];
  sharedKeyVariables: string[];
}

const prisma = new PrismaClient();

export async function processConsensusCalculator(job: Job<unknown>): Promise<{ ok: true; consensus: ConsensusResult }> {
  const payload = ConsensusCalculatorPayloadSchema.parse(job.data);
  const { predictionTaskId } = payload;

  logger.info({ jobId: job.id, predictionTaskId }, 'consensus-calculator: starting');

  const task = await prisma.predictionTask.findUniqueOrThrow({
    where: { id: predictionTaskId },
    include: {
      predictions: {
        where: { isSuccess: true },
        include: { aiModel: true },
      },
      match: {
        include: { homeTeam: true, awayTeam: true },
      },
    },
  });

  const successfulPredictions = task.predictions;
  const homeTeamName = task.match.homeTeam.shortName ?? task.match.homeTeam.name;
  const awayTeamName = task.match.awayTeam.shortName ?? task.match.awayTeam.name;

  if (successfulPredictions.length === 0) {
    const emptyResult: ConsensusResult = {
      level: ConsensusLevel.STRONG_DIVERGENCE,
      agreementRate: 0,
      majorityResult: 'DRAW',
      majorityCount: 0,
      totalModels: 0,
      divergencePoints: ['暂无模型完成预测'],
      highlight: '暂无模型完成预测',
      aggregatedProbability: { home: 0.33, draw: 0.34, away: 0.33 },
      aggregatedGoalsRange: null,
      viewpointClusters: [],
      sharedStrengths: { home: [], away: [] },
      sharedRisks: [],
      sharedKeyVariables: [],
    };
    await saveConsensus(predictionTaskId, emptyResult);
    logger.info({ predictionTaskId }, 'consensus-calculator: no predictions, saved empty result');
    return { ok: true, consensus: emptyResult };
  }

  // Parse all outputs
  const outputs = successfulPredictions.map((p) => ({
    modelName: p.aiModel.displayName,
    output: p.structuredOutput as unknown as StructuredPredictionOutput,
  }));

  // ─── Vote Counting ──────────────────────────────────────────────────────────
  const votes: Record<string, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const { output } of outputs) {
    const wld = output?.conclusion?.winLossDraw;
    if (wld && wld in votes) votes[wld]++;
  }

  const totalModels = outputs.length;
  const sortedVotes = Object.entries(votes).sort(([, a], [, b]) => b - a);
  const [majorityResult, majorityCount] = sortedVotes[0] as [string, number];
  const agreementRate = totalModels > 0 ? majorityCount / totalModels : 0;

  let level: ConsensusLevel;
  if (agreementRate >= 0.7) level = ConsensusLevel.HIGH;
  else if (agreementRate >= 0.5) level = ConsensusLevel.MIXED;
  else level = ConsensusLevel.STRONG_DIVERGENCE;

  // ─── Aggregated Probability ─────────────────────────────────────────────────
  const probabilities = outputs
    .map((o) => o.output?.conclusion?.winProbability)
    .filter((p): p is { home: number; draw: number; away: number } => !!p);

  const aggregatedProbability: AggregatedProbability = probabilities.length > 0
    ? {
        home: round3(probabilities.reduce((sum, p) => sum + p.home, 0) / probabilities.length),
        draw: round3(probabilities.reduce((sum, p) => sum + p.draw, 0) / probabilities.length),
        away: round3(probabilities.reduce((sum, p) => sum + p.away, 0) / probabilities.length),
      }
    : { home: 0.33, draw: 0.34, away: 0.33 };

  // ─── Aggregated Goals Range ─────────────────────────────────────────────────
  const goalsRanges = outputs
    .map((o) => o.output?.conclusion?.goalsRange)
    .filter((g): g is { min: number; max: number; expectation?: number } => !!g);

  const aggregatedGoalsRange: AggregatedGoalsRange | null = goalsRanges.length > 0
    ? {
        avgMin: round2(goalsRanges.reduce((s, g) => s + g.min, 0) / goalsRanges.length),
        avgMax: round2(goalsRanges.reduce((s, g) => s + g.max, 0) / goalsRanges.length),
        avgExpectation: goalsRanges.some((g) => g.expectation != null)
          ? round2(
              goalsRanges.filter((g) => g.expectation != null).reduce((s, g) => s + g.expectation!, 0) /
                goalsRanges.filter((g) => g.expectation != null).length,
            )
          : null,
      }
    : null;

  // ─── Viewpoint Clusters ─────────────────────────────────────────────────────
  const clusterMap: Record<string, { models: string[]; probabilities: number[]; arguments: string[] }> = {
    HOME_WIN: { models: [], probabilities: [], arguments: [] },
    DRAW: { models: [], probabilities: [], arguments: [] },
    AWAY_WIN: { models: [], probabilities: [], arguments: [] },
  };

  for (const { modelName, output } of outputs) {
    const wld = output?.conclusion?.winLossDraw;
    if (!wld || !(wld in clusterMap)) continue;
    const cluster = clusterMap[wld];
    cluster.models.push(modelName);
    const prob = output.conclusion?.winProbability;
    if (prob) cluster.probabilities.push(prob[wld === 'HOME_WIN' ? 'home' : wld === 'AWAY_WIN' ? 'away' : 'draw']);
    if (output.trend) cluster.arguments.push(output.trend);
    if (output.keyVariables?.length) cluster.arguments.push(...output.keyVariables.slice(0, 2));
  }

  const viewpointClusters: ViewpointCluster[] = (['HOME_WIN', 'DRAW', 'AWAY_WIN'] as const)
    .filter((dir) => clusterMap[dir].models.length > 0)
    .map((dir) => ({
      direction: dir,
      models: clusterMap[dir].models,
      avgProbability: clusterMap[dir].probabilities.length > 0
        ? round3(clusterMap[dir].probabilities.reduce((s, p) => s + p, 0) / clusterMap[dir].probabilities.length)
        : 0,
      keyArguments: deduplicateStrings(clusterMap[dir].arguments).slice(0, 4),
    }));

  // ─── Shared Strengths / Risks / Key Variables ───────────────────────────────
  const allHomeStrengths: string[] = [];
  const allAwayStrengths: string[] = [];
  const allRisks: string[] = [];
  const allKeyVars: string[] = [];

  for (const { output } of outputs) {
    if (output?.strengths?.home) allHomeStrengths.push(...output.strengths.home);
    if (output?.strengths?.away) allAwayStrengths.push(...output.strengths.away);
    if (output?.risks) allRisks.push(...output.risks);
    if (output?.keyVariables) allKeyVars.push(...output.keyVariables);
  }

  const sharedStrengths = {
    home: getFrequentItems(allHomeStrengths, 4),
    away: getFrequentItems(allAwayStrengths, 4),
  };
  const sharedRisks = getFrequentItems(allRisks, 5);
  const sharedKeyVariables = getFrequentItems(allKeyVars, 5);

  // ─── Divergence Points ──────────────────────────────────────────────────────
  const divergencePoints = buildDivergencePoints(votes, goalsRanges, allRisks, homeTeamName, awayTeamName);

  // ─── Highlight ──────────────────────────────────────────────────────────────
  const probPercent = Math.round(
    (majorityResult === 'HOME_WIN'
      ? aggregatedProbability.home
      : majorityResult === 'AWAY_WIN'
        ? aggregatedProbability.away
        : aggregatedProbability.draw) * 100,
  );
  const highlight = buildHighlight(level, majorityResult, majorityCount, totalModels, homeTeamName, awayTeamName, probPercent);

  const result: ConsensusResult = {
    level,
    agreementRate,
    majorityResult: majorityResult as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
    majorityCount,
    totalModels,
    divergencePoints,
    highlight,
    aggregatedProbability,
    aggregatedGoalsRange,
    viewpointClusters,
    sharedStrengths,
    sharedRisks,
    sharedKeyVariables,
  };

  await saveConsensus(predictionTaskId, result);
  logger.info({ predictionTaskId, level, agreementRate, highlight }, 'consensus-calculator: completed');
  return { ok: true, consensus: result };
}

// ─── Persistence ────────────────────────────────────────────────────────────────

async function saveConsensus(predictionTaskId: string, result: ConsensusResult): Promise<void> {
  await prisma.predictionTask.update({
    where: { id: predictionTaskId },
    data: {
      consensusLevel: result.level,
      consensusSummary: JSON.parse(JSON.stringify(result)),
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function buildDivergencePoints(
  votes: Record<string, number>,
  goalsRanges: Array<{ min: number; max: number; expectation?: number }>,
  allRisks: string[],
  homeTeamName: string,
  awayTeamName: string,
): string[] {
  const points: string[] = [];

  const nonZeroVotes = Object.entries(votes).filter(([, count]) => count > 0);
  if (nonZeroVotes.length > 1) {
    const descriptions = nonZeroVotes.map(([result, count]) => {
      const label = resultLabel(result, homeTeamName, awayTeamName);
      return `${count}个模型看${label}`;
    });
    points.push(`胜平负分歧：${descriptions.join('，')}`);
  }

  if (goalsRanges.length >= 2) {
    const mins = goalsRanges.map((r) => r.min);
    const maxs = goalsRanges.map((r) => r.max);
    const minSpread = Math.max(...mins) - Math.min(...mins);
    const maxSpread = Math.max(...maxs) - Math.min(...maxs);
    if (minSpread >= 2 || maxSpread >= 2) {
      points.push('进球预期存在分歧：区间跨度较大');
    }
  }

  const uniqueRisks = [...new Set(allRisks)].slice(0, 3);
  if (uniqueRisks.length > 0) {
    points.push(`关键风险：${uniqueRisks.join('；')}`);
  }

  return points.slice(0, 5);
}

function buildHighlight(
  level: ConsensusLevel,
  majorityResult: string,
  majorityCount: number,
  totalModels: number,
  homeTeamName: string,
  awayTeamName: string,
  probPercent: number,
): string {
  const label = resultLabel(majorityResult, homeTeamName, awayTeamName);

  switch (level) {
    case ConsensusLevel.HIGH:
      return `AI 共识较强：${majorityCount}/${totalModels} 模型看好${label}（综合概率 ${probPercent}%）`;
    case ConsensusLevel.MIXED:
      return `AI 存在分歧：${majorityCount}/${totalModels} 模型倾向${label}（综合概率 ${probPercent}%），但风险不低`;
    case ConsensusLevel.STRONG_DIVERGENCE:
      return `AI 内部分歧明显：各模型观点差异较大，建议重点看风险提示`;
    default:
      return `${majorityCount}/${totalModels} 模型倾向${label}`;
  }
}

function resultLabel(result: string, homeTeamName: string, awayTeamName: string): string {
  switch (result) {
    case 'HOME_WIN': return `${homeTeamName}胜`;
    case 'AWAY_WIN': return `${awayTeamName}胜`;
    case 'DRAW': return '平局';
    default: return result;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function deduplicateStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (!seen.has(normalized) && normalized.length > 0) {
      seen.add(normalized);
      result.push(item.trim());
    }
  }
  return result;
}

function getFrequentItems(items: string[], limit: number): string[] {
  const freq = new Map<string, { original: string; count: number }>();
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (key.length === 0) continue;
    const existing = freq.get(key);
    if (existing) existing.count++;
    else freq.set(key, { original: item.trim(), count: 1 });
  }
  return [...freq.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((v) => v.original);
}

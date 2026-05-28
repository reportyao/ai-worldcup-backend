import type { Job } from 'bullmq';
import { PrismaClient, ConsensusLevel } from '@prisma/client';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * T4-01: AI 共识指数计算 Worker Job
 *
 * 在所有模型预测完成（或超时）后触发。
 * 计算共识等级并写入 PredictionTask.consensusLevel 和 consensusSummary。
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
  goalsRange?: { min: number; max: number };
  likelyScores?: Array<{ home: number; away: number; weight?: number }>;
}

interface StructuredPredictionOutput {
  conclusion?: PredictionConclusion;
  risks?: string[];
  keyVariables?: string[];
}

interface ConsensusResult {
  level: ConsensusLevel;
  agreementRate: number;
  majorityResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  majorityCount: number;
  totalModels: number;
  divergencePoints: string[];
  highlight: string;
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
    };
    await saveConsensus(predictionTaskId, emptyResult);
    logger.info({ predictionTaskId }, 'consensus-calculator: no predictions, saved empty result');
    return { ok: true, consensus: emptyResult };
  }

  // 统计各模型的胜平负结论
  const votes: Record<string, number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  const goalsRanges: Array<{ min: number; max: number; modelName: string }> = [];
  const allRisks: string[] = [];

  for (const prediction of successfulPredictions) {
    const output = prediction.structuredOutput as unknown as StructuredPredictionOutput;
    const conclusion = output?.conclusion;
    if (conclusion?.winLossDraw) {
      votes[conclusion.winLossDraw] = (votes[conclusion.winLossDraw] ?? 0) + 1;
    }
    if (conclusion?.goalsRange) {
      goalsRanges.push({
        min: conclusion.goalsRange.min,
        max: conclusion.goalsRange.max,
        modelName: prediction.aiModel.displayName,
      });
    }
    if (output?.risks && Array.isArray(output.risks)) {
      allRisks.push(...output.risks.slice(0, 2));
    }
  }

  const totalModels = successfulPredictions.length;
  const sortedVotes = Object.entries(votes).sort(([, a], [, b]) => b - a);
  const [majorityResult, majorityCount] = sortedVotes[0] as [string, number];
  const agreementRate = totalModels > 0 ? majorityCount / totalModels : 0;

  // 确定共识等级
  let level: ConsensusLevel;
  if (agreementRate >= 0.7) {
    level = ConsensusLevel.HIGH;
  } else if (agreementRate >= 0.5) {
    level = ConsensusLevel.MIXED;
  } else {
    level = ConsensusLevel.STRONG_DIVERGENCE;
  }

  // 生成分歧点
  const divergencePoints = buildDivergencePoints(votes, goalsRanges, allRisks, homeTeamName, awayTeamName);

  // 生成高亮文本
  const highlight = buildHighlight(level, majorityResult, majorityCount, totalModels, homeTeamName, awayTeamName);

  const result: ConsensusResult = {
    level,
    agreementRate,
    majorityResult: majorityResult as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
    majorityCount,
    totalModels,
    divergencePoints,
    highlight,
  };

  await saveConsensus(predictionTaskId, result);
  logger.info({ predictionTaskId, level, agreementRate, highlight }, 'consensus-calculator: completed');
  return { ok: true, consensus: result };
}

async function saveConsensus(predictionTaskId: string, result: ConsensusResult): Promise<void> {
  await prisma.predictionTask.update({
    where: { id: predictionTaskId },
    data: {
      consensusLevel: result.level,
      consensusSummary: JSON.parse(JSON.stringify(result)),
    },
  });
}

function buildDivergencePoints(
  votes: Record<string, number>,
  goalsRanges: Array<{ min: number; max: number; modelName: string }>,
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
): string {
  const label = resultLabel(majorityResult, homeTeamName, awayTeamName);

  switch (level) {
    case ConsensusLevel.HIGH:
      return `AI 共识较强：${majorityCount}/${totalModels} 模型看好${label}`;
    case ConsensusLevel.MIXED:
      return `AI 存在分歧：${majorityCount}/${totalModels} 模型倾向${label}，但风险不低`;
    case ConsensusLevel.STRONG_DIVERGENCE:
      return `AI 内部分歧明显：建议重点看风险提示`;
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

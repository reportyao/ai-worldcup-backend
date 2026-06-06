import { Injectable } from '@nestjs/common';
import { ConsensusLevel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * T4-01: AI 共识指数计算与观点聚合服务
 *
 * 共识等级规则：
 * - 高共识 (HIGH): 第一选择模型占比 ≥ 70%
 * - 存在分歧 (MIXED): 第一选择占比 50%–69%
 * - 强分歧 (STRONG_DIVERGENCE): 第一选择占比 < 50%
 *
 * 观点聚合：
 * - 汇总各模型的胜负概率取平均
 * - 聚合各模型的优势/劣势/风险/关键变量
 * - 生成结构化的共识摘要供前端展示
 */

export interface AggregatedProbability {
  home: number;
  draw: number;
  away: number;
}

export interface AggregatedGoalsRange {
  avgMin: number;
  avgMax: number;
  avgExpectation: number | null;
}

export interface ViewpointCluster {
  /** 观点方向 */
  direction: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  /** 持该观点的模型列表 */
  models: string[];
  /** 该方向的平均概率；仅当至少一个模型明确给出该方向概率时存在 */
  avgProbability: number | null;
  /** 代表性论据（从 keyVariables 和 trend 中提取） */
  keyArguments: string[];
}

export interface ConsensusResult {
  level: ConsensusLevel;
  agreementRate: number;
  majorityResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  majorityCount: number;
  totalModels: number;
  divergencePoints: string[];
  highlight: string;
  /** 聚合后的平均概率；仅聚合模型明确给出的概率，不做伪造兜底 */
  aggregatedProbability: AggregatedProbability | null;
  /** 聚合后的进球区间 */
  aggregatedGoalsRange: AggregatedGoalsRange | null;
  /** 按方向分组的观点集群 */
  viewpointClusters: ViewpointCluster[];
  /** 所有模型共同提到的优势（去重后取 top） */
  sharedStrengths: { home: string[]; away: string[] };
  /** 所有模型共同提到的风险 */
  sharedRisks: string[];
  /** 所有模型共同提到的关键变量 */
  sharedKeyVariables: string[];
}

interface PredictionConclusion {
  winLossDraw: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  winProbability?: {
    home: number;
    draw: number;
    away: number;
  };
  goalsRange?: {
    min: number;
    max: number;
    expectation?: number;
  };
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

@Injectable()
export class ConsensusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 计算指定预测任务的共识指数并聚合观点。
   */
  async calculateAndSave(predictionTaskId: string): Promise<ConsensusResult> {
    const task = await this.prisma.predictionTask.findUniqueOrThrow({
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
    if (successfulPredictions.length === 0) {
      const emptyResult: ConsensusResult = {
        level: ConsensusLevel.STRONG_DIVERGENCE,
        agreementRate: 0,
        majorityResult: 'DRAW',
        majorityCount: 0,
        totalModels: 0,
        divergencePoints: ['暂无模型完成预测'],
        highlight: '暂无模型完成预测',
        aggregatedProbability: null,
        aggregatedGoalsRange: null,
        viewpointClusters: [],
        sharedStrengths: { home: [], away: [] },
        sharedRisks: [],
        sharedKeyVariables: [],
      };
      await this.saveConsensus(predictionTaskId, emptyResult);
      return emptyResult;
    }

    const homeTeamName = task.match.homeTeam.shortName ?? task.match.homeTeam.name;
    const awayTeamName = task.match.awayTeam.shortName ?? task.match.awayTeam.name;

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
    // Threshold aligned with packages/shared computeConsensusSummary (0.67)
    if (agreementRate >= 0.67) level = ConsensusLevel.HIGH;
    else if (agreementRate >= 0.5) level = ConsensusLevel.MIXED;
    else level = ConsensusLevel.STRONG_DIVERGENCE;

    // ─── Aggregated Probability ─────────────────────────────────────────────────
    const probabilities = outputs
      .map((o) => o.output?.conclusion?.winProbability)
      .filter((p): p is { home: number; draw: number; away: number } => !!p);

    const aggregatedProbability: AggregatedProbability | null = probabilities.length > 0
      ? {
          home: round3(probabilities.reduce((sum, p) => sum + p.home, 0) / probabilities.length),
          draw: round3(probabilities.reduce((sum, p) => sum + p.draw, 0) / probabilities.length),
          away: round3(probabilities.reduce((sum, p) => sum + p.away, 0) / probabilities.length),
        }
      : null;

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
      // Collect key arguments
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
          : null,
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
    const divergencePoints = this.buildDivergencePoints(
      votes,
      goalsRanges,
      allRisks,
      homeTeamName,
      awayTeamName,
    );

    // ─── Highlight ──────────────────────────────────────────────────────────────
    const highlight = this.buildHighlight(
      level,
      majorityResult as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
      majorityCount,
      totalModels,
      homeTeamName,
      awayTeamName,
      aggregatedProbability,
    );

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

    await this.saveConsensus(predictionTaskId, result);
    return result;
  }

  /**
   * 根据 predictionTaskId 获取已计算的共识结果。
   */
  async getConsensus(predictionTaskId: string): Promise<ConsensusResult | null> {
    const task = await this.prisma.predictionTask.findUnique({
      where: { id: predictionTaskId },
      select: { consensusLevel: true, consensusSummary: true, successCount: true, modelCount: true },
    });
    if (!task || !task.consensusSummary) return null;
    return task.consensusSummary as unknown as ConsensusResult;
  }

  /**
   * 根据 matchId 获取最新已发布版本的共识结果。
   */
  async getMatchConsensus(matchId: string): Promise<ConsensusResult | null> {
    const task = await this.prisma.predictionTask.findFirst({
      where: {
        matchId,
        status: { in: ['PUBLISHED', 'REVIEWED', 'SUCCEEDED', 'PARTIAL_SUCCESS'] },
      },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
      select: { consensusLevel: true, consensusSummary: true },
    });
    if (!task || !task.consensusSummary) return null;
    return task.consensusSummary as unknown as ConsensusResult;
  }

  private async saveConsensus(predictionTaskId: string, result: ConsensusResult): Promise<void> {
    await this.prisma.predictionTask.update({
      where: { id: predictionTaskId },
      data: {
        consensusLevel: result.level,
        consensusSummary: JSON.parse(JSON.stringify(result)),
      },
    });
  }

  private buildDivergencePoints(
    votes: Record<string, number>,
    goalsRanges: Array<{ min: number; max: number; expectation?: number }>,
    allRisks: string[],
    homeTeamName: string,
    awayTeamName: string,
  ): string[] {
    const points: string[] = [];

    // 胜平负分歧
    const nonZeroVotes = Object.entries(votes).filter(([, count]) => count > 0);
    if (nonZeroVotes.length > 1) {
      const descriptions = nonZeroVotes.map(([result, count]) => {
        const label = this.resultLabel(result, homeTeamName, awayTeamName);
        return `${count}个模型看${label}`;
      });
      points.push(`胜平负分歧：${descriptions.join('，')}`);
    }

    // 进球区间分歧
    if (goalsRanges.length >= 2) {
      const mins = goalsRanges.map((r) => r.min);
      const maxs = goalsRanges.map((r) => r.max);
      const minSpread = Math.max(...mins) - Math.min(...mins);
      const maxSpread = Math.max(...maxs) - Math.min(...maxs);
      if (minSpread >= 2 || maxSpread >= 2) {
        points.push(`进球预期存在分歧：区间跨度较大`);
      }
    }

    // 风险提示汇总
    const uniqueRisks = [...new Set(allRisks)].slice(0, 3);
    if (uniqueRisks.length > 0) {
      points.push(`关键风险：${uniqueRisks.join('；')}`);
    }

    return points.slice(0, 5);
  }

  private buildHighlight(
    level: ConsensusLevel,
    majorityResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
    majorityCount: number,
    totalModels: number,
    homeTeamName: string,
    awayTeamName: string,
    aggregatedProbability: AggregatedProbability | null,
  ): string {
    const resultLabel = this.resultLabel(majorityResult, homeTeamName, awayTeamName);
    const probabilityText = aggregatedProbability
      ? `（模型显式概率均值 ${Math.round(
          (majorityResult === 'HOME_WIN'
            ? aggregatedProbability.home
            : majorityResult === 'AWAY_WIN'
              ? aggregatedProbability.away
              : aggregatedProbability.draw) * 100,
        )}%）`
      : '（模型未提供可聚合概率）';

    switch (level) {
      case ConsensusLevel.HIGH:
        return `AI 共识较强：${majorityCount}/${totalModels} 模型看好${resultLabel}${probabilityText}`;
      case ConsensusLevel.MIXED:
        return `AI 存在分歧：${majorityCount}/${totalModels} 模型倾向${resultLabel}${probabilityText}，但风险不低`;
      case ConsensusLevel.STRONG_DIVERGENCE:
        return `AI 内部分歧明显：各模型观点差异较大，建议重点看风险提示`;
      default:
        return `${majorityCount}/${totalModels} 模型倾向${resultLabel}`;
    }
  }

  private resultLabel(
    result: string,
    homeTeamName: string,
    awayTeamName: string,
  ): string {
    switch (result) {
      case 'HOME_WIN':
        return `${homeTeamName}胜`;
      case 'AWAY_WIN':
        return `${awayTeamName}胜`;
      case 'DRAW':
        return '平局';
      default:
        return result;
    }
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Deduplicate strings by similarity (exact match).
 */
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

/**
 * Get the most frequently mentioned items (by occurrence count).
 */
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

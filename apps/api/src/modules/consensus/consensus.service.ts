import { Injectable } from '@nestjs/common';
import { ConsensusLevel } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * T4-01: AI 共识指数计算服务
 *
 * 根据文档规范：
 * - 高共识 (HIGH): 第一选择模型占比 ≥ 70%
 * - 存在分歧 (MIXED): 第一选择占比 50%–69%
 * - 强分歧 (STRONG_DIVERGENCE): 第一选择占比 < 50%
 *
 * 输出包含共识等级、分歧点、多数结果和高亮文本。
 */

export interface ConsensusResult {
  level: ConsensusLevel;
  agreementRate: number;
  majorityResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  majorityCount: number;
  totalModels: number;
  divergencePoints: string[];
  highlight: string;
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
  };
  likelyScores?: Array<{ home: number; away: number; weight?: number }>;
}

interface StructuredPredictionOutput {
  modelId?: string;
  modelDisplayName?: string;
  conclusion?: PredictionConclusion;
  risks?: string[];
  keyVariables?: string[];
}

@Injectable()
export class ConsensusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 计算指定预测任务的共识指数。
   * 在所有模型预测完成后调用，结果写入 PredictionTask.consensusLevel 和 consensusSummary。
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
      };
      await this.saveConsensus(predictionTaskId, emptyResult);
      return emptyResult;
    }

    const homeTeamName = task.match.homeTeam.shortName ?? task.match.homeTeam.name;
    const awayTeamName = task.match.awayTeam.shortName ?? task.match.awayTeam.name;

    // 统计各模型的胜平负结论
    const votes: Record<string, number> = {
      HOME_WIN: 0,
      DRAW: 0,
      AWAY_WIN: 0,
    };

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
    const divergencePoints = this.buildDivergencePoints(
      votes,
      goalsRanges,
      allRisks,
      homeTeamName,
      awayTeamName,
    );

    // 生成高亮文本
    const highlight = this.buildHighlight(
      level,
      majorityResult as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
      majorityCount,
      totalModels,
      homeTeamName,
      awayTeamName,
    );

    const result: ConsensusResult = {
      level,
      agreementRate,
      majorityResult: majorityResult as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
      majorityCount,
      totalModels,
      divergencePoints,
      highlight,
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
    goalsRanges: Array<{ min: number; max: number; modelName: string }>,
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
  ): string {
    const resultLabel = this.resultLabel(majorityResult, homeTeamName, awayTeamName);

    switch (level) {
      case ConsensusLevel.HIGH:
        return `AI 共识较强：${majorityCount}/${totalModels} 模型看好${resultLabel}`;
      case ConsensusLevel.MIXED:
        return `AI 存在分歧：${majorityCount}/${totalModels} 模型倾向${resultLabel}，但风险不低`;
      case ConsensusLevel.STRONG_DIVERGENCE:
        return `AI 内部分歧明显：建议重点看风险提示`;
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

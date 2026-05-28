import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * T4-04: 模型战绩更新服务
 *
 * 在赛后复盘完成后，统计每个模型的战绩：
 * - 总战绩 (OVERALL): 所有比赛的命中率
 * - 赛事战绩 (COMPETITION): 按赛事维度统计
 * - 近10场 (RECENT_10): 最近10场比赛的表现
 */

export interface ScorecardUpdateResult {
  aiModelId: string;
  overall: ScorecardStats;
  competition: ScorecardStats;
  recent10: ScorecardStats;
}

export interface ScorecardStats {
  totalMatches: number;
  winDrawLossCorrect: number;
  scoreExact: number;
  goalRangeHit: number;
  winRate: number;
  recentForm: string;
}

interface PredictionConclusion {
  winLossDraw?: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  likelyScores?: Array<{ home: number; away: number }>;
  goalsRange?: { min: number; max: number };
}

interface StructuredPredictionOutput {
  conclusion?: PredictionConclusion;
}

@Injectable()
export class ScorecardService {
  private readonly logger = new Logger(ScorecardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 更新指定比赛中所有参与模型的战绩。
   * 在赛后复盘完成后调用。
   */
  async updateScorecardsForMatch(matchId: string): Promise<ScorecardUpdateResult[]> {
    const match = await this.prisma.match.findUniqueOrThrow({
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
      this.logger.warn(`Match ${matchId} not finished or scores missing, skipping scorecard update`);
      return [];
    }

    // 获取该比赛所有成功的模型预测
    const predictions = await this.prisma.modelPrediction.findMany({
      where: {
        predictionTask: { matchId },
        isSuccess: true,
      },
      include: { aiModel: true, predictionTask: true },
      orderBy: { predictionTask: { version: 'desc' } },
    });

    // 按模型分组，取最新版本的预测
    const modelPredictions = new Map<string, typeof predictions[0]>();
    for (const pred of predictions) {
      if (!modelPredictions.has(pred.aiModelId)) {
        modelPredictions.set(pred.aiModelId, pred);
      }
    }

    const results: ScorecardUpdateResult[] = [];

    for (const [aiModelId, prediction] of modelPredictions) {
      const accuracy = this.evaluateAccuracy(
        prediction.structuredOutput as unknown as StructuredPredictionOutput,
        match.homeScore,
        match.awayScore,
      );

      // 更新三个维度的战绩
      const overall = await this.updateScorecardScope(aiModelId, 'OVERALL', null, matchId, accuracy);
      const competition = await this.updateScorecardScope(aiModelId, 'COMPETITION', match.competitionId, matchId, accuracy);
      const recent10 = await this.updateRecent10(aiModelId, matchId);

      results.push({ aiModelId, overall, competition, recent10 });
    }

    return results;
  }

  /**
   * 获取指定模型的所有维度战绩。
   */
  async getModelScorecards(aiModelId: string): Promise<{
    overall: ScorecardStats | null;
    competition: Array<{ scopeId: string; stats: ScorecardStats }>;
    recent10: ScorecardStats | null;
  }> {
    const scorecards = await this.prisma.modelScorecard.findMany({
      where: { aiModelId },
    });

    const overall = scorecards.find((s) => s.scopeType === 'OVERALL');
    const recent10 = scorecards.find((s) => s.scopeType === 'RECENT_10');
    const competitions = scorecards.filter((s) => s.scopeType === 'COMPETITION');

    return {
      overall: overall ? this.toStats(overall) : null,
      competition: competitions.map((c) => ({
        scopeId: c.scopeId ?? '',
        stats: this.toStats(c),
      })),
      recent10: recent10 ? this.toStats(recent10) : null,
    };
  }

  /**
   * 获取所有模型的总战绩排行。
   */
  async getLeaderboard(): Promise<Array<{
    aiModelId: string;
    displayName: string;
    persona: string;
    stats: ScorecardStats;
  }>> {
    const scorecards = await this.prisma.modelScorecard.findMany({
      where: { scopeType: 'OVERALL' },
      include: { aiModel: true },
      orderBy: { winRate: 'desc' },
    });

    return scorecards.map((sc) => ({
      aiModelId: sc.aiModelId,
      displayName: sc.aiModel.displayName,
      persona: sc.aiModel.persona,
      stats: this.toStats(sc),
    }));
  }

  private evaluateAccuracy(
    output: StructuredPredictionOutput,
    actualHomeScore: number,
    actualAwayScore: number,
  ): { winDrawLossCorrect: boolean; scoreExact: boolean; goalRangeHit: boolean } {
    const conclusion = output?.conclusion;
    if (!conclusion) {
      return { winDrawLossCorrect: false, scoreExact: false, goalRangeHit: false };
    }

    // 判断实际胜平负
    let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    if (actualHomeScore > actualAwayScore) {
      actualResult = 'HOME_WIN';
    } else if (actualHomeScore < actualAwayScore) {
      actualResult = 'AWAY_WIN';
    } else {
      actualResult = 'DRAW';
    }

    const winDrawLossCorrect = conclusion.winLossDraw === actualResult;

    // 判断比分命中
    const scoreExact = conclusion.likelyScores?.some(
      (s) => s.home === actualHomeScore && s.away === actualAwayScore,
    ) ?? false;

    // 判断进球区间命中
    const totalGoals = actualHomeScore + actualAwayScore;
    const goalRangeHit = conclusion.goalsRange
      ? totalGoals >= conclusion.goalsRange.min && totalGoals <= conclusion.goalsRange.max
      : false;

    return { winDrawLossCorrect, scoreExact, goalRangeHit };
  }

  private async updateScorecardScope(
    aiModelId: string,
    scopeType: string,
    scopeId: string | null,
    matchId: string,
    accuracy: { winDrawLossCorrect: boolean; scoreExact: boolean; goalRangeHit: boolean },
  ): Promise<ScorecardStats> {
    const existing = await this.prisma.modelScorecard.findFirst({
      where: { aiModelId, scopeType, scopeId },
    });

    const newTotal = (existing?.totalMatches ?? 0) + 1;
    const newWDLCorrect = (existing?.winDrawLossCorrect ?? 0) + (accuracy.winDrawLossCorrect ? 1 : 0);
    const newScoreExact = (existing?.scoreExact ?? 0) + (accuracy.scoreExact ? 1 : 0);
    const newGoalRangeHit = (existing?.goalRangeHit ?? 0) + (accuracy.goalRangeHit ? 1 : 0);
    const newWinRate = newTotal > 0 ? newWDLCorrect / newTotal : 0;

    // 更新 recentForm
    const formChar = accuracy.winDrawLossCorrect ? 'W' : 'L';
    const existingForm = existing?.recentForm ?? '';
    const newForm = (existingForm + formChar).slice(-10);

    if (existing) {
      await this.prisma.modelScorecard.update({
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
      await this.prisma.modelScorecard.create({
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

    return {
      totalMatches: newTotal,
      winDrawLossCorrect: newWDLCorrect,
      scoreExact: newScoreExact,
      goalRangeHit: newGoalRangeHit,
      winRate: newWinRate,
      recentForm: newForm,
    };
  }

  private async updateRecent10(aiModelId: string, matchId: string): Promise<ScorecardStats> {
    // 获取该模型最近10场已完成比赛的预测
    const recentPredictions = await this.prisma.modelPrediction.findMany({
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
      const match = pred.predictionTask.match;
      if (match.homeScore == null || match.awayScore == null) continue;

      const accuracy = this.evaluateAccuracy(
        pred.structuredOutput as unknown as StructuredPredictionOutput,
        match.homeScore,
        match.awayScore,
      );

      if (accuracy.winDrawLossCorrect) wdlCorrect++;
      if (accuracy.scoreExact) scoreExact++;
      if (accuracy.goalRangeHit) goalRangeHit++;
      form += accuracy.winDrawLossCorrect ? 'W' : 'L';
    }

    const totalMatches = recentPredictions.length;
    const winRate = totalMatches > 0 ? wdlCorrect / totalMatches : 0;

    const existing = await this.prisma.modelScorecard.findFirst({
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
      await this.prisma.modelScorecard.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.modelScorecard.create({
        data: { aiModelId, scopeType: 'RECENT_10', scopeId: null, ...data },
      });
    }

    return { ...data };
  }

  private toStats(scorecard: {
    totalMatches: number;
    winDrawLossCorrect: number;
    scoreExact: number;
    goalRangeHit: number;
    winRate: number;
    recentForm: string | null;
  }): ScorecardStats {
    return {
      totalMatches: scorecard.totalMatches,
      winDrawLossCorrect: scorecard.winDrawLossCorrect,
      scoreExact: scorecard.scoreExact,
      goalRangeHit: scorecard.goalRangeHit,
      winRate: scorecard.winRate,
      recentForm: scorecard.recentForm ?? '',
    };
  }
}

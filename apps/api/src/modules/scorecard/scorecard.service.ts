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
  handicapCorrect: number;
  overUnderCorrect: number;
  halfFullCorrect: number;
  anyHit: number;
  hitRate: number;
  winRate: number;
  recentForm: string;
}

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
        homeHalfScore: true,
        awayHalfScore: true,
        handicapLine: true,
        overUnderLine: true,
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

    // 计算实际赛果维度
    let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    if (match.homeScore > match.awayScore) actualResult = 'HOME_WIN';
    else if (match.homeScore < match.awayScore) actualResult = 'AWAY_WIN';
    else actualResult = 'DRAW';

    const actualHandicap = this.computeHandicapResult(match.homeScore, match.awayScore, match.handicapLine);
    const actualOU = this.computeOverUnderResult(match.homeScore, match.awayScore, match.overUnderLine);
    const actualHF = this.computeHalfFullTime(match.homeHalfScore, match.awayHalfScore, match.homeScore, match.awayScore);

    for (const [aiModelId, prediction] of modelPredictions) {
      const accuracy = this.evaluateAccuracy(
        prediction.structuredOutput as unknown as StructuredPredictionOutput,
        match.homeScore,
        match.awayScore,
        actualResult,
        actualHandicap,
        actualOU,
        actualHF,
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

  private computeHandicapResult(homeScore: number, awayScore: number, handicapLine: number | null): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null {
    if (handicapLine == null) return null;
    const adjusted = homeScore + handicapLine;
    if (adjusted > awayScore) return 'HOME_WIN';
    if (adjusted < awayScore) return 'AWAY_WIN';
    return 'DRAW';
  }

  private computeOverUnderResult(homeScore: number, awayScore: number, line: number | null): 'OVER' | 'UNDER' | 'EQUAL' | null {
    if (line == null) return null;
    const total = homeScore + awayScore;
    if (total > line) return 'OVER';
    if (total < line) return 'UNDER';
    return 'EQUAL';
  }

  private computeHalfFullTime(homeHalf: number | null, awayHalf: number | null, homeScore: number, awayScore: number): string | null {
    if (homeHalf == null || awayHalf == null) return null;
    const half = homeHalf > awayHalf ? 'HOME' : homeHalf < awayHalf ? 'AWAY' : 'DRAW';
    const full = homeScore > awayScore ? 'HOME' : homeScore < awayScore ? 'AWAY' : 'DRAW';
    return `${half}_${full}`;
  }

  private evaluateAccuracy(
    output: StructuredPredictionOutput,
    actualHomeScore: number,
    actualAwayScore: number,
    actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
    actualHandicap: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null,
    actualOU: 'OVER' | 'UNDER' | 'EQUAL' | null,
    actualHF: string | null,
  ): { winDrawLossCorrect: boolean; handicapCorrect: boolean; overUnderCorrect: boolean; scoreExact: boolean; halfFullCorrect: boolean; goalRangeHit: boolean; anyHit: boolean } {
    const conclusion = output?.conclusion;
    if (!conclusion) {
      return { winDrawLossCorrect: false, handicapCorrect: false, overUnderCorrect: false, scoreExact: false, halfFullCorrect: false, goalRangeHit: false, anyHit: false };
    }

    const winDrawLossCorrect = conclusion.winLossDraw === actualResult;
    const handicapCorrect = actualHandicap != null && conclusion.handicapWinLossDraw != null
      ? conclusion.handicapWinLossDraw === actualHandicap : false;
    const overUnderCorrect = actualOU != null && conclusion.overUnderResult != null
      ? conclusion.overUnderResult === actualOU : false;
    const scoreExact = conclusion.likelyScores?.some(
      (s) => s.home === actualHomeScore && s.away === actualAwayScore,
    ) ?? false;
    const halfFullCorrect = actualHF != null && conclusion.halfFullTime != null
      ? conclusion.halfFullTime === actualHF : false;
    const totalGoals = actualHomeScore + actualAwayScore;
    const goalRangeHit = conclusion.goalsRange
      ? totalGoals >= conclusion.goalsRange.min && totalGoals <= conclusion.goalsRange.max
      : false;
    const anyHit = winDrawLossCorrect || handicapCorrect || overUnderCorrect || scoreExact || halfFullCorrect;

    return { winDrawLossCorrect, handicapCorrect, overUnderCorrect, scoreExact, halfFullCorrect, goalRangeHit, anyHit };
  }

  private async updateScorecardScope(
    aiModelId: string,
    scopeType: string,
    scopeId: string | null,
    matchId: string,
    accuracy: { winDrawLossCorrect: boolean; handicapCorrect: boolean; overUnderCorrect: boolean; scoreExact: boolean; halfFullCorrect: boolean; goalRangeHit: boolean; anyHit: boolean },
  ): Promise<ScorecardStats> {
    const scopeKey = scopeId ?? '';
    const existing = await this.prisma.modelScorecard.findFirst({
      where: { aiModelId, scopeType, scopeId: scopeKey },
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
      await this.prisma.modelScorecard.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.modelScorecard.create({ data: { aiModelId, scopeType, scopeId: scopeKey, ...data } });
    }

    return data;
  }

  private async updateRecent10(aiModelId: string, matchId: string): Promise<ScorecardStats> {
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
    let handicapCorrectCount = 0;
    let overUnderCorrectCount = 0;
    let halfFullCorrectCount = 0;
    let anyHitCount = 0;
    let form = '';

    for (const pred of recentPredictions) {
      const m = pred.predictionTask.match;
      if (m.homeScore == null || m.awayScore == null) continue;

      let actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
      if (m.homeScore > m.awayScore) actualResult = 'HOME_WIN';
      else if (m.homeScore < m.awayScore) actualResult = 'AWAY_WIN';
      else actualResult = 'DRAW';

      const actualHandicap = this.computeHandicapResult(m.homeScore, m.awayScore, m.handicapLine);
      const actualOU = this.computeOverUnderResult(m.homeScore, m.awayScore, m.overUnderLine);
      const actualHF = this.computeHalfFullTime(m.homeHalfScore, m.awayHalfScore, m.homeScore, m.awayScore);

      const accuracy = this.evaluateAccuracy(
        pred.structuredOutput as unknown as StructuredPredictionOutput,
        m.homeScore, m.awayScore, actualResult, actualHandicap, actualOU, actualHF,
      );

      if (accuracy.winDrawLossCorrect) wdlCorrect++;
      if (accuracy.scoreExact) scoreExact++;
      if (accuracy.goalRangeHit) goalRangeHit++;
      if (accuracy.handicapCorrect) handicapCorrectCount++;
      if (accuracy.overUnderCorrect) overUnderCorrectCount++;
      if (accuracy.halfFullCorrect) halfFullCorrectCount++;
      if (accuracy.anyHit) anyHitCount++;
      form += accuracy.anyHit ? 'R' : 'M';
    }

    const totalMatches = recentPredictions.length;
    const hitRate = totalMatches > 0 ? anyHitCount / totalMatches : 0;
    const winRate = totalMatches > 0 ? wdlCorrect / totalMatches : 0;

    const existing = await this.prisma.modelScorecard.findFirst({
      where: { aiModelId, scopeType: 'RECENT_10', scopeId: '' },
    });

    const data = {
      totalMatches,
      winDrawLossCorrect: wdlCorrect,
      scoreExact,
      goalRangeHit,
      handicapCorrect: handicapCorrectCount,
      overUnderCorrect: overUnderCorrectCount,
      halfFullCorrect: halfFullCorrectCount,
      anyHit: anyHitCount,
      hitRate,
      winRate,
      recentForm: form,
      lastMatchId: matchId,
    };

    if (existing) {
      await this.prisma.modelScorecard.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.modelScorecard.create({ data: { aiModelId, scopeType: 'RECENT_10', scopeId: '', ...data } });
    }

    return data;
  }

  private toStats(scorecard: {
    totalMatches: number;
    winDrawLossCorrect: number;
    scoreExact: number;
    goalRangeHit: number;
    handicapCorrect: number;
    overUnderCorrect: number;
    halfFullCorrect: number;
    anyHit: number;
    hitRate: number;
    winRate: number;
    recentForm: string | null;
  }): ScorecardStats {
    return {
      totalMatches: scorecard.totalMatches,
      winDrawLossCorrect: scorecard.winDrawLossCorrect,
      scoreExact: scorecard.scoreExact,
      goalRangeHit: scorecard.goalRangeHit,
      handicapCorrect: scorecard.handicapCorrect,
      overUnderCorrect: scorecard.overUnderCorrect,
      halfFullCorrect: scorecard.halfFullCorrect,
      anyHit: scorecard.anyHit,
      hitRate: scorecard.hitRate,
      winRate: scorecard.winRate,
      recentForm: scorecard.recentForm ?? '',
    };
  }
}

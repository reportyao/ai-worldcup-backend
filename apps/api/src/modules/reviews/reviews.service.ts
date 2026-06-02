import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * T4-03/T4-04: 复盘与战绩查询服务
 *
 * 提供：
 * - 按比赛获取所有模型复盘
 * - 按模型获取复盘历史
 * - 获取模型战绩
 * - 获取模型排行榜
 */

export interface ModelReviewPayload {
  id: string;
  matchId: string;
  aiModelId: string;
  model: {
    id: string;
    displayName: string;
    persona: string;
    provider: string;
  };
  status: string;
  structuredOutput: unknown;
  accuracyJson: unknown;
  publishedAt: string | null;
  createdAt: string;
}

export interface MatchReviewsPayload {
  matchId: string;
  status: 'pending' | 'generating' | 'published' | 'partial';
  reviews: ModelReviewPayload[];
  summary: {
    totalModels: number;
    publishedCount: number;
    averageGrade: string | null;
  };
}

export interface ModelScorecardPayload {
  aiModelId: string;
  displayName: string;
  persona: string;
  overall: ScorecardStatsPayload | null;
  recent10: ScorecardStatsPayload | null;
  competitions: Array<{
    competitionId: string;
    competitionName: string;
    stats: ScorecardStatsPayload;
  }>;
}

export interface ScorecardStatsPayload {
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
  brierScoreAvg: number;
  logLossAvg: number;
  probabilitySamples: number;
  recentForm: string;
}

export interface LeaderboardEntry {
  rank: number;
  aiModelId: string;
  displayName: string;
  persona: string;
  totalMatches: number;
  winRate: number;
  hitRate: number;
  anyHit: number;
  brierScoreAvg: number;
  logLossAvg: number;
  probabilitySamples: number;
  recentForm: string;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取指定比赛的所有模型复盘。
   */
  async getMatchReviews(matchId: string): Promise<MatchReviewsPayload> {
    const reviews = await this.prisma.modelReview.findMany({
      where: { matchId },
      include: { aiModel: true },
      orderBy: { createdAt: 'asc' },
    });

    const publishedCount = reviews.filter((r) => r.status === 'PUBLISHED').length;
    const totalModels = reviews.length;

    // 计算平均评分
    let averageGrade: string | null = null;
    const grades = reviews
      .filter((r) => r.status === 'PUBLISHED' && r.structuredOutput)
      .map((r) => (r.structuredOutput as Record<string, unknown>)?.grade as string)
      .filter(Boolean);

    if (grades.length > 0) {
      const gradeValues: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
      const avg = grades.reduce((sum, g) => sum + (gradeValues[g] ?? 0), 0) / grades.length;
      if (avg >= 4.5) averageGrade = 'A';
      else if (avg >= 3.5) averageGrade = 'B';
      else if (avg >= 2.5) averageGrade = 'C';
      else if (avg >= 1.5) averageGrade = 'D';
      else averageGrade = 'F';
    }

    // 确定整体状态
    let status: 'pending' | 'generating' | 'published' | 'partial';
    if (totalModels === 0) {
      status = 'pending';
    } else if (publishedCount === totalModels) {
      status = 'published';
    } else if (reviews.some((r) => r.status === 'GENERATING')) {
      status = 'generating';
    } else if (publishedCount > 0) {
      status = 'partial';
    } else {
      status = 'pending';
    }

    return {
      matchId,
      status,
      reviews: reviews.map((r) => ({
        id: r.id,
        matchId: r.matchId,
        aiModelId: r.aiModelId,
        model: {
          id: r.aiModel.id,
          displayName: r.aiModel.displayName,
          persona: r.aiModel.persona,
          provider: r.aiModel.provider,
        },
        status: r.status,
        structuredOutput: r.structuredOutput,
        accuracyJson: r.accuracyJson,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      summary: {
        totalModels,
        publishedCount,
        averageGrade,
      },
    };
  }

  /**
   * 获取指定模型的战绩卡片。
   */
  async getModelScorecard(aiModelId: string): Promise<ModelScorecardPayload | null> {
    const model = await this.prisma.aiModel.findUnique({
      where: { id: aiModelId },
    });
    if (!model) return null;

    const scorecards = await this.prisma.modelScorecard.findMany({
      where: { aiModelId },
    });

    const overall = scorecards.find((s) => s.scopeType === 'OVERALL');
    const recent10 = scorecards.find((s) => s.scopeType === 'RECENT_10');
    const competitions = scorecards.filter((s) => s.scopeType === 'COMPETITION');

    // 获取赛事名称
    const competitionIds = competitions.map((c) => c.scopeId).filter(Boolean) as string[];
    const competitionMap = new Map<string, string>();
    if (competitionIds.length > 0) {
      const comps = await this.prisma.competition.findMany({
        where: { id: { in: competitionIds } },
        select: { id: true, name: true },
      });
      for (const c of comps) {
        competitionMap.set(c.id, c.name);
      }
    }

    return {
      aiModelId,
      displayName: model.displayName,
      persona: model.persona,
      overall: overall ? this.toStatsPayload(overall) : null,
      recent10: recent10 ? this.toStatsPayload(recent10) : null,
      competitions: competitions.map((c) => ({
        competitionId: c.scopeId ?? '',
        competitionName: competitionMap.get(c.scopeId ?? '') ?? '未知赛事',
        stats: this.toStatsPayload(c),
      })),
    };
  }

  /**
   * 获取所有模型的排行榜（按综合红单率降序）。
   */
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const scorecards = await this.prisma.modelScorecard.findMany({
      where: { scopeType: 'OVERALL' },
      include: { aiModel: true },
      orderBy: { hitRate: 'desc' },
    });

    return scorecards.map((sc, index) => ({
      rank: index + 1,
      aiModelId: sc.aiModelId,
      displayName: sc.aiModel.displayName,
      persona: sc.aiModel.persona,
      totalMatches: sc.totalMatches,
      winRate: sc.winRate,
      hitRate: sc.hitRate,
      anyHit: sc.anyHit,
      brierScoreAvg: sc.brierScoreAvg,
      logLossAvg: sc.logLossAvg,
      probabilitySamples: sc.probabilitySamples,
      recentForm: sc.recentForm ?? '',
    }));
  }

  private toStatsPayload(scorecard: {
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
    brierScoreAvg: number;
    logLossAvg: number;
    probabilitySamples: number;
    recentForm: string | null;
  }): ScorecardStatsPayload {
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
      brierScoreAvg: scorecard.brierScoreAvg,
      logLossAvg: scorecard.logLossAvg,
      probabilitySamples: scorecard.probabilitySamples,
      recentForm: scorecard.recentForm ?? '',
    };
  }
}

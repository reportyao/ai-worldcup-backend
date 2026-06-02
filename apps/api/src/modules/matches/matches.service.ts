import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CompetitionType, MatchStatus, PredictionTaskStatus } from '@prisma/client';
import type { Match, UserPrediction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { RequestMeta } from '../auth/auth.service.js';
import { AccessService } from '../entitlements/access.service.js';

import type { MatchListQueryDto, UserPredictionSubmitDto } from './matches.schemas.js';

type TeaserData = {
  modelCount: number;
  keyVarCount: number;
  hasHighConsensus: boolean;
  modelNames: string[];
  consensusLevel: string | null;
};

@Injectable()
export class MatchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService,
    private readonly accessService: AccessService,
  ) {}

  async listMatches(query: MatchListQueryDto) {
    // User-facing lists should not expose stale historical fixtures. Keep all rows in DB for AI
    // prediction/review pipelines, but show only matches whose kickoff is within the latest
    // seven-day result window or in the future, unless a tab asks for a stricter window.
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const todayKey = this.formatMatchday(now);
    const tab = query.tab;

    const where = {
      ...(query.competitionId ? { competitionId: query.competitionId } : {}),
      ...(query.group ? { stage: query.group } : {}),
      ...(query.matchday ? { matchday: query.matchday } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(tab === 'today' ? { matchday: query.matchday ?? todayKey } : {}),
      ...(tab === 'worldcup' ? { competition: { type: CompetitionType.WORLD_CUP, status: 'ACTIVE' } } : {}),
      ...(tab === 'others' ? { competition: { type: { not: CompetitionType.WORLD_CUP }, status: 'ACTIVE' } } : {}),
      ...(tab === 'finished'
        ? {
            kickoffAt: { gte: threeDaysAgo, lte: now },
            status: MatchStatus.FINISHED,
          }
        : tab === 'today'
          ? {}
          : { kickoffAt: { gte: sevenDaysAgo } }),
      ...(query.status === MatchStatus.SCHEDULED ? { kickoffAt: { gte: now } } : {}),
    };

    const orderBy = tab === 'finished' ? { kickoffAt: 'desc' as const } : { kickoffAt: 'asc' as const };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        include: {
          competition: true,
          homeTeam: true,
          awayTeam: true,
          predictionTasks: {
            orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
            take: 1,
          },
        },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.match.count({ where }),
    ]);

    return {
      items: items.map((match) => this.toMatchSummary(match)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getMatchDetail(matchId: string, accessToken?: string, guestToken?: string) {
    const viewer = await this.authService.resolveViewer(accessToken, guestToken);
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        competition: true,
        homeTeam: true,
        awayTeam: true,
        predictionTasks: {
          include: {
            predictions: {
              include: { aiModel: true },
              where: { isSuccess: true },
              orderBy: { createdAt: 'desc' },
            },
          },
          where: { status: { in: ['PUBLISHED', 'REVIEWED', 'SUCCEEDED'] } },
          orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });

    if (!match) throw new NotFoundException('Match not found');

    const [userPrediction, access] = await Promise.all([
      this.findViewerPrediction(matchId, viewer.userId, viewer.guestId),
      this.buildAccessPayload(match.id, viewer.userId, viewer.guestId),
    ]);

    const reviewsForAnalyses = access.canViewFullModels
      ? await this.prisma.modelReview.findMany({
          where: { matchId, status: 'PUBLISHED' },
          select: { aiModelId: true, predictionTaskId: true, accuracyJson: true },
        })
      : [];

    const accuracyByTaskAndModel = new Map<string, unknown>();
    const accuracyByModel = new Map<string, unknown>();
    for (const review of reviewsForAnalyses) {
      if (!review.accuracyJson) continue;
      accuracyByModel.set(review.aiModelId, review.accuracyJson);
      if (review.predictionTaskId) {
        accuracyByTaskAndModel.set(`${review.predictionTaskId}:${review.aiModelId}`, review.accuracyJson);
      }
    }

    const modelAnalyses = access.canViewFullModels
      ? match.predictionTasks.flatMap((task) =>
          task.predictions.map((prediction) => ({
            id: prediction.id,
            taskVersion: task.version,
            model: {
              id: prediction.aiModel.id,
              displayName: prediction.aiModel.displayName,
              persona: prediction.aiModel.persona,
              provider: prediction.aiModel.provider,
            },
            structuredOutput: prediction.structuredOutput,
            accuracy:
              accuracyByTaskAndModel.get(`${task.id}:${prediction.aiModel.id}`) ??
              accuracyByModel.get(prediction.aiModel.id) ??
              null,
            generatedAt: prediction.createdAt.toISOString(),
          })),
        )
      : [];

    return {
      match: this.toMatchSummary(match),
      detail: {
        competition: {
          id: match.competition.id,
          code: match.competition.code,
          name: match.competition.name,
          season: match.competition.season,
          type: match.competition.type,
        },
        score: {
          home: match.homeScore,
          away: match.awayScore,
          status: match.status,
        },
        tabs: ['overview', 'models', 'my_prediction', 'review'],
        access,
        consensus: this.buildConsensus(match.predictionTasks),
        modelAnalyses,
        review: await this.buildReviewPayload(matchId, match.status),
      },
      userPrediction: userPrediction ? this.toUserPrediction(userPrediction) : null,
    };
  }

  async submitUserPrediction(
    matchId: string,
    dto: UserPredictionSubmitDto,
    accessToken: string | undefined,
    guestToken: string | undefined,
    meta: RequestMeta,
  ) {
    const viewer = await this.authService.resolveViewer(accessToken, guestToken);
    if (!viewer.userId && !viewer.guestId) {
      throw new UnauthorizedException('Guest or user session is required to submit prediction');
    }

    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException('Match not found');

    const data = {
      prediction: dto.prediction,
      homeScore: dto.homeScore,
      awayScore: dto.awayScore,
      goalsMin: dto.goalsMin,
      goalsMax: dto.goalsMax,
      clientRequestId: dto.clientRequestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      submittedAt: new Date(),
    };

    const saved = viewer.userId
      ? await this.prisma.userPrediction.upsert({
          where: { matchId_userId: { matchId, userId: viewer.userId } },
          create: { ...data, matchId, userId: viewer.userId },
          update: data,
        })
      : await this.prisma.userPrediction.upsert({
          where: { matchId_guestId: { matchId, guestId: viewer.guestId as string } },
          create: { ...data, matchId, guestId: viewer.guestId },
          update: data,
        });

    return {
      prediction: this.toUserPrediction(saved),
      comparison: this.buildAiComparisonHint(match, dto),
    };
  }

  private async findViewerPrediction(matchId: string, userId?: string, guestId?: string) {
    if (userId) {
      const prediction = await this.prisma.userPrediction.findUnique({
        where: { matchId_userId: { matchId, userId } },
      });
      if (prediction) return prediction;
    }

    if (guestId) {
      return this.prisma.userPrediction.findUnique({
        where: { matchId_guestId: { matchId, guestId } },
      });
    }

    return null;
  }

  private toMatchSummary(match: Match & { competition: { id: string; code: string; name: string; season: string; type?: string; priority?: string }; homeTeam: { id: string; code: string; name: string; nameZh: string | null; shortName: string | null; countryCode: string | null; crestUrl: string | null; flagUrl: string | null }; awayTeam: { id: string; code: string; name: string; nameZh: string | null; shortName: string | null; countryCode: string | null; crestUrl: string | null; flagUrl: string | null }; predictionTasks?: Array<{ status: PredictionTaskStatus; consensusLevel: string | null; consensusSummary: unknown }> }) {
    const latestTask = match.predictionTasks?.[0];
    const competitionNameZh = this.localizeCompetitionName(match.competition.name);
    return {
      id: match.id,
      competitionId: match.competitionId,
      competition: {
        ...match.competition,
        nameZh: competitionNameZh,
      },
      competitionName: match.competition.name,
      competitionNameZh,
      competitionPriority: match.competition.priority,
      homeTeam: this.localizeTeam(match.homeTeam),
      awayTeam: this.localizeTeam(match.awayTeam),
      kickoffAt: match.kickoffAt.toISOString(),
      status: this.normalizeUserFacingStatus(match),
      matchday: match.matchday,
      stage: this.normalizeStageForUser(match),
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      aiStatus: latestTask?.status ?? 'PENDING',
      consensusLevel: latestTask?.consensusLevel ?? null,
      consensusHint: this.extractConsensusHint(latestTask?.consensusSummary),
      unlockState: 'basic_available',
    };
  }

  private formatMatchday(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private normalizeStageForUser(match: Match & { competition: { type?: string } }): string | null {
    if (!match.stage) return null;
    if (match.competition.type !== CompetitionType.WORLD_CUP) return match.stage;

    const groupNumber = this.parseWorldCupGroupNumber(match.stage);
    return groupNumber == null ? match.stage : `Group ${groupNumber}`;
  }

  private parseWorldCupGroupNumber(stage: string): number | null {
    const normalized = stage.trim();
    const numericMatch = normalized.match(/^(?:group\s*)?(?:第\s*)?(\d{1,2})(?:\s*组)?$/i);
    if (numericMatch) {
      const value = Number(numericMatch[1]);
      return value >= 1 && value <= 12 ? value : null;
    }

    const letterMatch = normalized.match(/^(?:group\s*)?([a-l])(?:\s*组)?$/i);
    if (letterMatch) {
      return letterMatch[1].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0) + 1;
    }

    return null;
  }

  private normalizeUserFacingStatus(match: Pick<Match, 'status' | 'kickoffAt' | 'homeScore' | 'awayScore'>): MatchStatus {
    const hasFinalScore = match.homeScore != null && match.awayScore != null;
    const isPastKickoff = match.kickoffAt.getTime() < Date.now();
    const isTerminalException = match.status === MatchStatus.CANCELED || match.status === MatchStatus.POSTPONED;

    if (hasFinalScore && isPastKickoff && !isTerminalException) {
      return MatchStatus.FINISHED;
    }
    return match.status;
  }

  private localizeTeam<T extends { name: string; nameZh: string | null; shortName: string | null }>(team: T): T & { nameZh: string | null } {
    return { ...team, nameZh: team.nameZh ?? this.localizeTeamName(team.name) ?? null };
  }

  private localizeTeamName(name: string): string | null {
    const normalized = name.trim().toLowerCase();
    return TEAM_NAME_ZH[normalized] ?? null;
  }

  private localizeCompetitionName(name: string): string | null {
    const normalized = name.trim().toLowerCase();
    return COMPETITION_NAME_ZH[normalized] ?? null;
  }

  private buildConsensus(tasks: Array<{ status: string; consensusLevel: string | null; consensusSummary: unknown; predictions: Array<{ isSuccess: boolean }> }>) {
    const published = tasks[0];
    if (!published) {
      return {
        status: 'generating',
        title: 'AI 共识生成中',
        highlight: '赛前 24h 和 2h 版本会在后台生成后展示。',
        modelCount: 0,
        successCount: 0,
        level: null,
      };
    }

    const successCount = published.predictions.filter((p) => p.isSuccess).length;
    const modelCount = published.predictions.length;
    const summary = published.consensusSummary as Record<string, unknown> | null;

    // Determine correct status label based on actual task status
    const statusLabel = published.status === PredictionTaskStatus.PUBLISHED
      ? 'published'
      : published.status === PredictionTaskStatus.REVIEWED
        ? 'reviewed'
        : 'ready';

    return {
      status: statusLabel,
      title: this.extractConsensusHint(published.consensusSummary) ?? 'AI 共识已发布',
      highlight: this.extractConsensusHighlight(published.consensusSummary),
      modelCount,
      successCount,
      level: published.consensusLevel,
      agreementRate: summary?.agreementRate ?? undefined,
      majorityResult: summary?.majorityResult ?? undefined,
      majorityCount: summary?.majorityCount ?? undefined,
      totalModels: summary?.totalModels ?? undefined,
      divergencePoints: summary?.divergencePoints ?? undefined,
      aggregatedProbability: summary?.aggregatedProbability ?? undefined,
      aggregatedGoalsRange: summary?.aggregatedGoalsRange ?? undefined,
      viewpointClusters: summary?.viewpointClusters ?? undefined,
      sharedStrengths: summary?.sharedStrengths ?? undefined,
      sharedRisks: summary?.sharedRisks ?? undefined,
      sharedKeyVariables: summary?.sharedKeyVariables ?? undefined,
    };
  }

  private buildAiComparisonHint(match: Match, dto: UserPredictionSubmitDto) {
    const scoreText = `${dto.homeScore}-${dto.awayScore}`;
    const closed = match.status === MatchStatus.FINISHED || match.status === MatchStatus.CANCELED;
    return {
      title: closed ? '预测已记录，等待复盘统计' : '预测已提交',
      message: `你的胜平负与比分 ${scoreText} 已保存，登录后会保留这次游客预测。`,
      submittedBeforeKickoff: new Date() < match.kickoffAt,
    };
  }

  private async buildReviewPayload(matchId: string, matchStatus: MatchStatus) {
    if (matchStatus !== MatchStatus.FINISHED) {
      return {
        status: 'waiting_for_result',
        message: '比赛结束后开放复盘。',
        reviews: [],
        summary: null,
      };
    }

    const reviews = await this.prisma.modelReview.findMany({
      where: { matchId },
      include: { aiModel: true },
      orderBy: { createdAt: 'asc' },
    });

    if (reviews.length === 0) {
      return {
        status: 'pending_generation',
        message: '赛果已确认，复盘生成中...',
        reviews: [],
        summary: null,
      };
    }

    const publishedReviews = reviews.filter((r) => r.status === 'PUBLISHED');
    const allPublished = publishedReviews.length === reviews.length;
    const hasGenerating = reviews.some((r) => r.status === 'GENERATING');

    let status: string;
    if (allPublished) {
      status = 'published';
    } else if (hasGenerating) {
      status = 'generating';
    } else if (publishedReviews.length > 0) {
      status = 'partial';
    } else {
      status = 'pending_generation';
    }

    // 计算平均评分
    const grades = publishedReviews
      .map((r) => (r.structuredOutput as Record<string, unknown>)?.grade as string)
      .filter(Boolean);
    const gradeValues: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
    let averageGrade: string | null = null;
    if (grades.length > 0) {
      const avg = grades.reduce((sum, g) => sum + (gradeValues[g] ?? 0), 0) / grades.length;
      if (avg >= 4.5) averageGrade = 'A';
      else if (avg >= 3.5) averageGrade = 'B';
      else if (avg >= 2.5) averageGrade = 'C';
      else if (avg >= 1.5) averageGrade = 'D';
      else averageGrade = 'F';
    }

    return {
      status,
      message: allPublished ? '复盘已发布' : hasGenerating ? '复盘生成中...' : '部分复盘已发布',
      reviews: reviews.map((r) => ({
        id: r.id,
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
        grade: (r.structuredOutput as Record<string, unknown>)?.grade ?? null,
        publishedAt: r.publishedAt?.toISOString() ?? null,
      })),
      summary: {
        totalModels: reviews.length,
        publishedCount: publishedReviews.length,
        averageGrade,
      },
    };
  }

  private extractConsensusHint(value: unknown): string | null {
    if (typeof value === 'object' && value && 'highlight' in value && typeof value.highlight === 'string') {
      return value.highlight;
    }
    if (typeof value === 'object' && value && 'majorityResult' in value && typeof value.majorityResult === 'string') {
      return `多数模型倾向：${value.majorityResult}`;
    }
    return null;
  }

  private extractConsensusHighlight(value: unknown): string {
    return this.extractConsensusHint(value) ?? '模型分析已保存，完整内容将在预测生产线阶段逐步开放。';
  }

  private toUserPrediction(prediction: UserPrediction) {
    return {
      id: prediction.id,
      matchId: prediction.matchId,
      userId: prediction.userId,
      guestId: prediction.guestId,
      prediction: prediction.prediction,
      homeScore: prediction.homeScore,
      awayScore: prediction.awayScore,
      goalsMin: prediction.goalsMin,
      goalsMax: prediction.goalsMax,
      submittedAt: prediction.submittedAt.toISOString(),
      updatedAt: prediction.updatedAt.toISOString(),
    };
  }

  private async buildAccessPayload(matchId: string, userId?: string, guestId?: string) {
    const decision = await this.accessService.checkAccess(userId, guestId, matchId);
    const teaserData = decision.canViewFullModels ? null : await this.buildTeaserData(matchId);

    return {
      canViewBasic: true,
      canViewFullModels: decision.canViewFullModels,
      reason: decision.reason,
      unlockHint: decision.unlockHint,
      snapshot: decision.snapshot,
      teaserData,
    };
  }

  private async buildTeaserData(matchId: string): Promise<TeaserData | null> {
    const task = await this.prisma.predictionTask.findFirst({
      where: { matchId, status: { in: ['PUBLISHED', 'REVIEWED', 'SUCCEEDED'] } },
      include: {
        predictions: {
          where: { isSuccess: true },
          include: { aiModel: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    });

    if (!task) return null;

    const summary = task.consensusSummary as Record<string, unknown> | null;
    const sharedKeyVariables = Array.isArray(summary?.sharedKeyVariables) ? summary.sharedKeyVariables : [];

    return {
      modelCount: task.predictions.length,
      keyVarCount: sharedKeyVariables.length,
      hasHighConsensus: task.consensusLevel === 'HIGH',
      modelNames: task.predictions.map((prediction) => prediction.aiModel.displayName),
      consensusLevel: task.consensusLevel,
    };
  }
}

const TEAM_NAME_ZH: Record<string, string> = {
  argentina: '阿根廷', australia: '澳大利亚', belgium: '比利时', brazil: '巴西', canada: '加拿大', chile: '智利', china: '中国', colombia: '哥伦比亚', croatia: '克罗地亚', denmark: '丹麦', ecuador: '厄瓜多尔', england: '英格兰', france: '法国', germany: '德国', ghana: '加纳', italy: '意大利', japan: '日本', mexico: '墨西哥', morocco: '摩洛哥', netherlands: '荷兰', poland: '波兰', portugal: '葡萄牙', qatar: '卡塔尔', senegal: '塞内加尔', serbia: '塞尔维亚', spain: '西班牙', switzerland: '瑞士', uruguay: '乌拉圭', usa: '美国', 'united states': '美国', 'united states of america': '美国',
  'real madrid': '皇家马德里', barcelona: '巴塞罗那', 'fc barcelona': '巴塞罗那', 'manchester city': '曼城', 'manchester united': '曼联', liverpool: '利物浦', arsenal: '阿森纳', chelsea: '切尔西', 'bayern munich': '拜仁慕尼黑', 'borussia dortmund': '多特蒙德', 'paris saint germain': '巴黎圣日耳曼', psg: '巴黎圣日耳曼', juventus: '尤文图斯', 'inter milan': '国际米兰', 'ac milan': 'AC米兰', napoli: '那不勒斯', 'atletico madrid': '马德里竞技',
};

const COMPETITION_NAME_ZH: Record<string, string> = {
  'fifa world cup': '世界杯', 'world cup': '世界杯', 'club world cup': '世俱杯', 'fifa club world cup': '世俱杯', 'uefa champions league': '欧冠', 'champions league': '欧冠', 'uefa europa league': '欧联杯', 'europa league': '欧联杯', 'premier league': '英超', 'la liga': '西甲', 'serie a': '意甲', bundesliga: '德甲', 'ligue 1': '法甲', 'major league soccer': '美职联', mls: '美职联', 'fa cup': '英格兰足总杯', 'copa del rey': '国王杯', 'copa america': '美洲杯', euro: '欧洲杯', 'uefa euro': '欧洲杯',
};

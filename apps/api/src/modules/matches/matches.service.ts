import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import type { Match, UserPrediction , PredictionTaskStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { RequestMeta } from '../auth/auth.service.js';
import { AccessService } from '../entitlements/access.service.js';

import type { MatchListQueryDto, UserPredictionSubmitDto } from './matches.schemas.js';

@Injectable()
export class MatchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService,
    private readonly accessService: AccessService,
  ) {}

  async listMatches(query: MatchListQueryDto) {
    const where = {
      ...(query.competitionId ? { competitionId: query.competitionId } : {}),
      ...(query.matchday ? { matchday: query.matchday } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

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
        orderBy: { kickoffAt: 'asc' },
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

    const userPrediction = await this.findViewerPrediction(matchId, viewer.userId, viewer.guestId);

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
        access: await this.buildAccessPayload(match.id, viewer.userId, viewer.guestId),
        consensus: this.buildConsensus(match.predictionTasks),
        modelAnalyses: match.predictionTasks.flatMap((task) =>
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
            generatedAt: prediction.createdAt.toISOString(),
          })),
        ),
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

  private toMatchSummary(match: Match & { competition: { id: string; code: string; name: string; season: string }; homeTeam: { id: string; code: string; name: string; shortName: string | null; countryCode: string | null; crestUrl: string | null }; awayTeam: { id: string; code: string; name: string; shortName: string | null; countryCode: string | null; crestUrl: string | null }; predictionTasks?: Array<{ status: PredictionTaskStatus; consensusLevel: string | null; consensusSummary: unknown }> }) {
    const latestTask = match.predictionTasks?.[0];
    return {
      id: match.id,
      competitionId: match.competitionId,
      competition: match.competition,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt.toISOString(),
      status: match.status,
      matchday: match.matchday,
      stage: match.stage,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      aiStatus: latestTask?.status ?? 'PENDING',
      consensusLevel: latestTask?.consensusLevel ?? null,
      consensusHint: this.extractConsensusHint(latestTask?.consensusSummary),
      unlockState: 'basic_available',
    };
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

    return {
      status: 'published',
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
    return {
      canViewBasic: true,
      canViewFullModels: decision.canViewFullModels,
      reason: decision.reason,
      unlockHint: decision.unlockHint,
      snapshot: decision.snapshot,
    };
  }
}

import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MatchStatus, PredictionTaskStatus } from '@prisma/client';
import type { Match, UserPrediction } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { RequestMeta } from '../auth/auth.service.js';

import type { MatchListQueryDto, UserPredictionSubmitDto } from './matches.schemas.js';

@Injectable()
export class MatchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService,
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
        access: {
          canViewBasic: true,
          canViewFullModels: false,
          reason: 'phase_2_basic_skeleton',
        },
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
        review: {
          status: match.status === MatchStatus.FINISHED ? 'pending_generation' : 'waiting_for_result',
          message: match.status === MatchStatus.FINISHED ? '赛果确认后将生成复盘。' : '比赛结束后开放复盘。',
        },
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

    return {
      status: 'published',
      title: this.extractConsensusHint(published.consensusSummary) ?? 'AI 共识已发布',
      highlight: this.extractConsensusHighlight(published.consensusSummary),
      modelCount,
      successCount,
      level: published.consensusLevel,
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
}

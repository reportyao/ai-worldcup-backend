import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

import type {
  PredictionCardData} from './share-image.renderer.js';
import {
  buildCacheKey,
  readFromCache,
  renderPredictionCard,
  writeToCache,
} from './share-image.renderer.js';

@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成预测卡图片（带缓存）
   * @param matchId 比赛 ID
   * @param userId 用户 ID（可选，游客也可生成）
   * @param guestId 游客 ID（可选）
   * @param inviteCode 邀请码（可选，用于引流）
   */
  async generatePredictionCard(
    matchId: string,
    userId?: string,
    guestId?: string,
    inviteCode?: string,
  ): Promise<{ buffer: Buffer; contentType: string; cacheKey: string }> {
    // 1. 查询比赛信息
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        competition: true,
        homeTeam: true,
        awayTeam: true,
        predictionTasks: {
          where: { status: { in: ['PUBLISHED', 'REVIEWED', 'SUCCEEDED'] } },
          orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
          take: 1,
        },
      },
    });

    if (!match) {
      throw new NotFoundException(`比赛 ${matchId} 不存在`);
    }

    // 2. 查询用户预测
    let userPrediction = null;
    let userNickname: string | null = null;

    if (userId) {
      userPrediction = await this.prisma.userPrediction.findUnique({
        where: { matchId_userId: { matchId, userId } },
      });
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { nickname: true },
      });
      userNickname = user?.nickname ?? null;
    } else if (guestId) {
      userPrediction = await this.prisma.userPrediction.findUnique({
        where: { matchId_guestId: { matchId, guestId } },
      });
      userNickname = '匿名球迷';
    }

    // 3. 提取 AI 共识
    const latestTask = match.predictionTasks[0];
    let aiConsensus: string | null = null;
    let consensusLevel: string | null = null;

    if (latestTask) {
      consensusLevel = latestTask.consensusLevel;
      const summary = latestTask.consensusSummary as Record<string, unknown> | null;
      if (summary) {
        aiConsensus =
          (summary.highlight as string) ??
          (summary.majorityResult
            ? `多数模型倾向：${summary.majorityResult}`
            : null);
      }
    }

    // 4. 组装渲染数据
    const cardData: PredictionCardData = {
      homeTeam: {
        name: match.homeTeam.name,
        shortName: match.homeTeam.shortName ?? match.homeTeam.code,
        countryCode: match.homeTeam.countryCode,
        crestUrl: match.homeTeam.crestUrl,
      },
      awayTeam: {
        name: match.awayTeam.name,
        shortName: match.awayTeam.shortName ?? match.awayTeam.code,
        countryCode: match.awayTeam.countryCode,
        crestUrl: match.awayTeam.crestUrl,
      },
      kickoffAt: match.kickoffAt.toISOString(),
      competitionName: match.competition.name,
      stage: match.stage,
      userPrediction: userPrediction?.prediction ?? 'DRAW',
      predictedScore: {
        home: userPrediction?.homeScore ?? 0,
        away: userPrediction?.awayScore ?? 0,
      },
      aiConsensus,
      consensusLevel,
      userNickname,
      actualScore:
        match.homeScore !== null && match.awayScore !== null
          ? { home: match.homeScore, away: match.awayScore }
          : null,
      inviteCode: inviteCode ?? null,
    };

    // 5. 检查缓存
    const cacheKey = buildCacheKey(cardData);
    const cached = readFromCache(cacheKey);
    if (cached) {
      this.logger.debug(`Share card cache hit: ${cacheKey}`);
      return { buffer: cached, contentType: 'image/png', cacheKey };
    }

    // 6. 渲染图片
    this.logger.log(`Rendering share card for match ${matchId}, user ${userId ?? guestId ?? 'anon'}`);
    const startTime = Date.now();
    const buffer = await renderPredictionCard(cardData);
    const elapsed = Date.now() - startTime;
    this.logger.log(`Share card rendered in ${elapsed}ms, size=${buffer.length} bytes`);

    // 7. 写入缓存
    writeToCache(cacheKey, buffer);

    return { buffer, contentType: 'image/png', cacheKey };
  }

  /**
   * 获取分享卡片元数据（用于前端 og:image 等）
   */
  async getShareMeta(matchId: string): Promise<{
    title: string;
    description: string;
    imageUrl: string;
    homeTeam: string;
    awayTeam: string;
    kickoffAt: string;
  }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });

    if (!match) {
      throw new NotFoundException(`比赛 ${matchId} 不存在`);
    }

    const homeShort = match.homeTeam.shortName ?? match.homeTeam.code;
    const awayShort = match.awayTeam.shortName ?? match.awayTeam.code;
    const kickoffStr = new Date(match.kickoffAt).toLocaleString('zh-CN', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai',
    });

    return {
      title: `${homeShort} vs ${awayShort} | AI World Cup 预测`,
      description: `${match.competition.name} · ${kickoffStr} · 查看 AI 多模型预测分析`,
      imageUrl: `/share/card/${matchId}`,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoffAt: match.kickoffAt.toISOString(),
    };
  }
}

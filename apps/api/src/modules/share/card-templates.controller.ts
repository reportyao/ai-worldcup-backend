import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import {
  buildCardCacheKey,
  isContentSafe,
  readCardFromCache,
  renderReviewCard,
  renderRoastCard,
  type ReviewCardData,
  type RoastCardData,
  sanitizeContent,
  selectReviewTemplate,
  selectRoastTemplate,
  writeCardToCache,
} from './card-templates.js';

/**
 * T6-03: 毒舌卡与复盘卡 Controller
 *
 * - GET /share/roast/:matchId   生成毒舌卡
 * - GET /share/review/:matchId  生成复盘卡
 */
@Controller('share')
export class CardTemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * GET /share/roast/:matchId
   * 生成毒舌/甩锅卡图片
   */
  @Get('roast/:matchId')
  async getRoastCard(
    @Param('matchId') matchId: string,
    @Query('invite') inviteCode: string | undefined,
    @Query('locale') locale: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const resolvedLocale = (locale === 'en' ? 'en' : 'zh_CN') as 'zh_CN' | 'en';

    // 查询比赛和预测数据
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
          include: {
            predictions: {
              where: { isSuccess: true },
              include: { aiModel: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const task = match.predictionTasks[0];
    const prediction = task?.predictions[0];
    const model = prediction?.aiModel;

    // 选择毒舌文案
    const consensusSummary = task?.consensusSummary as Record<string, unknown> | null;
    const majorityResult = (consensusSummary?.majorityResult as string) ?? null;

    const homeShort = match.homeTeam.shortName ?? match.homeTeam.code;
    const awayShort = match.awayTeam.shortName ?? match.awayTeam.code;

    const { title: roastTitle } = selectRoastTemplate({
      consensusLevel: task?.consensusLevel ?? null,
      majorityResult,
      homeTeamName: homeShort,
      awayTeamName: awayShort,
      locale: resolvedLocale,
    });

    // 构建毒舌正文
    let roastBody = '';
    if (prediction?.structuredOutput) {
      const structured = prediction.structuredOutput as Record<string, unknown>;
      const conclusion = structured.final_conclusion as Record<string, unknown> | undefined;
      if (conclusion) {
        const probs = conclusion.win_draw_loss_probabilities as Record<string, number> | undefined;
        if (probs) {
          roastBody =
            resolvedLocale === 'en'
              ? `AI gives ${homeShort} a ${Math.round((probs.home_win ?? 0) * 100)}% chance. ${awayShort}? Only ${Math.round((probs.away_win ?? 0) * 100)}%. Make of that what you will.`
              : `AI 给 ${homeShort} ${Math.round((probs.home_win ?? 0) * 100)}% 的胜率，${awayShort} 只有 ${Math.round((probs.away_win ?? 0) * 100)}%。懂的都懂。`;
        }
      }
    }
    if (!roastBody) {
      roastBody =
        resolvedLocale === 'en'
          ? 'AI has spoken. The models have made their choice. Do you dare to disagree?'
          : 'AI 已经表态了，模型们做出了选择。你敢不同意吗？';
    }

    // 安全检查
    const safeTitle = isContentSafe(roastTitle, resolvedLocale)
      ? roastTitle
      : sanitizeContent(roastTitle, resolvedLocale);
    const safeBody = isContentSafe(roastBody, resolvedLocale)
      ? roastBody
      : sanitizeContent(roastBody, resolvedLocale);

    const cardData: RoastCardData = {
      homeTeam: {
        name: match.homeTeam.name,
        shortName: homeShort,
        countryCode: match.homeTeam.countryCode,
      },
      awayTeam: {
        name: match.awayTeam.name,
        shortName: awayShort,
        countryCode: match.awayTeam.countryCode,
      },
      kickoffAt: match.kickoffAt.toISOString(),
      competitionName: match.competition.name,
      roastTitle: safeTitle,
      roastBody: safeBody,
      modelName: model?.displayName ?? 'AI Ensemble',
      modelPersona: model?.persona ?? 'STEADY',
      consensusDirection: majorityResult,
      inviteCode,
      locale: resolvedLocale,
    };

    // 缓存检查
    const cacheKey = buildCardCacheKey('roast', cardData);
    const cached = readCardFromCache(cacheKey);
    if (cached) {
      this.sendImage(res, cached, cacheKey, req);
      return;
    }

    // 渲染
    const buffer = await renderRoastCard(cardData);
    writeCardToCache(cacheKey, buffer);
    this.sendImage(res, buffer, cacheKey, req);
  }

  /**
   * GET /share/review/:matchId
   * 生成复盘卡图片（封神榜/打脸榜）
   */
  @Get('review/:matchId')
  async getReviewCard(
    @Param('matchId') matchId: string,
    @Query('modelId') modelId: string | undefined,
    @Query('invite') inviteCode: string | undefined,
    @Query('locale') locale: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const resolvedLocale = (locale === 'en' ? 'en' : 'zh_CN') as 'zh_CN' | 'en';

    // 查询比赛和复盘数据
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        competition: true,
        homeTeam: true,
        awayTeam: true,
        modelReviews: {
          where: modelId ? { aiModelId: modelId } : { status: 'PUBLISHED' },
          include: { aiModel: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!match || match.homeScore === null || match.awayScore === null) {
      res.status(404).json({ error: 'Match not found or not finished' });
      return;
    }

    const review = match.modelReviews[0];
    if (!review) {
      res.status(404).json({ error: 'No review available' });
      return;
    }

    const model = review.aiModel;
    const accuracyJson = review.accuracyJson as Record<string, unknown> | null;
    const structuredOutput = review.structuredOutput as Record<string, unknown> | null;

    // 判断封神还是打脸
    const winDrawLossCorrect = (accuracyJson?.winDrawLossCorrect as boolean) ?? false;
    const scoreExact = (accuracyJson?.scoreExact as boolean) ?? false;
    const reviewType: 'GLORY' | 'SHAME' = winDrawLossCorrect ? 'GLORY' : 'SHAME';

    // 提取命中项和错误项
    const hitItems: string[] = [];
    const missItems: string[] = [];

    if (winDrawLossCorrect) {
      hitItems.push(resolvedLocale === 'en' ? 'Win/Draw/Loss correct' : '胜平负命中');
    } else {
      missItems.push(resolvedLocale === 'en' ? 'Win/Draw/Loss wrong' : '胜平负错误');
    }
    if (scoreExact) {
      hitItems.push(resolvedLocale === 'en' ? 'Exact score hit' : '比分精准命中');
    }
    if (accuracyJson?.goalRangeHit) {
      hitItems.push(resolvedLocale === 'en' ? 'Goal range correct' : '进球区间命中');
    } else {
      missItems.push(resolvedLocale === 'en' ? 'Goal range missed' : '进球区间错误');
    }

    const homeShort = match.homeTeam.shortName ?? match.homeTeam.code;
    const awayShort = match.awayTeam.shortName ?? match.awayTeam.code;
    const scoreStr = `${match.homeScore}-${match.awayScore}`;

    const reviewTitle = selectReviewTemplate({
      reviewType,
      modelName: model.displayName,
      score: scoreStr,
      locale: resolvedLocale,
    });

    const reviewSummary =
      (structuredOutput?.summary as string) ??
      (resolvedLocale === 'en'
        ? `${model.displayName} ${reviewType === 'GLORY' ? 'nailed' : 'missed'} this prediction for ${homeShort} vs ${awayShort}.`
        : `${model.displayName} 对 ${homeShort} vs ${awayShort} 的预测${reviewType === 'GLORY' ? '精准命中' : '出现偏差'}。`);

    const cardData: ReviewCardData = {
      homeTeam: {
        name: match.homeTeam.name,
        shortName: homeShort,
        countryCode: match.homeTeam.countryCode,
      },
      awayTeam: {
        name: match.awayTeam.name,
        shortName: awayShort,
        countryCode: match.awayTeam.countryCode,
      },
      actualScore: { home: match.homeScore!, away: match.awayScore! },
      competitionName: match.competition.name,
      reviewType,
      modelName: model.displayName,
      modelPersona: model.persona,
      predictedResult: (accuracyJson?.predictedResult as string) ?? 'N/A',
      hitItems,
      missItems,
      reviewTitle,
      reviewSummary,
      accuracy: accuracyJson?.overallGrade
        ? `${resolvedLocale === 'en' ? 'Grade: ' : '评级：'}${accuracyJson.overallGrade}`
        : null,
      inviteCode,
      locale: resolvedLocale,
    };

    // 缓存
    const cacheKey = buildCardCacheKey('review', cardData);
    const cached = readCardFromCache(cacheKey);
    if (cached) {
      this.sendImage(res, cached, cacheKey, req);
      return;
    }

    const buffer = await renderReviewCard(cardData);
    writeCardToCache(cacheKey, buffer);
    this.sendImage(res, buffer, cacheKey, req);
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private sendImage(res: Response, buffer: Buffer, cacheKey: string, req: Request) {
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=600',
      ETag: `"${cacheKey}"`,
    });
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === `"${cacheKey}"`) {
      res.status(304).end();
      return;
    }
    res.status(200).send(buffer);
  }
}

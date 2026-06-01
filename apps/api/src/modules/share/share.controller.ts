import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { AuthService } from '../auth/auth.service.js';

import type { ShareService } from './share.service.js';

@Controller('share')
export class ShareController {
  constructor(
    private readonly shareService: ShareService,
    private readonly authService: AuthService,
  ) {}

  /**
   * GET /share/card/:matchId
   * 生成并返回预测卡图片（PNG）
   *
   * Query params:
   *   - invite: 邀请码（可选）
   */
  @Get('card/:matchId')
  async getCard(
    @Param('matchId') matchId: string,
    @Query('invite') inviteCode: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    const viewer = await this.authService.resolveViewer(accessToken, guestToken);

    const { buffer, contentType, cacheKey } = await this.shareService.generatePredictionCard(
      matchId,
      viewer.userId,
      viewer.guestId,
      inviteCode,
    );

    res.set({
      'Content-Type': contentType,
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300', // 5 分钟浏览器缓存
      'ETag': `"${cacheKey}"`,
      'X-Cache-Key': cacheKey,
    });

    // 支持条件请求
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === `"${cacheKey}"`) {
      res.status(304).end();
      return;
    }

    res.status(200).send(buffer);
  }

  /**
   * GET /share/meta/:matchId
   * 获取分享元数据（用于 og:image 等）
   */
  @Get('meta/:matchId')
  async getMeta(@Param('matchId') matchId: string) {
    return this.shareService.getShareMeta(matchId);
  }
}

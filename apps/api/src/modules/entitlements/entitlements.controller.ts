import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthService } from '../auth/auth.service.js';

import type { AccessService } from './access.service.js';

@Controller('entitlements')
export class EntitlementsController {
  constructor(
    private readonly accessService: AccessService,
    private readonly authService: AuthService,
  ) {}

  /**
   * GET /entitlements/snapshot
   * 获取当前用户/游客的权益快照
   */
  @Get('snapshot')
  async getSnapshot(@Req() req: Request) {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    const viewer = await this.authService.resolveViewer(accessToken, guestToken);

    const snapshot = await this.accessService.getSnapshot(
      viewer.userId,
      viewer.guestId,
    );

    return snapshot;
  }

  /**
   * GET /entitlements/check-access
   * 检查当前用户/游客是否有权查看完整模型分析
   */
  @Get('check-access')
  async checkAccess(@Req() req: Request, @Query('matchId') matchId?: string) {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    const viewer = await this.authService.resolveViewer(accessToken, guestToken);

    const decision = await this.accessService.checkAccess(
      viewer.userId,
      viewer.guestId,
      matchId,
    );

    return decision;
  }

  /**
   * POST /entitlements/consume
   * 消费一次权益（查看模型分析时调用）
   */
  @Post('consume')
  async consume(@Req() req: Request, @Body() body: { matchId?: string }) {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    const viewer = await this.authService.resolveViewer(accessToken, guestToken);

    const consumed = await this.accessService.consumeOne(
      viewer.userId,
      viewer.guestId,
      body?.matchId,
    );

    if (!consumed) {
      return {
        consumed: false,
        message: '权益额度不足，请邀请好友或购买 Pass',
      };
    }

    const snapshot = await this.accessService.getSnapshot(
      viewer.userId,
      viewer.guestId,
    );

    return { consumed: true, snapshot };
  }
}

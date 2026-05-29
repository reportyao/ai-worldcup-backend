import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { ShareAttributionService } from './share-attribution.service.js';

/**
 * T6-02: 小程序码与分享归因 Controller
 *
 * 提供：
 * - POST /share/track       创建分享追踪（生成 scene 值）
 * - GET  /share/wxacode/:scene  获取小程序码
 * - POST /share/attribution  新用户注册时绑定归因
 * - POST /share/view         记录分享浏览
 * - GET  /share/stats        获取用户分享统计
 */
@Controller('share')
export class ShareAttributionController {
  constructor(
    private readonly attributionService: ShareAttributionService,
    private readonly authService: AuthService,
  ) {}

  /**
   * POST /share/track
   * 创建分享追踪记录，返回 scene 值和分享 URL
   */
  @Post('track')
  async createTrack(
    @Req() req: Request,
    @Body()
    body: {
      matchId?: string;
      channel?: string;
      templateType?: string;
      inviteCode?: string;
    },
  ) {
    const viewer = await this.resolveViewer(req);
    return this.attributionService.createShareTrack({
      userId: viewer.userId ?? undefined,
      guestId: viewer.guestId ?? undefined,
      matchId: body.matchId,
      channel: body.channel,
      templateType: body.templateType,
      inviteCode: body.inviteCode,
    });
  }

  /**
   * GET /share/wxacode/:scene
   * 获取小程序码图片
   */
  @Get('wxacode/:scene')
  async getWxacode(
    @Param('scene') scene: string,
    @Query('page') page?: string,
    @Query('width') width?: string,
  ) {
    const result = await this.attributionService.getWxacode({
      scene,
      page,
      width: width ? parseInt(width, 10) : undefined,
    });

    // 如果有 buffer，直接返回图片
    if (result.imageBuffer) {
      return {
        imageUrl: result.imageUrl,
        scene: result.scene,
        hasImage: true,
      };
    }

    return {
      imageUrl: result.imageUrl,
      scene: result.scene,
      hasImage: false,
    };
  }

  /**
   * POST /share/attribution
   * 新用户注册时绑定分享归因
   * 通常由 AuthService 在注册流程中内部调用，也可由前端显式调用
   */
  @Post('attribution')
  async bindAttribution(
    @Req() req: Request,
    @Body()
    body: {
      sceneValue?: string;
      inviteCode?: string;
      channel?: string;
    },
  ) {
    const viewer = await this.resolveViewer(req);
    if (!viewer.userId) {
      return { bound: false, message: '需要登录后才能绑定归因' };
    }

    return this.attributionService.bindAttribution({
      newUserId: viewer.userId,
      sceneValue: body.sceneValue,
      inviteCode: body.inviteCode,
      channel: body.channel,
    });
  }

  /**
   * POST /share/view
   * 记录分享浏览（用户扫描小程序码后前端调用）
   */
  @Post('view')
  async recordView(@Body() body: { sceneValue: string }) {
    if (!body.sceneValue) {
      return { success: false, message: 'sceneValue is required' };
    }
    await this.attributionService.recordView(body.sceneValue);
    return { success: true };
  }

  /**
   * GET /share/stats
   * 获取当前用户的分享统计
   */
  @Get('stats')
  async getStats(@Req() req: Request) {
    const viewer = await this.resolveViewer(req);
    if (!viewer.userId) {
      return {
        totalShares: 0,
        totalViews: 0,
        totalBinds: 0,
        recentShares: [],
      };
    }
    return this.attributionService.getUserShareStats(viewer.userId);
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async resolveViewer(req: Request) {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    return this.authService.resolveViewer(accessToken, guestToken);
  }
}

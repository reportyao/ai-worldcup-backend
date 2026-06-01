import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { AuthService } from '../auth/auth.service.js';

import type { InvitationsService } from './invitations.service.js';

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly authService: AuthService,
  ) {}

  /**
   * GET /invitations/my-code
   * 获取或自动创建用户的固定邀请码（需要登录）
   */
  @Get('my-code')
  async myCode(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return this.invitationsService.getOrCreateMyCode(userId);
  }

  /**
   * POST /invitations/accept
   * 接受邀请码（被邀请人调用，需要登录）
   * 固定码逻辑：通过邀请码找到邀请人，创建新的邀请记录
   */
  @Post('accept')
  async accept(@Req() req: Request, @Body() body: { code: string }) {
    const userId = await this.requireUserId(req);
    if (!body.code || typeof body.code !== 'string') {
      throw new UnauthorizedException('邀请码不能为空');
    }
    return this.invitationsService.acceptInvitation(body.code.trim().toUpperCase(), userId);
  }

  /**
   * GET /invitations/mine
   * 获取我的邀请统计和历史（需要登录）
   */
  @Get('mine')
  async mine(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return this.invitationsService.getMyInvitations(userId);
  }

  /**
   * GET /invitations/validate/:code
   * 验证邀请码是否有效（无需登录）
   */
  @Get('validate/:code')
  async validate(@Param('code') code: string) {
    return this.invitationsService.validateCode(code.trim().toUpperCase());
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async requireUserId(req: Request): Promise<string> {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    if (!accessToken) {
      throw new UnauthorizedException('请先登录');
    }
    const viewer = await this.authService.resolveViewer(accessToken);
    if (!viewer.userId) {
      throw new UnauthorizedException('请先登录');
    }
    return viewer.userId;
  }
}

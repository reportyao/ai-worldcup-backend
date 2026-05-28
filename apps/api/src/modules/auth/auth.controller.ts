import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';

import {
  GuestIdentifySchema,
  type GuestIdentifyDto,
  WechatLoginSchema,
  type WechatLoginDto,
} from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('guest')
  identifyGuest(
    @Req() req: Request,
    @Body(new ZodValidationPipe(GuestIdentifySchema)) dto: GuestIdentifyDto,
  ) {
    return this.authService.identifyGuest(dto, this.getRequestMeta(req));
  }

  @Post('wechat/login')
  loginWithWechat(
    @Req() req: Request,
    @Body(new ZodValidationPipe(WechatLoginSchema)) dto: WechatLoginDto,
  ) {
    return this.authService.loginWithWechat(dto, this.getRequestMeta(req));
  }

  @Get('me')
  getMe(@Headers('authorization') authorization?: string, @Headers('x-guest-token') guestToken?: string) {
    return this.authService.getMe(this.authService.extractBearerToken(authorization), guestToken);
  }

  private getRequestMeta(req: Request) {
    return {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }
}

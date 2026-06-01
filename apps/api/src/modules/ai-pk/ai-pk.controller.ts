import { Body, Controller, Get, Param, Post, Query, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthService } from '../auth/auth.service.js';

import { AiPkService } from './ai-pk.service.js';
import { AiPkCreateSessionSchema, type AiPkCreateSessionDto } from './ai-pk.schemas.js';

@Controller('ai-pk')
export class AiPkController {
  constructor(
    private readonly aiPkService: AiPkService,
    private readonly authService: AuthService,
  ) {}

  @Post('sessions')
  @UsePipes(new ZodValidationPipe(AiPkCreateSessionSchema))
  async createSession(@Body() dto: AiPkCreateSessionDto, @Req() req: Request) {
    const viewer = await this.resolveViewer(req);
    return this.aiPkService.createSession(dto, viewer);
  }

  @Get('sessions/mine')
  async getMine(@Req() req: Request, @Query('take') take?: string) {
    const viewer = await this.resolveViewer(req);
    return {
      sessions: await this.aiPkService.getMine(viewer, take ? Number(take) : 20),
    };
  }

  @Get('sessions/:id')
  async getSession(@Param('id') id: string) {
    return this.aiPkService.getSession(id);
  }

  private async resolveViewer(req: Request) {
    const accessToken = this.authService.extractBearerToken(req.headers.authorization);
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    return this.authService.resolveViewer(accessToken, guestToken);
  }
}

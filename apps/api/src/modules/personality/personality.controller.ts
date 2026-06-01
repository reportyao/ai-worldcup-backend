import { Body, Controller, Get, Param, Post, Query, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthService } from '../auth/auth.service.js';

import { PersonalityService } from './personality.service.js';
import {
  PersonalityQuestionUpsertSchema,
  PersonalitySubmitSchema,
  type PersonalityQuestionUpsertDto,
  type PersonalitySubmitDto,
} from './personality.schemas.js';

@Controller('personality-test')
export class PersonalityController {
  constructor(
    private readonly personalityService: PersonalityService,
    private readonly authService: AuthService,
  ) {}

  @Get('questions')
  async getQuestions(@Query('activityKey') activityKey?: string) {
    return {
      activityKey: activityKey ?? 'worldcup_personality_2026',
      questions: await this.personalityService.getQuestions(activityKey),
    };
  }

  @Get('archetypes')
  getArchetypes() {
    return { archetypes: this.personalityService.getArchetypes() };
  }

  @Post('submit')
  @UsePipes(new ZodValidationPipe(PersonalitySubmitSchema))
  async submit(@Body() dto: PersonalitySubmitDto, @Req() req: Request) {
    const viewer = await this.resolveViewer(req);
    return this.personalityService.submit(dto, viewer);
  }

  @Get('mine')
  async getMine(@Req() req: Request) {
    const viewer = await this.resolveViewer(req);
    return { result: await this.personalityService.getMine(viewer) };
  }

  @Get('results/:id')
  async getResult(@Param('id') id: string) {
    return this.personalityService.getResult(id);
  }

  @Get('admin/questions')
  async listAdminQuestions(@Query('activityKey') activityKey?: string) {
    return {
      activityKey: activityKey ?? 'worldcup_personality_2026',
      questions: await this.personalityService.listAdminQuestions(activityKey),
    };
  }

  @Post('admin/questions')
  @UsePipes(new ZodValidationPipe(PersonalityQuestionUpsertSchema))
  async upsertQuestion(@Body() dto: PersonalityQuestionUpsertDto) {
    return this.personalityService.upsertQuestion(dto);
  }

  private async resolveViewer(req: Request) {
    const accessToken = this.authService.extractBearerToken(req.headers.authorization);
    const guestToken = req.headers['x-guest-token'] as string | undefined;
    return this.authService.resolveViewer(accessToken, guestToken);
  }
}

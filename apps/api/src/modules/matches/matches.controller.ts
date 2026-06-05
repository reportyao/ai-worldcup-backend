import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthService } from '../auth/auth.service.js';

import {
  MatchListQuerySchema,
  type MatchListQueryDto,
  UserPredictionSubmitSchema,
  type UserPredictionSubmitDto,
} from './matches.schemas.js';
import { MatchesService } from './matches.service.js';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  listMatches(@Query(new ZodValidationPipe(MatchListQuerySchema)) query: MatchListQueryDto) {
    return this.matchesService.listMatches(query);
  }

  @Get('stats/seven-days')
  getSevenDayStats() {
    return this.matchesService.getSevenDayStats();
  }

  @Get('stats/prediction-comparisons')
  getPredictionComparisons() {
    return this.matchesService.getPredictionComparisons();
  }

  @Get(':id')
  getMatch(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-guest-token') guestToken?: string,
  ) {
    return this.matchesService.getMatchDetail(id, this.authService.extractBearerToken(authorization), guestToken);
  }

  @Post(':id/user-predictions')
  submitPrediction(
    @Param('id') id: string,
    @Req() req: Request,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-guest-token') guestToken: string | undefined,
    @Body(new ZodValidationPipe(UserPredictionSubmitSchema)) dto: UserPredictionSubmitDto,
  ) {
    return this.matchesService.submitUserPrediction(
      id,
      dto,
      this.authService.extractBearerToken(authorization),
      guestToken,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
  }
}

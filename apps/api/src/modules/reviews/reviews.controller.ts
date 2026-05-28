import { Controller, Get, Param, NotFoundException } from '@nestjs/common';

import { ReviewsService } from './reviews.service.js';

/**
 * T4-03/T4-04/T4-05: 复盘与战绩 API
 *
 * Endpoints:
 * - GET /reviews/match/:matchId        获取比赛的所有模型复盘
 * - GET /reviews/model/:aiModelId/scorecard  获取模型战绩
 * - GET /reviews/leaderboard           获取模型排行榜
 */
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('match/:matchId')
  async getMatchReviews(@Param('matchId') matchId: string) {
    return this.reviewsService.getMatchReviews(matchId);
  }

  @Get('model/:aiModelId/scorecard')
  async getModelScorecard(@Param('aiModelId') aiModelId: string) {
    const scorecard = await this.reviewsService.getModelScorecard(aiModelId);
    if (!scorecard) {
      throw new NotFoundException('模型不存在');
    }
    return scorecard;
  }

  @Get('leaderboard')
  async getLeaderboard() {
    return this.reviewsService.getLeaderboard();
  }
}

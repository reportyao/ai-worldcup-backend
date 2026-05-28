import { Module } from '@nestjs/common';

import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/**
 * 阶段 4：赛后多模型复盘、模型战绩、排行榜聚合接口。
 */
@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}

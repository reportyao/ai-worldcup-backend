import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { TranslationService } from './translation.service.js';

/**
 * T6-05: AI 内容翻译 Controller
 *
 * - POST /translations/create       创建翻译任务
 * - POST /translations/batch        批量创建翻译任务
 * - POST /translations/:id/execute  执行翻译（Worker 调用）
 * - GET  /translations/:sourceType/:sourceId  获取翻译内容
 * - GET  /translations/pending      获取待翻译列表
 * - GET  /translations/stats        获取翻译统计
 * - POST /translations/:id/review   人工审核翻译
 */
@Controller('translations')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  /**
   * POST /translations/create
   * 创建单个翻译任务
   */
  @Post('create')
  async create(
    @Body()
    body: {
      sourceType: string;
      sourceId: string;
      locale?: string;
    },
  ) {
    return this.translationService.createTranslationJob({
      sourceType: body.sourceType,
      sourceId: body.sourceId,
      locale: body.locale ?? 'en',
    });
  }

  /**
   * POST /translations/batch
   * 批量创建翻译任务
   */
  @Post('batch')
  async batchCreate(
    @Body()
    body: {
      sourceType: string;
      sourceIds: string[];
      locale?: string;
    },
  ) {
    return this.translationService.batchCreateTranslations({
      sourceType: body.sourceType,
      sourceIds: body.sourceIds,
      locale: body.locale ?? 'en',
    });
  }

  /**
   * POST /translations/:id/execute
   * 执行翻译（由 Worker 或后台手动触发）
   */
  @Post(':id/execute')
  async execute(@Param('id') id: string) {
    return this.translationService.executeTranslation(id);
  }

  /**
   * GET /translations/:sourceType/:sourceId
   * 获取翻译内容
   */
  @Get(':sourceType/:sourceId')
  async getTranslation(
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
    @Query('locale') locale?: string,
  ) {
    return this.translationService.getTranslation({
      sourceType,
      sourceId,
      locale: locale ?? 'en',
    });
  }

  /**
   * GET /translations/pending
   * 获取待翻译任务列表
   */
  @Get('pending')
  async getPending(@Query('limit') limit?: string) {
    return this.translationService.getPendingTranslations(
      limit ? parseInt(limit, 10) : 10,
    );
  }

  /**
   * GET /translations/stats
   * 获取翻译统计
   */
  @Get('stats')
  async getStats() {
    return this.translationService.getTranslationStats();
  }

  /**
   * POST /translations/:id/review
   * 人工审核翻译
   */
  @Post(':id/review')
  async review(
    @Param('id') id: string,
    @Body()
    body: {
      reviewStatus: 'HUMAN_REVIEWED' | 'REJECTED';
      correctedJson?: unknown;
    },
  ) {
    return this.translationService.reviewTranslation(id, body);
  }
}

import { Module } from '@nestjs/common';
import { TranslationController } from './translation.controller.js';
import { TranslationService } from './translation.service.js';

/**
 * T6-05: AI 内容翻译模块
 *
 * 负责将中文结构化预测内容翻译为英文（或其他语言），
 * 支持批量翻译任务、人工审核和修正。
 */
@Module({
  controllers: [TranslationController],
  providers: [TranslationService],
  exports: [TranslationService],
})
export class TranslationModule {}

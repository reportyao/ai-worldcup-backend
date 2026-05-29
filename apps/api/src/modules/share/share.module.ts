import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { CardTemplatesController } from './card-templates.controller.js';
import { ShareAttributionController } from './share-attribution.controller.js';
import { ShareAttributionService } from './share-attribution.service.js';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

/**
 * T6-01: 分享图模板引擎模块。
 * T6-02: 小程序码与分享归因模块。
 * 使用 Node Canvas 渲染高质量预测卡图片（1080×1920 PNG）。
 * 支持：用户预测结果、AI 共识、邀请码引流、小程序码归因。
 */
@Module({
  imports: [AuthModule],
  controllers: [ShareController, ShareAttributionController, CardTemplatesController],
  providers: [ShareService, ShareAttributionService],
  exports: [ShareService, ShareAttributionService],
})
export class ShareModule {}

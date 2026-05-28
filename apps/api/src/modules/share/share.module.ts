import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

/**
 * T6-01: 分享图模板引擎模块。
 * 使用 Node Canvas 渲染高质量预测卡图片（1080×1920 PNG）。
 * 支持：用户预测结果、AI 共识、邀请码引流。
 */
@Module({
  imports: [AuthModule],
  controllers: [ShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}

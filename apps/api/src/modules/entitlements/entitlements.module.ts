import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { AccessService } from './access.service.js';
import { EntitlementsController } from './entitlements.controller.js';

/**
 * 权益模块：提供免费配额、邀请解锁、付费 Pass 综合权益判断。
 * T5-01: AccessService 实现权益判断核心逻辑。
 */
@Module({
  imports: [AuthModule],
  controllers: [EntitlementsController],
  providers: [AccessService],
  exports: [AccessService],
})
export class EntitlementsModule {}

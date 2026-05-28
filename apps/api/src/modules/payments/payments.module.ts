import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';

import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * T5-04/T5-05: 支付模块。
 * 提供微信支付 V3 下单、回调处理、会员发放功能。
 */
@Module({
  imports: [AuthModule, EntitlementsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

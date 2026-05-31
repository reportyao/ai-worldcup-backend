import { forwardRef, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';

import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

/**
 * T5-03: 邀请码和归因模块。
 * 提供邀请码生成、接受、验证和奖励发放功能。
 */
@Module({
  imports: [forwardRef(() => AuthModule), EntitlementsModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}

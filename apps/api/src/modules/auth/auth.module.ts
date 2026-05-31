import { forwardRef, Module } from '@nestjs/common';

import { InvitationsModule } from '../invitations/invitations.module.js';

import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [forwardRef(() => InvitationsModule)],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { AiPkController } from './ai-pk.controller.js';
import { AiPkService } from './ai-pk.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AiPkController],
  providers: [AiPkService],
  exports: [AiPkService],
})
export class AiPkModule {}

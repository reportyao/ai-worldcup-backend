import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { PersonalityController } from './personality.controller.js';
import { PersonalityService } from './personality.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PersonalityController],
  providers: [PersonalityService],
  exports: [PersonalityService],
})
export class PersonalityModule {}

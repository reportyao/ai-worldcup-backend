import { Module } from '@nestjs/common';

import { ScorecardService } from './scorecard.service.js';

@Module({
  providers: [ScorecardService],
  exports: [ScorecardService],
})
export class ScorecardModule {}

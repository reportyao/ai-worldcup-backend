import { Module } from '@nestjs/common';

import { ConsensusService } from './consensus.service.js';

@Module({
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}

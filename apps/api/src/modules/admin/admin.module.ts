import { Module } from '@nestjs/common';

import { PredictionPipelineModule } from '../prediction-pipeline/prediction-pipeline.module.js';
import { ConsensusModule } from '../consensus/consensus.module.js';

import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [PredictionPipelineModule, ConsensusModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

import { Module } from '@nestjs/common';

import { ConsensusModule } from '../consensus/consensus.module.js';
import { FootballDataModule } from '../football-data/football-data.module.js';
import { LindyPredictionModule } from '../lindy-prediction/lindy-prediction.module.js';
import { PredictionPipelineModule } from '../prediction-pipeline/prediction-pipeline.module.js';

import { AdminAuthGuard } from './admin-auth.guard.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [PredictionPipelineModule, ConsensusModule, FootballDataModule, LindyPredictionModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthGuard],
})
export class AdminModule {}

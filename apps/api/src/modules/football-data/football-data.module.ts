import { Module } from '@nestjs/common';

import { PredictionPipelineModule } from '../prediction-pipeline/prediction-pipeline.module.js';

import { ApiFootballClient } from './api-football.client.js';
import { FootballDataSyncService } from './football-data-sync.service.js';

@Module({
  imports: [PredictionPipelineModule],
  providers: [ApiFootballClient, FootballDataSyncService],
  exports: [ApiFootballClient, FootballDataSyncService],
})
export class FootballDataModule {}

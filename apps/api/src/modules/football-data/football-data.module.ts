import { Module } from '@nestjs/common';

import { PredictionPipelineModule } from '../prediction-pipeline/prediction-pipeline.module.js';

import { ApiFootballClient } from './api-football.client.js';
import { FootballDataSyncService } from './football-data-sync.service.js';
import { SportteryClient } from './sporttery.client.js';

@Module({
  imports: [PredictionPipelineModule],
  providers: [ApiFootballClient, SportteryClient, FootballDataSyncService],
  exports: [ApiFootballClient, SportteryClient, FootballDataSyncService],
})
export class FootballDataModule {}

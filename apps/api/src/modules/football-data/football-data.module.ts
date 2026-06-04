import { Module } from '@nestjs/common';

import { PredictionPipelineModule } from '../prediction-pipeline/prediction-pipeline.module.js';

import { ApiFootballClient } from './api-football.client.js';
import { CustomAiPredictionsController } from './custom-ai-predictions.controller.js';
import { FootballDataSyncService } from './football-data-sync.service.js';
import { FeijingAiPredictionService } from './feijing-ai-prediction.service.js';
import { SportteryClient } from './sporttery.client.js';

@Module({
  imports: [PredictionPipelineModule],
  controllers: [CustomAiPredictionsController],
  providers: [ApiFootballClient, SportteryClient, FootballDataSyncService, FeijingAiPredictionService],
  exports: [ApiFootballClient, SportteryClient, FootballDataSyncService, FeijingAiPredictionService],
})
export class FootballDataModule {}

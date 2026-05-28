import { Module } from '@nestjs/common';

import { PredictionPipelineService } from './prediction-pipeline.service.js';

@Module({
  providers: [PredictionPipelineService],
  exports: [PredictionPipelineService],
})
export class PredictionPipelineModule {}

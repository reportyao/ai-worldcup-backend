import { Module } from '@nestjs/common';
import { ConsensusModule } from '../consensus/consensus.module.js';
import { LindyPredictionController } from './lindy-prediction.controller.js';
import { LindyPredictionService } from './lindy-prediction.service.js';

@Module({
  imports: [ConsensusModule],
  controllers: [LindyPredictionController],
  providers: [LindyPredictionService],
  exports: [LindyPredictionService],
})
export class LindyPredictionModule {}

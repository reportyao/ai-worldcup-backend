import { Controller, Get, Query } from '@nestjs/common';

import { FeijingAiPredictionService } from './feijing-ai-prediction.service.js';

@Controller('custom-ai-predictions')
export class CustomAiPredictionsController {
  constructor(private readonly feijingAiPrediction: FeijingAiPredictionService) {}

  @Get()
  list(
    @Query('refresh') refresh?: string,
    @Query('includeUnmatched') includeUnmatched?: string,
    @Query('daysBefore') daysBefore?: string,
    @Query('daysAhead') daysAhead?: string,
  ) {
    return this.feijingAiPrediction.list({
      refresh: refresh === 'true' || refresh === '1',
      includeUnmatched: includeUnmatched === undefined ? true : includeUnmatched === 'true' || includeUnmatched === '1',
      daysBefore: daysBefore === undefined ? undefined : Number(daysBefore),
      daysAhead: daysAhead === undefined ? undefined : Number(daysAhead),
    });
  }
}

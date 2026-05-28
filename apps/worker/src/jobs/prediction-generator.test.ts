import { PredictionVersion } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { PredictionGeneratorPayloadSchema } from './prediction-generator.job.js';

describe('PredictionGeneratorPayloadSchema', () => {
  it('parses a valid direct payload with default trigger and rerun flag', () => {
    const parsed = PredictionGeneratorPayloadSchema.parse({
      matchId: 'm-1',
      version: PredictionVersion.T_MINUS_24H,
    });
    expect('matchId' in parsed && parsed.trigger).toBe('CRON');
    expect('matchId' in parsed && parsed.rerun).toBe(false);
  });

  it('parses a scheduler scan payload with default window', () => {
    const parsed = PredictionGeneratorPayloadSchema.parse({ mode: 'SCHEDULE_DUE' });
    expect('mode' in parsed && parsed.mode).toBe('SCHEDULE_DUE');
    expect('mode' in parsed && parsed.windowMinutes).toBe(10);
  });

  it('rejects invalid version', () => {
    expect(() =>
      PredictionGeneratorPayloadSchema.parse({
        matchId: 'm-1',
        version: 'BOGUS',
      }),
    ).toThrow();
  });
});

import { PredictionVersion } from '@ai-worldcup/shared';
import { describe, expect, it } from 'vitest';

import { PredictionGeneratorPayloadSchema } from './prediction-generator.job.js';

describe('PredictionGeneratorPayloadSchema', () => {
  it('parses a valid payload with default trigger', () => {
    const parsed = PredictionGeneratorPayloadSchema.parse({
      matchId: 'm-1',
      version: PredictionVersion.PRE_24H,
    });
    expect(parsed.trigger).toBe('CRON');
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

import { describe, expect, it } from 'vitest';

import { PredictionTaskStatus } from '../enums/index.js';

import { canTransitionPredictionTask } from './index.js';

describe('PredictionTask state machine', () => {
  it('allows PENDING -> RUNNING', () => {
    expect(
      canTransitionPredictionTask(PredictionTaskStatus.PENDING, PredictionTaskStatus.RUNNING),
    ).toBe(true);
  });

  it('disallows PENDING -> PUBLISHED', () => {
    expect(
      canTransitionPredictionTask(
        PredictionTaskStatus.PENDING,
        PredictionTaskStatus.PUBLISHED,
      ),
    ).toBe(false);
  });

  it('allows FAILED -> PENDING for retry', () => {
    expect(
      canTransitionPredictionTask(PredictionTaskStatus.FAILED, PredictionTaskStatus.PENDING),
    ).toBe(true);
  });

  it('disallows PUBLISHED -> anything (terminal)', () => {
    expect(
      canTransitionPredictionTask(
        PredictionTaskStatus.PUBLISHED,
        PredictionTaskStatus.RUNNING,
      ),
    ).toBe(false);
  });
});

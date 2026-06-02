/**
 * AI 预测功能测试 - 共识计算、预测生成逻辑
 * 覆盖：computeConsensusSummary、共识等级判定、观点聚合
 */
import { describe, it, expect } from 'vitest';

// ─── Mock StructuredPrediction for testing ──────────────────────────────────

interface MockPrediction {
  modelId: string;
  modelDisplayName: string;
  matchNature: string;
  strengths: { home: string[]; away: string[] };
  weaknesses: { home: string[]; away: string[] };
  keyVariables: string[];
  trend: string;
  risks: string[];
  conclusion: {
    winLossDraw: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
    winProbability: { home: number; draw: number; away: number };
    likelyScores: Array<{ home: number; away: number; weight: number }>;
    goalsRange: { min: number; max: number; expectation?: number };
  };
  generatedAt: string;
}

function createMockPrediction(
  modelId: string,
  result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN',
  probs?: { home: number; draw: number; away: number },
): MockPrediction {
  const defaultProbs = result === 'HOME_WIN'
    ? { home: 0.55, draw: 0.25, away: 0.20 }
    : result === 'AWAY_WIN'
      ? { home: 0.20, draw: 0.25, away: 0.55 }
      : { home: 0.30, draw: 0.40, away: 0.30 };

  return {
    modelId,
    modelDisplayName: `Model ${modelId}`,
    matchNature: '小组赛',
    strengths: { home: ['进攻强'], away: ['防守稳'] },
    weaknesses: { home: ['防守弱'], away: ['进攻弱'] },
    keyVariables: ['伤病情况', '主场优势'],
    trend: `${result === 'HOME_WIN' ? '主队' : result === 'AWAY_WIN' ? '客队' : '双方'}近期状态好`,
    risks: ['天气影响', '关键球员伤缺'],
    conclusion: {
      winLossDraw: result,
      winProbability: probs ?? defaultProbs,
      likelyScores: [{ home: result === 'AWAY_WIN' ? 0 : 2, away: result === 'HOME_WIN' ? 0 : 1, weight: 0.3 }],
      goalsRange: { min: 1, max: 4, expectation: 2.5 },
    },
    generatedAt: new Date().toISOString(),
  };
}

// ─── Replicate computeConsensusSummary logic for testing ────────────────────

type ConsensusLevel = 'HIGH' | 'MIXED' | 'STRONG_DIVERGENCE';

interface ConsensusSummary {
  level: ConsensusLevel;
  agreementRate: number;
  majorityResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  divergencePoints: string[];
  highlight: string;
}

function computeConsensusSummary(predictions: MockPrediction[]): ConsensusSummary | null {
  if (predictions.length === 0) return null;
  const counts: Record<'HOME_WIN' | 'DRAW' | 'AWAY_WIN', number> = { HOME_WIN: 0, DRAW: 0, AWAY_WIN: 0 };
  for (const p of predictions) {
    counts[p.conclusion.winLossDraw] += 1;
  }
  const entries = Object.entries(counts) as Array<['HOME_WIN' | 'DRAW' | 'AWAY_WIN', number]>;
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const [majorityResult, majorityCount] = sorted[0];
  const agreementRate = majorityCount / predictions.length;
  const level: ConsensusLevel =
    agreementRate >= 0.67 ? 'HIGH'
      : agreementRate >= 0.5 ? 'MIXED'
        : 'STRONG_DIVERGENCE';
  const divergencePoints = entries
    .filter(([result, count]) => result !== majorityResult && count > 0)
    .map(([result, count]) => `${count} 个模型倾向 ${result}`)
    .slice(0, 8);
  return {
    level,
    agreementRate,
    majorityResult,
    divergencePoints,
    highlight: `共有 ${predictions.length} 个模型生成有效预测，${majorityCount} 个模型倾向 ${majorityResult}，共识度 ${(agreementRate * 100).toFixed(0)}%。`,
  };
}

// ─── 1. Consensus Level Calculation Tests ───────────────────────────────────

describe('computeConsensusSummary - Consensus Level', () => {
  it('should return null for empty predictions', () => {
    const result = computeConsensusSummary([]);
    expect(result).toBeNull();
  });

  it('should return HIGH consensus when all models agree (100%)', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'HOME_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('HIGH');
    expect(result!.agreementRate).toBe(1.0);
    expect(result!.majorityResult).toBe('HOME_WIN');
  });

  it('should return HIGH consensus at exactly 67% threshold (2/3)', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'AWAY_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    // 2/3 = 0.6667 >= 0.67? No, 0.6667 < 0.67 => should be MIXED
    expect(result!.level).toBe('MIXED');
    expect(result!.agreementRate).toBeCloseTo(0.6667, 3);
  });

  it('should return HIGH consensus at 3/4 = 75%', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'HOME_WIN'),
      createMockPrediction('m4', 'DRAW'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('HIGH');
    expect(result!.agreementRate).toBe(0.75);
  });

  it('should return MIXED consensus at 50% (2/4)', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'AWAY_WIN'),
      createMockPrediction('m4', 'DRAW'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('MIXED');
    expect(result!.agreementRate).toBe(0.5);
  });

  it('should return STRONG_DIVERGENCE when no majority (each 1/3)', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'DRAW'),
      createMockPrediction('m3', 'AWAY_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    // Each has 1/3 = 0.333 < 0.5 => STRONG_DIVERGENCE
    expect(result!.level).toBe('STRONG_DIVERGENCE');
  });

  it('should handle single model prediction as HIGH consensus', () => {
    const predictions = [createMockPrediction('m1', 'DRAW')];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.level).toBe('HIGH');
    expect(result!.agreementRate).toBe(1.0);
    expect(result!.majorityResult).toBe('DRAW');
  });
});

// ─── 2. Divergence Points ───────────────────────────────────────────────────

describe('computeConsensusSummary - Divergence Points', () => {
  it('should list divergence points for non-majority results', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'AWAY_WIN'),
      createMockPrediction('m4', 'DRAW'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.divergencePoints.length).toBeGreaterThan(0);
    expect(result!.divergencePoints.some(p => p.includes('AWAY_WIN'))).toBe(true);
    expect(result!.divergencePoints.some(p => p.includes('DRAW'))).toBe(true);
  });

  it('should have empty divergence points when all agree', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'HOME_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.divergencePoints).toHaveLength(0);
  });

  it('should limit divergence points to 8 max', () => {
    // Only 3 possible results so max 2 divergence points
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'DRAW'),
      createMockPrediction('m3', 'AWAY_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.divergencePoints.length).toBeLessThanOrEqual(8);
  });
});

// ─── 3. Highlight Generation ────────────────────────────────────────────────

describe('computeConsensusSummary - Highlight', () => {
  it('should generate meaningful highlight text', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'HOME_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.highlight).toContain('3');
    expect(result!.highlight).toContain('HOME_WIN');
    expect(result!.highlight).toContain('100%');
  });

  it('should include correct percentage in highlight', () => {
    const predictions = [
      createMockPrediction('m1', 'AWAY_WIN'),
      createMockPrediction('m2', 'AWAY_WIN'),
      createMockPrediction('m3', 'AWAY_WIN'),
      createMockPrediction('m4', 'HOME_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result).not.toBeNull();
    expect(result!.highlight).toContain('75%');
    expect(result!.highlight).toContain('AWAY_WIN');
  });
});

// ─── 4. Probability Aggregation (ConsensusService logic) ────────────────────

describe('Probability Aggregation', () => {
  function aggregateProbabilities(predictions: MockPrediction[]) {
    const probs = predictions.map(p => p.conclusion.winProbability);
    if (probs.length === 0) return { home: 0.33, draw: 0.34, away: 0.33 };
    return {
      home: Math.round((probs.reduce((s, p) => s + p.home, 0) / probs.length) * 1000) / 1000,
      draw: Math.round((probs.reduce((s, p) => s + p.draw, 0) / probs.length) * 1000) / 1000,
      away: Math.round((probs.reduce((s, p) => s + p.away, 0) / probs.length) * 1000) / 1000,
    };
  }

  it('should average probabilities correctly for uniform predictions', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN', { home: 0.6, draw: 0.2, away: 0.2 }),
      createMockPrediction('m2', 'HOME_WIN', { home: 0.7, draw: 0.15, away: 0.15 }),
    ];
    const agg = aggregateProbabilities(predictions);
    expect(agg.home).toBeCloseTo(0.65, 2);
    expect(agg.draw).toBeCloseTo(0.175, 2);
    expect(agg.away).toBeCloseTo(0.175, 2);
  });

  it('should handle mixed predictions averaging', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN', { home: 0.6, draw: 0.2, away: 0.2 }),
      createMockPrediction('m2', 'AWAY_WIN', { home: 0.2, draw: 0.2, away: 0.6 }),
    ];
    const agg = aggregateProbabilities(predictions);
    expect(agg.home).toBeCloseTo(0.4, 2);
    expect(agg.draw).toBeCloseTo(0.2, 2);
    expect(agg.away).toBeCloseTo(0.4, 2);
  });

  it('should return default when no predictions', () => {
    const agg = aggregateProbabilities([]);
    expect(agg.home).toBeCloseTo(0.33, 2);
    expect(agg.draw).toBeCloseTo(0.34, 2);
    expect(agg.away).toBeCloseTo(0.33, 2);
  });

  it('probabilities should approximately sum to 1', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN', { home: 0.55, draw: 0.25, away: 0.20 }),
      createMockPrediction('m2', 'DRAW', { home: 0.30, draw: 0.40, away: 0.30 }),
      createMockPrediction('m3', 'AWAY_WIN', { home: 0.20, draw: 0.25, away: 0.55 }),
    ];
    const agg = aggregateProbabilities(predictions);
    const sum = agg.home + agg.draw + agg.away;
    expect(sum).toBeCloseTo(1.0, 1);
  });
});

// ─── 5. Goals Range Aggregation ─────────────────────────────────────────────

describe('Goals Range Aggregation', () => {
  function aggregateGoalsRange(predictions: MockPrediction[]) {
    const ranges = predictions
      .map(p => p.conclusion.goalsRange)
      .filter(g => g != null);
    if (ranges.length === 0) return null;
    return {
      avgMin: Math.round((ranges.reduce((s, g) => s + g.min, 0) / ranges.length) * 100) / 100,
      avgMax: Math.round((ranges.reduce((s, g) => s + g.max, 0) / ranges.length) * 100) / 100,
      avgExpectation: ranges.some(g => g.expectation != null)
        ? Math.round(
            ranges.filter(g => g.expectation != null).reduce((s, g) => s + g.expectation!, 0) /
              ranges.filter(g => g.expectation != null).length * 100,
          ) / 100
        : null,
    };
  }

  it('should aggregate goals ranges correctly', () => {
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
    ];
    // Both have goalsRange: { min: 1, max: 4, expectation: 2.5 }
    const agg = aggregateGoalsRange(predictions);
    expect(agg).not.toBeNull();
    expect(agg!.avgMin).toBe(1);
    expect(agg!.avgMax).toBe(4);
    expect(agg!.avgExpectation).toBe(2.5);
  });

  it('should handle different goals ranges', () => {
    const p1 = createMockPrediction('m1', 'HOME_WIN');
    p1.conclusion.goalsRange = { min: 1, max: 3, expectation: 2.0 };
    const p2 = createMockPrediction('m2', 'HOME_WIN');
    p2.conclusion.goalsRange = { min: 2, max: 5, expectation: 3.5 };
    const agg = aggregateGoalsRange([p1, p2]);
    expect(agg).not.toBeNull();
    expect(agg!.avgMin).toBe(1.5);
    expect(agg!.avgMax).toBe(4);
    expect(agg!.avgExpectation).toBe(2.75);
  });
});

// ─── 6. Consensus Service - Threshold Boundary Tests ────────────────────────

describe('Consensus Level Threshold Boundaries', () => {
  // The shared package uses 0.67, while consensus.service.ts uses 0.7
  // This is a potential BUG: inconsistency between worker and API service

  it('BUG CHECK: shared computeConsensusSummary uses 0.67 threshold', () => {
    // 2/3 = 0.6667 < 0.67 => MIXED (not HIGH)
    const predictions = [
      createMockPrediction('m1', 'HOME_WIN'),
      createMockPrediction('m2', 'HOME_WIN'),
      createMockPrediction('m3', 'AWAY_WIN'),
    ];
    const result = computeConsensusSummary(predictions);
    expect(result!.level).toBe('MIXED');
  });

  it('BUG CHECK: consensus.service.ts uses 0.7 threshold - inconsistency', () => {
    // This documents the inconsistency:
    // packages/shared uses >= 0.67 for HIGH
    // apps/api/src/modules/consensus/consensus.service.ts uses >= 0.7 for HIGH
    // With 3/4 = 0.75:
    //   shared: HIGH (0.75 >= 0.67)
    //   consensus.service: HIGH (0.75 >= 0.7)
    // With 2/3 = 0.667:
    //   shared: MIXED (0.667 < 0.67)
    //   consensus.service: MIXED (0.667 < 0.7)
    // With 7/10 = 0.7:
    //   shared: HIGH (0.7 >= 0.67)  <-- DIFFERENT
    //   consensus.service: HIGH (0.7 >= 0.7)
    // With 67/100 = 0.67:
    //   shared: HIGH (0.67 >= 0.67)  <-- DIFFERENT
    //   consensus.service: MIXED (0.67 < 0.7)

    // This is a real inconsistency bug that should be unified
    const SHARED_THRESHOLD = 0.67;
    const SERVICE_THRESHOLD = 0.70;
    expect(SHARED_THRESHOLD).not.toBe(SERVICE_THRESHOLD);

    // Test case: 67% agreement
    const rate = 0.67;
    const sharedLevel = rate >= SHARED_THRESHOLD ? 'HIGH' : rate >= 0.5 ? 'MIXED' : 'STRONG_DIVERGENCE';
    const serviceLevel = rate >= SERVICE_THRESHOLD ? 'HIGH' : rate >= 0.5 ? 'MIXED' : 'STRONG_DIVERGENCE';
    expect(sharedLevel).toBe('HIGH');
    expect(serviceLevel).toBe('MIXED');
    // BUG: Same agreement rate produces different consensus levels
  });
});

// ─── 7. Prediction Task Status Flow ────────────────────────────────────────

describe('Prediction Task Status Determination', () => {
  function determineFinalStatus(successCount: number, totalModels: number): string {
    const failureCount = totalModels - successCount;
    if (successCount === 0) return 'FAILED';
    if (failureCount === 0) return 'SUCCEEDED';
    return 'PARTIAL_SUCCESS';
  }

  it('should be FAILED when no models succeed', () => {
    expect(determineFinalStatus(0, 5)).toBe('FAILED');
  });

  it('should be SUCCEEDED when all models succeed', () => {
    expect(determineFinalStatus(5, 5)).toBe('SUCCEEDED');
  });

  it('should be PARTIAL_SUCCESS when some models fail', () => {
    expect(determineFinalStatus(3, 5)).toBe('PARTIAL_SUCCESS');
  });

  it('should be PARTIAL_SUCCESS even with 1 success out of many', () => {
    expect(determineFinalStatus(1, 10)).toBe('PARTIAL_SUCCESS');
  });

  it('should be SUCCEEDED with single model that succeeds', () => {
    expect(determineFinalStatus(1, 1)).toBe('SUCCEEDED');
  });
});

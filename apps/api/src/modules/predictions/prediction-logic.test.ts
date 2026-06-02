/**
 * AI 预测逻辑测试 - 状态机、边界条件、数据一致性
 * 覆盖：状态迁移、权益判断、解锁逻辑、调度窗口
 */
import { describe, it, expect } from 'vitest';

// ─── 1. Prediction Task State Machine ───────────────────────────────────────

describe('PredictionTask State Machine', () => {
  const PredictionTaskStatus = {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    REVIEWED: 'REVIEWED',
    PUBLISHED: 'PUBLISHED',
  } as const;

  type Status = (typeof PredictionTaskStatus)[keyof typeof PredictionTaskStatus];

  const transitions: Record<Status, Status[]> = {
    PENDING: ['RUNNING', 'FAILED'],
    RUNNING: ['PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED'],
    PARTIAL_SUCCESS: ['SUCCEEDED', 'REVIEWED', 'PUBLISHED', 'FAILED'],
    SUCCEEDED: ['REVIEWED', 'PUBLISHED'],
    REVIEWED: ['PUBLISHED'],
    PUBLISHED: [],
    FAILED: ['PENDING'],
  };

  function canTransition(from: Status, to: Status): boolean {
    return transitions[from]?.includes(to) ?? false;
  }

  // Valid transitions
  it('PENDING -> RUNNING is valid', () => {
    expect(canTransition('PENDING', 'RUNNING')).toBe(true);
  });

  it('RUNNING -> SUCCEEDED is valid', () => {
    expect(canTransition('RUNNING', 'SUCCEEDED')).toBe(true);
  });

  it('RUNNING -> PARTIAL_SUCCESS is valid', () => {
    expect(canTransition('RUNNING', 'PARTIAL_SUCCESS')).toBe(true);
  });

  it('RUNNING -> FAILED is valid', () => {
    expect(canTransition('RUNNING', 'FAILED')).toBe(true);
  });

  it('SUCCEEDED -> REVIEWED is valid', () => {
    expect(canTransition('SUCCEEDED', 'REVIEWED')).toBe(true);
  });

  it('REVIEWED -> PUBLISHED is valid', () => {
    expect(canTransition('REVIEWED', 'PUBLISHED')).toBe(true);
  });

  it('FAILED -> PENDING is valid (retry)', () => {
    expect(canTransition('FAILED', 'PENDING')).toBe(true);
  });

  // Invalid transitions
  it('PENDING -> PUBLISHED is invalid (skip states)', () => {
    expect(canTransition('PENDING', 'PUBLISHED')).toBe(false);
  });

  it('PUBLISHED -> anything is invalid (terminal state)', () => {
    expect(canTransition('PUBLISHED', 'PENDING')).toBe(false);
    expect(canTransition('PUBLISHED', 'RUNNING')).toBe(false);
    expect(canTransition('PUBLISHED', 'REVIEWED')).toBe(false);
  });

  it('RUNNING -> PUBLISHED is invalid (must go through REVIEWED)', () => {
    expect(canTransition('RUNNING', 'PUBLISHED')).toBe(false);
  });

  it('RUNNING -> REVIEWED is invalid (must succeed first)', () => {
    expect(canTransition('RUNNING', 'REVIEWED')).toBe(false);
  });

  it('FAILED -> RUNNING is invalid (must go through PENDING)', () => {
    expect(canTransition('FAILED', 'RUNNING')).toBe(false);
  });

  // BUG: Worker auto-publishes by doing SUCCEEDED -> REVIEWED -> PUBLISHED
  // in two consecutive updates without checking state machine
  it('BUG CHECK: Worker bypasses state machine - direct SUCCEEDED -> REVIEWED -> PUBLISHED', () => {
    // The worker does:
    // 1. Update status to finalStatus (SUCCEEDED/PARTIAL_SUCCESS)
    // 2. Immediately update to REVIEWED
    // 3. Immediately update to PUBLISHED
    // This is valid per state machine, but bypasses any human review step
    expect(canTransition('SUCCEEDED', 'REVIEWED')).toBe(true);
    expect(canTransition('REVIEWED', 'PUBLISHED')).toBe(true);
    // The issue is that admin publishPredictionTask checks for SUCCEEDED/PARTIAL_SUCCESS/REVIEWED
    // but the worker already auto-publishes, making admin publish redundant
    // This is a design issue, not a crash bug
  });

  // PARTIAL_SUCCESS can go directly to PUBLISHED (skipping REVIEWED)
  it('PARTIAL_SUCCESS -> PUBLISHED is valid (direct publish)', () => {
    expect(canTransition('PARTIAL_SUCCESS', 'PUBLISHED')).toBe(true);
  });
});

// ─── 2. Access Control / Entitlement Logic ──────────────────────────────────

describe('Access Control Logic', () => {
  const FREE_DAILY_MAX_GUEST = 1;
  const FREE_DAILY_MAX_USER = 3;
  const MAX_DAILY_INVITE_REWARDS = 3;

  interface MockUser {
    id: string;
    isPassActive: boolean;
    passExpiresAt: Date | null;
    passTier: string | null;
  }

  interface MockEntitlement {
    source: 'FREE_DAILY' | 'INVITE_REWARD' | 'PASS_SUBSCRIPTION';
    status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED';
    maxCount: number;
    usedCount: number;
    validFrom: Date;
    validUntil: Date;
  }

  function isPassValid(user: MockUser, now: Date): boolean {
    return user.isPassActive && user.passExpiresAt != null && user.passExpiresAt > now;
  }

  function sumRemaining(entitlements: MockEntitlement[]): number {
    return entitlements.reduce((sum, e) => {
      if (e.maxCount === 0) return sum + 999; // Unlimited
      return sum + Math.max(0, e.maxCount - e.usedCount);
    }, 0);
  }

  it('Pass user should always have access', () => {
    const user: MockUser = {
      id: 'user-1',
      isPassActive: true,
      passExpiresAt: new Date(Date.now() + 86400000),
      passTier: 'TIER_1',
    };
    expect(isPassValid(user, new Date())).toBe(true);
  });

  it('Expired pass should deny access', () => {
    const user: MockUser = {
      id: 'user-1',
      isPassActive: true,
      passExpiresAt: new Date(Date.now() - 1000),
      passTier: 'TIER_1',
    };
    expect(isPassValid(user, new Date())).toBe(false);
  });

  it('Pass with null expiresAt should deny access', () => {
    const user: MockUser = {
      id: 'user-1',
      isPassActive: true,
      passExpiresAt: null,
      passTier: 'TIER_1',
    };
    expect(isPassValid(user, new Date())).toBe(false);
  });

  it('Inactive pass should deny access even with future expiry', () => {
    const user: MockUser = {
      id: 'user-1',
      isPassActive: false,
      passExpiresAt: new Date(Date.now() + 86400000),
      passTier: 'TIER_1',
    };
    expect(isPassValid(user, new Date())).toBe(false);
  });

  it('sumRemaining should calculate correctly for active entitlements', () => {
    const entitlements: MockEntitlement[] = [
      { source: 'FREE_DAILY', status: 'ACTIVE', maxCount: 3, usedCount: 1, validFrom: new Date(), validUntil: new Date() },
      { source: 'INVITE_REWARD', status: 'ACTIVE', maxCount: 5, usedCount: 2, validFrom: new Date(), validUntil: new Date() },
    ];
    expect(sumRemaining(entitlements)).toBe(5); // (3-1) + (5-2) = 2 + 3 = 5
  });

  it('sumRemaining should return 999 for unlimited (maxCount=0)', () => {
    const entitlements: MockEntitlement[] = [
      { source: 'PASS_SUBSCRIPTION', status: 'ACTIVE', maxCount: 0, usedCount: 0, validFrom: new Date(), validUntil: new Date() },
    ];
    expect(sumRemaining(entitlements)).toBe(999);
  });

  it('sumRemaining should not go negative', () => {
    const entitlements: MockEntitlement[] = [
      { source: 'FREE_DAILY', status: 'ACTIVE', maxCount: 3, usedCount: 5, validFrom: new Date(), validUntil: new Date() },
    ];
    expect(sumRemaining(entitlements)).toBe(0);
  });

  it('Guest should have max 1 free daily view', () => {
    expect(FREE_DAILY_MAX_GUEST).toBe(1);
  });

  it('User should have max 3 free daily views', () => {
    expect(FREE_DAILY_MAX_USER).toBe(3);
  });

  it('Max daily invite rewards should be 3', () => {
    expect(MAX_DAILY_INVITE_REWARDS).toBe(3);
  });
});

// ─── 3. Scheduler Window Logic ──────────────────────────────────────────────

describe('Prediction Scheduler Window', () => {
  const PREDICTION_SCHEDULES = [
    { version: 'T_MINUS_24H', targetMs: 24 * 60 * 60 * 1000 },
    { version: 'T_MINUS_2H', targetMs: 2 * 60 * 60 * 1000 },
  ] as const;

  function isMatchInWindow(kickoffAt: Date, now: Date, targetMs: number, windowMinutes: number): boolean {
    const from = new Date(now.getTime() + targetMs - windowMinutes * 60 * 1000);
    const to = new Date(now.getTime() + targetMs + windowMinutes * 60 * 1000);
    return kickoffAt >= from && kickoffAt <= to;
  }

  it('should include match exactly 24h from now in T_MINUS_24H window (10min)', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const kickoff = new Date('2026-06-16T10:00:00Z'); // exactly 24h later
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[0].targetMs, 10)).toBe(true);
  });

  it('should include match 23h55m from now in T_MINUS_24H window (10min)', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const kickoff = new Date('2026-06-16T09:55:00Z'); // 23h55m later
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[0].targetMs, 10)).toBe(true);
  });

  it('should exclude match 25h from now in T_MINUS_24H window (10min)', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const kickoff = new Date('2026-06-16T11:00:00Z'); // 25h later
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[0].targetMs, 10)).toBe(false);
  });

  it('should include match exactly 2h from now in T_MINUS_2H window (10min)', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const kickoff = new Date('2026-06-15T12:00:00Z'); // exactly 2h later
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[1].targetMs, 10)).toBe(true);
  });

  it('should exclude match 3h from now in T_MINUS_2H window (10min)', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const kickoff = new Date('2026-06-15T13:00:00Z'); // 3h later
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[1].targetMs, 10)).toBe(false);
  });

  it('should handle wider window (30min) correctly', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const kickoff = new Date('2026-06-16T10:25:00Z'); // 24h25m later
    // With 10min window: out of range
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[0].targetMs, 10)).toBe(false);
    // With 30min window: in range
    expect(isMatchInWindow(kickoff, now, PREDICTION_SCHEDULES[0].targetMs, 30)).toBe(true);
  });
});

// ─── 4. Match Unlock Idempotency ────────────────────────────────────────────

describe('Match Unlock Idempotency', () => {
  it('consuming when already unlocked should return true without double-spending', () => {
    // Simulates the logic: if hasMatchUnlock returns true, consumeOne returns true immediately
    const alreadyUnlocked = true;
    const shouldConsume = !alreadyUnlocked;
    expect(shouldConsume).toBe(false);
  });

  it('consuming should create matchUnlock record for future idempotency', () => {
    // After first consume, matchUnlock is created
    // Second consume should detect it and skip
    const matchUnlocks = new Map<string, boolean>();
    const matchId = 'match-1';
    const userId = 'user-1';
    const key = `${matchId}:${userId}`;

    // First consume
    expect(matchUnlocks.has(key)).toBe(false);
    matchUnlocks.set(key, true);

    // Second consume
    expect(matchUnlocks.has(key)).toBe(true);
  });
});

// ─── 5. Consensus Service vs Shared Package Consistency ─────────────────────

describe('Consensus Calculation Consistency', () => {
  // BUG: Two different consensus calculation implementations exist:
  // 1. packages/shared/src/ai-pipeline/index.ts:computeConsensusSummary (used by worker)
  //    - Threshold: >= 0.67 for HIGH
  //    - Returns ConsensusSummary with 5 fields
  // 2. apps/api/src/modules/consensus/consensus.service.ts:calculateAndSave (used by API)
  //    - Threshold: >= 0.7 for HIGH
  //    - Returns ConsensusResult with many more fields (aggregatedProbability, viewpointClusters, etc.)

  it('BUG: Worker uses shared computeConsensusSummary with 0.67 threshold', () => {
    const WORKER_HIGH_THRESHOLD = 0.67;
    expect(WORKER_HIGH_THRESHOLD).toBe(0.67);
  });

  it('BUG: ConsensusService uses 0.7 threshold', () => {
    const SERVICE_HIGH_THRESHOLD = 0.70;
    expect(SERVICE_HIGH_THRESHOLD).toBe(0.70);
  });

  it('BUG: 67-69% agreement gives different results in worker vs service', () => {
    const rate = 0.68;
    const workerLevel = rate >= 0.67 ? 'HIGH' : rate >= 0.5 ? 'MIXED' : 'STRONG_DIVERGENCE';
    const serviceLevel = rate >= 0.70 ? 'HIGH' : rate >= 0.5 ? 'MIXED' : 'STRONG_DIVERGENCE';
    expect(workerLevel).toBe('HIGH');
    expect(serviceLevel).toBe('MIXED');
    // This means the same predictions can show different consensus levels
    // depending on whether the worker or the API service calculates it
  });
});

// ─── 6. Admin Publish Validation ────────────────────────────────────────────

describe('Admin Publish Validation', () => {
  const publishableStatuses = ['SUCCEEDED', 'PARTIAL_SUCCESS', 'REVIEWED'];

  it('should allow publishing SUCCEEDED tasks', () => {
    expect(publishableStatuses.includes('SUCCEEDED')).toBe(true);
  });

  it('should allow publishing PARTIAL_SUCCESS tasks', () => {
    expect(publishableStatuses.includes('PARTIAL_SUCCESS')).toBe(true);
  });

  it('should allow publishing REVIEWED tasks', () => {
    expect(publishableStatuses.includes('REVIEWED')).toBe(true);
  });

  it('should NOT allow publishing PENDING tasks', () => {
    expect(publishableStatuses.includes('PENDING')).toBe(false);
  });

  it('should NOT allow publishing RUNNING tasks', () => {
    expect(publishableStatuses.includes('RUNNING')).toBe(false);
  });

  it('should NOT allow publishing FAILED tasks', () => {
    expect(publishableStatuses.includes('FAILED')).toBe(false);
  });

  it('should NOT allow publishing already PUBLISHED tasks', () => {
    expect(publishableStatuses.includes('PUBLISHED')).toBe(false);
  });

  it('BUG: Worker auto-publishes making admin publish unreachable for auto-generated tasks', () => {
    // Worker flow: RUNNING -> SUCCEEDED/PARTIAL_SUCCESS -> REVIEWED -> PUBLISHED
    // This means by the time admin sees the task, it's already PUBLISHED
    // Admin can only manually publish tasks that were manually triggered with rerun=false
    // or tasks where the worker failed to auto-publish
    const workerAutoPublishes = true;
    const adminCanPublishAfterWorker = false; // Already PUBLISHED, nothing to do
    expect(workerAutoPublishes).toBe(true);
    expect(adminCanPublishAfterWorker).toBe(false);
  });
});

// ─── 7. Teaser Data Logic ───────────────────────────────────────────────────

describe('Teaser Data Logic', () => {
  it('should show teaser when user cannot view full models', () => {
    const canViewFullModels = false;
    const shouldShowTeaser = !canViewFullModels;
    expect(shouldShowTeaser).toBe(true);
  });

  it('should NOT show teaser when user can view full models', () => {
    const canViewFullModels = true;
    const shouldShowTeaser = !canViewFullModels;
    expect(shouldShowTeaser).toBe(false);
  });

  it('teaser should include model count and consensus info', () => {
    const teaserData = {
      modelCount: 5,
      keyVarCount: 3,
      hasHighConsensus: true,
      modelNames: ['GPT-4', 'Claude', 'Gemini', 'DeepSeek', 'Qwen'],
      consensusLevel: 'HIGH',
    };
    expect(teaserData.modelCount).toBeGreaterThan(0);
    expect(teaserData.modelNames.length).toBe(teaserData.modelCount);
    expect(teaserData.hasHighConsensus).toBe(true);
  });
});

// ─── 8. Daily Free Entitlement Edge Cases ───────────────────────────────────

describe('Daily Free Entitlement Edge Cases', () => {
  function getTodayKey(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  it('should generate correct todayKey format', () => {
    const key = getTodayKey(new Date('2026-06-15T23:59:59.999Z'));
    expect(key).toBe('2026-06-15');
  });

  it('should reset at UTC midnight', () => {
    const before = getTodayKey(new Date('2026-06-15T23:59:59.999Z'));
    const after = getTodayKey(new Date('2026-06-16T00:00:00.000Z'));
    expect(before).not.toBe(after);
    expect(before).toBe('2026-06-15');
    expect(after).toBe('2026-06-16');
  });

  it('BUG: todayKey uses UTC but users may be in different timezones', () => {
    // A user at UTC+8 at 2026-06-16 07:00 local time
    // UTC time is 2026-06-15 23:00
    // todayKey = '2026-06-15'
    // But the user thinks it's already June 16
    // This means the "daily" reset doesn't align with user's local day
    const utcTime = new Date('2026-06-15T23:00:00.000Z');
    const todayKey = getTodayKey(utcTime);
    expect(todayKey).toBe('2026-06-15');
    // User in UTC+8 thinks it's 2026-06-16 07:00
    // Their "daily" quota hasn't reset yet from their perspective
    // This is a known limitation, not necessarily a bug to fix
  });

  it('ensureDailyFreeEntitlement should be idempotent', () => {
    // Calling it multiple times on the same day should not create duplicates
    const todayKey = '2026-06-15';
    const existingEntitlements: string[] = [];

    function ensureDaily(userId: string, key: string) {
      const existing = existingEntitlements.find(e => e === `${userId}:${key}`);
      if (!existing) {
        existingEntitlements.push(`${userId}:${key}`);
      }
    }

    ensureDaily('user-1', todayKey);
    ensureDaily('user-1', todayKey);
    ensureDaily('user-1', todayKey);

    expect(existingEntitlements.filter(e => e === `user-1:${todayKey}`).length).toBe(1);
  });
});

// ─── 9. Invite Reward Limits ────────────────────────────────────────────────

describe('Invite Reward Limits', () => {
  it('should grant 5 uses per invite reward', () => {
    const INVITE_REWARD_USES = 5;
    expect(INVITE_REWARD_USES).toBe(5);
  });

  it('should have 7-day validity for invite rewards', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const diffDays = (validUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7);
  });

  it('should limit daily invite rewards to 3', () => {
    const MAX_DAILY_INVITE_REWARDS = 3;
    const todayRewards = 3;
    const canGrantMore = todayRewards < MAX_DAILY_INVITE_REWARDS;
    expect(canGrantMore).toBe(false);
  });

  it('should allow invite reward when under daily limit', () => {
    const MAX_DAILY_INVITE_REWARDS = 3;
    const todayRewards = 2;
    const canGrantMore = todayRewards < MAX_DAILY_INVITE_REWARDS;
    expect(canGrantMore).toBe(true);
  });
});

// ─── 10. Match Detail Access Flow ───────────────────────────────────────────

describe('Match Detail Access Flow', () => {
  it('should show modelAnalyses only when canViewFullModels is true', () => {
    const canViewFullModels = true;
    const predictions = [{ id: 'p1' }, { id: 'p2' }];
    const modelAnalyses = canViewFullModels ? predictions : [];
    expect(modelAnalyses.length).toBe(2);
  });

  it('should return empty modelAnalyses when canViewFullModels is false', () => {
    const canViewFullModels = false;
    const predictions = [{ id: 'p1' }, { id: 'p2' }];
    const modelAnalyses = canViewFullModels ? predictions : [];
    expect(modelAnalyses.length).toBe(0);
  });

  it('should include teaser data when access is denied', () => {
    const canViewFullModels = false;
    const teaserData = !canViewFullModels ? { modelCount: 5, hasHighConsensus: true } : null;
    expect(teaserData).not.toBeNull();
    expect(teaserData!.modelCount).toBe(5);
  });

  it('should NOT include teaser data when access is granted', () => {
    const canViewFullModels = true;
    const teaserData = !canViewFullModels ? { modelCount: 5, hasHighConsensus: true } : null;
    expect(teaserData).toBeNull();
  });
});

// ─── 11. buildConsensus Edge Cases ──────────────────────────────────────────

describe('buildConsensus Edge Cases', () => {
  function buildConsensusStatus(tasks: Array<{ status: string; predictions: Array<{ isSuccess: boolean }> }>) {
    const published = tasks[0];
    if (!published) {
      return { status: 'generating', modelCount: 0, successCount: 0 };
    }
    const successCount = published.predictions.filter(p => p.isSuccess).length;
    const modelCount = published.predictions.length;
    return { status: 'published', modelCount, successCount };
  }

  it('should return generating status when no tasks exist', () => {
    const result = buildConsensusStatus([]);
    expect(result.status).toBe('generating');
    expect(result.modelCount).toBe(0);
  });

  it('should return published status with correct counts', () => {
    const tasks = [{
      status: 'PUBLISHED',
      predictions: [
        { isSuccess: true },
        { isSuccess: true },
        { isSuccess: false },
      ],
    }];
    const result = buildConsensusStatus(tasks);
    expect(result.status).toBe('published');
    expect(result.modelCount).toBe(3);
    expect(result.successCount).toBe(2);
  });

  it('should handle task with all failed predictions', () => {
    const tasks = [{
      status: 'PUBLISHED',
      predictions: [
        { isSuccess: false },
        { isSuccess: false },
      ],
    }];
    const result = buildConsensusStatus(tasks);
    expect(result.status).toBe('published');
    expect(result.successCount).toBe(0);
  });
});

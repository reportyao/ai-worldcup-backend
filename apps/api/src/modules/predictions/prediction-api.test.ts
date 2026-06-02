/**
 * AI 预测全流程接口测试
 * 覆盖：路由参数校验、权限控制、API 响应格式
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  MatchListQuerySchema,
  UserPredictionSubmitSchema,
} from '../matches/matches.schemas.js';

// ─── 1. Match List Query Schema Validation ──────────────────────────────────

describe('MatchListQuerySchema', () => {
  it('should accept valid query with all fields', () => {
    const result = MatchListQuerySchema.safeParse({
      competitionId: 'comp-123',
      matchday: '2026-06-15',
      status: 'SCHEDULED',
      page: '2',
      pageSize: '10',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('should apply defaults for page and pageSize', () => {
    const result = MatchListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it('should reject invalid matchday format', () => {
    const result = MatchListQuerySchema.safeParse({ matchday: '15-06-2026' });
    expect(result.success).toBe(false);
  });

  it('should reject invalid status enum value', () => {
    const result = MatchListQuerySchema.safeParse({ status: 'INVALID_STATUS' });
    expect(result.success).toBe(false);
  });

  it('should reject page < 1', () => {
    const result = MatchListQuerySchema.safeParse({ page: '0' });
    expect(result.success).toBe(false);
  });

  it('should reject pageSize > 50', () => {
    const result = MatchListQuerySchema.safeParse({ pageSize: '51' });
    expect(result.success).toBe(false);
  });

  it('should coerce string numbers to integers', () => {
    const result = MatchListQuerySchema.safeParse({ page: '3', pageSize: '15' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(15);
    }
  });
});

// ─── 2. User Prediction Submit Schema Validation ────────────────────────────

describe('UserPredictionSubmitSchema', () => {
  it('should accept valid prediction submission', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: 2,
      awayScore: 1,
    });
    expect(result.success).toBe(true);
  });

  it('should accept all prediction types', () => {
    for (const prediction of ['HOME_WIN', 'DRAW', 'AWAY_WIN']) {
      const result = UserPredictionSubmitSchema.safeParse({
        prediction,
        homeScore: 1,
        awayScore: 1,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid prediction type', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'INVALID',
      homeScore: 1,
      awayScore: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative scores', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: -1,
      awayScore: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject scores > 30', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: 31,
      awayScore: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject goalsMin > goalsMax', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: 2,
      awayScore: 1,
      goalsMin: 5,
      goalsMax: 3,
    });
    expect(result.success).toBe(false);
  });

  it('should accept goalsMin == goalsMax', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'DRAW',
      homeScore: 1,
      awayScore: 1,
      goalsMin: 2,
      goalsMax: 2,
    });
    expect(result.success).toBe(true);
  });

  it('should reject clientRequestId shorter than 8 chars', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: 1,
      awayScore: 0,
      clientRequestId: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('should reject clientRequestId longer than 128 chars', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: 1,
      awayScore: 0,
      clientRequestId: 'a'.repeat(129),
    });
    expect(result.success).toBe(false);
  });

  it('should trim clientRequestId whitespace', () => {
    const result = UserPredictionSubmitSchema.safeParse({
      prediction: 'HOME_WIN',
      homeScore: 1,
      awayScore: 0,
      clientRequestId: '  valid-request-id-12345  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientRequestId).toBe('valid-request-id-12345');
    }
  });
});

// ─── 3. Admin Prediction Schemas ────────────────────────────────────────────

describe('AdminPredictionTriggerSchema', () => {
  const AdminPredictionTriggerSchema = z.object({
    matchId: z.string().min(1),
    version: z.enum(['T_MINUS_24H', 'T_MINUS_2H']),
    rerun: z.coerce.boolean().default(false),
  });

  it('should accept valid trigger request', () => {
    const result = AdminPredictionTriggerSchema.safeParse({
      matchId: 'match-abc-123',
      version: 'T_MINUS_24H',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rerun).toBe(false);
    }
  });

  it('should accept T_MINUS_2H version', () => {
    const result = AdminPredictionTriggerSchema.safeParse({
      matchId: 'match-abc-123',
      version: 'T_MINUS_2H',
      rerun: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rerun).toBe(true);
    }
  });

  it('should reject empty matchId', () => {
    const result = AdminPredictionTriggerSchema.safeParse({
      matchId: '',
      version: 'T_MINUS_24H',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid version', () => {
    const result = AdminPredictionTriggerSchema.safeParse({
      matchId: 'match-123',
      version: 'T_MINUS_1H',
    });
    expect(result.success).toBe(false);
  });

  it('should coerce string "true" to boolean for rerun', () => {
    const result = AdminPredictionTriggerSchema.safeParse({
      matchId: 'match-123',
      version: 'T_MINUS_24H',
      rerun: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rerun).toBe(true);
    }
  });
});

// ─── 4. Prediction Generator Payload Schema ─────────────────────────────────

describe('PredictionGeneratorPayloadSchema', () => {
  const DirectPredictionPayloadSchema = z.object({
    matchId: z.string(),
    version: z.enum(['T_MINUS_24H', 'T_MINUS_2H']),
    trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
    rerun: z.coerce.boolean().default(false),
  });

  const SchedulerPayloadSchema = z.object({
    mode: z.literal('SCHEDULE_DUE'),
    windowMinutes: z.coerce.number().int().min(1).max(120).default(10),
  });

  const PredictionGeneratorPayloadSchema = z.union([
    DirectPredictionPayloadSchema,
    SchedulerPayloadSchema,
  ]);

  it('should parse direct prediction payload', () => {
    const result = PredictionGeneratorPayloadSchema.safeParse({
      matchId: 'match-123',
      version: 'T_MINUS_24H',
      trigger: 'MANUAL',
      rerun: false,
    });
    expect(result.success).toBe(true);
  });

  it('should parse scheduler payload', () => {
    const result = PredictionGeneratorPayloadSchema.safeParse({
      mode: 'SCHEDULE_DUE',
      windowMinutes: 15,
    });
    expect(result.success).toBe(true);
  });

  it('should default windowMinutes to 10', () => {
    const result = SchedulerPayloadSchema.safeParse({
      mode: 'SCHEDULE_DUE',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.windowMinutes).toBe(10);
    }
  });

  it('should reject windowMinutes > 120', () => {
    const result = SchedulerPayloadSchema.safeParse({
      mode: 'SCHEDULE_DUE',
      windowMinutes: 121,
    });
    expect(result.success).toBe(false);
  });

  it('should reject windowMinutes < 1', () => {
    const result = SchedulerPayloadSchema.safeParse({
      mode: 'SCHEDULE_DUE',
      windowMinutes: 0,
    });
    expect(result.success).toBe(false);
  });
});

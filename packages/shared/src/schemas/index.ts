import { z } from 'zod';

import {
  CompetitionType,
  ConsensusLevel,
  EntitlementSource,
  EntitlementStatus,
  InvitationStatus,
  Locale,
  MatchStatus,
  ModelPersona,
  OrderStatus,
  PassTier,
  PaymentChannel,
  PredictionTaskStatus,
  PredictionTrigger,
  PredictionVersion,
} from '../enums/index.js';

/**
 * 通用 API 响应包装。所有后端接口必须使用 ApiResponseSchema 包装数据。
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean(),
    data: data.nullable(),
    error: ApiErrorSchema.nullable().optional(),
    traceId: z.string().optional(),
  });

/**
 * 比赛级结构化预测 schema —— 单个模型输出。
 * 所有 AI 模型必须返回该结构，前台据此渲染各模型对比和综合视图。
 */
const DimensionTextSchema = z.string().min(1).max(1000);

export const AnalysisDimensionsSchema = z.object({
  recentForm: DimensionTextSchema,
  injuriesSuspensions: DimensionTextSchema,
  motivation: DimensionTextSchema,
  schedule: DimensionTextSchema,
  homeAway: DimensionTextSchema,
  tacticalMatchup: DimensionTextSchema,
  headToHead: DimensionTextSchema,
  marketExpectation: DimensionTextSchema,
});

export const InformationQualitySchema = z.object({
  completeness: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  uncertainty: z.string().min(1).max(1000),
  missingSignals: z.array(z.string()).max(8).default([]),
});

export const StructuredPredictionSchema = z.object({
  modelId: z.string(),
  modelDisplayName: z.string(),
  modelPersona: z.nativeEnum(ModelPersona).optional(),
  matchNature: z.string().min(1),
  matchNatureAssessment: z.string().min(1).optional(),
  dimensionAnalysis: AnalysisDimensionsSchema.optional(),
  strengths: z.object({
    home: z.array(z.string()).max(8),
    away: z.array(z.string()).max(8),
  }),
  weaknesses: z.object({
    home: z.array(z.string()).max(8),
    away: z.array(z.string()).max(8),
  }),
  keyVariables: z.array(z.string()).min(1).max(8),
  trend: z.string().min(1),
  risks: z.array(z.string()).max(8),
  conclusion: z.object({
    winLossDraw: z.enum(['HOME_WIN', 'DRAW', 'AWAY_WIN']),
    winProbability: z.object({
      home: z.number().min(0).max(1),
      draw: z.number().min(0).max(1),
      away: z.number().min(0).max(1),
    }).optional(),
    handicapTrend: z.string().optional(),
    handicapWinLossDraw: z.enum(['HOME_WIN', 'DRAW', 'AWAY_WIN']).optional(),
    overUnderTrend: z.string().optional(),
    overUnderResult: z.enum(['OVER', 'UNDER', 'EQUAL']).optional(),
    halfFullTime: z.enum([
      'HOME_HOME', 'HOME_DRAW', 'HOME_AWAY',
      'DRAW_HOME', 'DRAW_DRAW', 'DRAW_AWAY',
      'AWAY_HOME', 'AWAY_DRAW', 'AWAY_AWAY',
    ]).optional(),
    likelyScores: z
      .array(
        z.object({
          home: z.number().int().min(0),
          away: z.number().int().min(0),
          weight: z.number().min(0).max(1),
        }),
      )
      .max(5)
      .optional(),
    goalsRange: z.object({
      min: z.number().int().min(0),
      max: z.number().int().min(0),
      expectation: z.number().min(0).optional(),
    }).optional(),
    cornersRange: z
      .object({
        min: z.number().int().min(0),
        max: z.number().int().min(0),
      })
      .optional(),
  }),
  informationQuality: InformationQualitySchema.optional(),
  disclaimer: z.string().default('娱乐分析，不构成任何投注建议。'),
  generatedAt: z.string(),
});
export type StructuredPrediction = z.infer<typeof StructuredPredictionSchema>;

export const ConsensusSummarySchema = z.object({
  level: z.nativeEnum(ConsensusLevel),
  agreementRate: z.number().min(0).max(1),
  majorityResult: z.enum(['HOME_WIN', 'DRAW', 'AWAY_WIN']),
  divergencePoints: z.array(z.string()).max(8),
  highlight: z.string().min(1),
});
export type ConsensusSummary = z.infer<typeof ConsensusSummarySchema>;

export const StructuredReviewSchema = z.object({
  modelId: z.string(),
  modelDisplayName: z.string(),
  hits: z.array(z.string()),
  misses: z.array(z.string()),
  rootCauses: z.array(z.string()),
  lessons: z.array(z.string()),
  modelMetricsDelta: z
    .object({
      winLossDrawHits: z.number().int(),
      winLossDrawMisses: z.number().int(),
    })
    .optional(),
  generatedAt: z.string(),
});
export type StructuredReview = z.infer<typeof StructuredReviewSchema>;

export const PredictionTaskSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  version: z.nativeEnum(PredictionVersion),
  status: z.nativeEnum(PredictionTaskStatus),
  trigger: z.nativeEnum(PredictionTrigger),
  modelCount: z.number().int().min(0),
  successCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  consensusLevel: z.nativeEnum(ConsensusLevel).nullable(),
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PredictionTask = z.infer<typeof PredictionTaskSchema>;

/**
 * 比赛列表查询参数
 */
export const MatchListQuerySchema = z.object({
  competitionId: z.string().optional(),
  matchday: z.string().optional(),
  status: z.nativeEnum(MatchStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type MatchListQuery = z.infer<typeof MatchListQuerySchema>;

/**
 * 球队 Schema
 */
export const TeamSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  countryCode: z.string().nullable(),
  crestUrl: z.string().nullable(),
});
export type Team = z.infer<typeof TeamSchema>;

/**
 * 比赛摘要 Schema
 */
export const MatchSummarySchema = z.object({
  id: z.string(),
  competitionId: z.string(),
  competitionName: z.string().optional(),
  competitionPriority: z.string().optional(),
  homeTeam: TeamSchema,
  awayTeam: TeamSchema,
  kickoffAt: z.string(),
  status: z.nativeEnum(MatchStatus),
  matchday: z.string().nullable(),
  stage: z.string().nullable(),
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
  homeHalfScore: z.number().int().nullable().optional(),
  awayHalfScore: z.number().int().nullable().optional(),
  consensusLevel: z.nativeEnum(ConsensusLevel).nullable().optional(),
  modelCount: z.number().int().optional(),
  tag: z.string().nullable().optional(),
});
export type MatchSummaryType = z.infer<typeof MatchSummarySchema>;

/**
 * 赛事 Schema
 */
export const CompetitionSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  type: z.nativeEnum(CompetitionType),
  season: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});
export type Competition = z.infer<typeof CompetitionSchema>;

/**
 * AI 模型 Schema
 */
export const AiModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  displayName: z.string(),
  persona: z.nativeEnum(ModelPersona),
  provider: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int().optional(),
  description: z.string().nullable(),
  config: z.record(z.unknown()).nullable().optional(),
});
export type AiModel = z.infer<typeof AiModelSchema>;

/**
 * 模型预测结果 Schema
 */
export const ModelPredictionSchema = z.object({
  id: z.string(),
  predictionTaskId: z.string(),
  aiModelId: z.string(),
  aiModel: AiModelSchema,
  structuredOutput: StructuredPredictionSchema,
  isSuccess: z.boolean(),
  latencyMs: z.number().int().nullable(),
  generatedAt: z.string(),
});
export type ModelPredictionType = z.infer<typeof ModelPredictionSchema>;

// ─── T1-03: User / Guest / Invitation / Entitlement / Order ─────────────────

/**
 * 用户资料 Schema
 */
export const UserProfileSchema = z.object({
  id: z.string(),
  nickname: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.nativeEnum(Locale),
  timezone: z.string(),
  isPassActive: z.boolean(),
  passExpiresAt: z.string().nullable(),
  passTier: z.nativeEnum(PassTier).nullable(),
  createdAt: z.string(),
});
export type UserProfileType = z.infer<typeof UserProfileSchema>;

/**
 * 游客资料 Schema
 */
export const GuestProfileSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  locale: z.nativeEnum(Locale),
  freeUsedToday: z.number().int().min(0),
  freeResetDate: z.string().nullable(),
  createdAt: z.string(),
});
export type GuestProfileType = z.infer<typeof GuestProfileSchema>;

/**
 * 游客注册/识别请求
 */
export const GuestIdentifySchema = z.object({
  fingerprint: z.string().min(8).max(128),
  userAgent: z.string().optional(),
  locale: z.nativeEnum(Locale).optional(),
});
export type GuestIdentify = z.infer<typeof GuestIdentifySchema>;

/**
 * 邀请记录 Schema
 */
export const InvitationSchema = z.object({
  id: z.string(),
  inviterId: z.string(),
  code: z.string(),
  inviteeId: z.string().nullable(),
  status: z.nativeEnum(InvitationStatus),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  rewardGranted: z.boolean(),
  createdAt: z.string(),
});
export type InvitationType = z.infer<typeof InvitationSchema>;

/**
 * 权益记录 Schema
 */
export const EntitlementSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  guestId: z.string().nullable(),
  source: z.nativeEnum(EntitlementSource),
  status: z.nativeEnum(EntitlementStatus),
  validFrom: z.string(),
  validUntil: z.string(),
  usedCount: z.number().int().min(0),
  maxCount: z.number().int().min(0),
  orderId: z.string().nullable(),
  invitationId: z.string().nullable(),
  description: z.string().nullable(),
  createdAt: z.string(),
});
export type EntitlementType = z.infer<typeof EntitlementSchema>;

/**
 * 权益快照（用于前端展示当前可用权益）
 */
export const EntitlementSnapshotSchema = z.object({
  freeDailyRemaining: z.number().int().min(0),
  freeDailyMax: z.number().int().min(0),
  inviteRewardRemaining: z.number().int().min(0),
  isPassActive: z.boolean(),
  passExpiresAt: z.string().nullable(),
  passTier: z.nativeEnum(PassTier).nullable(),
  todayInviteRewardsGranted: z.number().int().min(0),
  maxDailyInviteRewards: z.number().int().min(0),
});
export type EntitlementSnapshotType = z.infer<typeof EntitlementSnapshotSchema>;

/**
 * 订单 Schema
 */
export const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  channel: z.nativeEnum(PaymentChannel),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.nativeEnum(OrderStatus),
  passTier: z.nativeEnum(PassTier).nullable(),
  passDays: z.number().int().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

/**
 * 创建订单请求
 */
export const CreateOrderSchema = z.object({
  channel: z.nativeEnum(PaymentChannel),
  passTier: z.nativeEnum(PassTier),
  currency: z.string().length(3).default('USD'),
});
export type CreateOrder = z.infer<typeof CreateOrderSchema>;

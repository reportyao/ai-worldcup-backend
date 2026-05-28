import { z } from 'zod';

import {
  ConsensusLevel,
  EntitlementSource,
  Locale,
  ModelPersona,
  OrderStatus,
  PaymentChannel,
  PredictionTaskStatus,
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
export const StructuredPredictionSchema = z.object({
  modelId: z.string(),
  modelDisplayName: z.string(),
  modelPersona: z.nativeEnum(ModelPersona).optional(),
  matchNature: z.string().min(1),
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
    }),
    handicapTrend: z.string().optional(),
    likelyScores: z
      .array(
        z.object({
          home: z.number().int().min(0),
          away: z.number().int().min(0),
          weight: z.number().min(0).max(1),
        }),
      )
      .max(5),
    goalsRange: z.object({
      min: z.number().int().min(0),
      max: z.number().int().min(0),
      expectation: z.number().min(0).optional(),
    }),
    cornersRange: z
      .object({
        min: z.number().int().min(0),
        max: z.number().int().min(0),
      })
      .optional(),
  }),
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
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable().optional(),
});
export type PredictionTask = z.infer<typeof PredictionTaskSchema>;

export const EntitlementSnapshotSchema = z.object({
  freeDailyRemaining: z.number().int().min(0),
  inviteRewardRemainingToday: z.number().int().min(0),
  inviteRewardEarnedToday: z.number().int().min(0),
  passActiveUntil: z.string().nullable(),
  source: z.nativeEnum(EntitlementSource),
  locale: z.nativeEnum(Locale),
});
export type EntitlementSnapshot = z.infer<typeof EntitlementSnapshotSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  channel: z.nativeEnum(PaymentChannel),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  status: z.nativeEnum(OrderStatus),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type Order = z.infer<typeof OrderSchema>;

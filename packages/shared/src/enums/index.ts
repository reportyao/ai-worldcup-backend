/**
 * 业务枚举集中定义；前后端必须从此处引用，避免硬编码字符串。
 */

export const Locale = {
  ZH_CN: 'zh-CN',
  EN: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

export const CompetitionType = {
  WORLD_CUP: 'WORLD_CUP',
  CONTINENTAL_CUP: 'CONTINENTAL_CUP',
  CITY_LEAGUE: 'CITY_LEAGUE',
  OTHER: 'OTHER',
} as const;
export type CompetitionType = (typeof CompetitionType)[keyof typeof CompetitionType];

export const MatchStatus = {
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  FINISHED: 'FINISHED',
  POSTPONED: 'POSTPONED',
  CANCELED: 'CANCELED',
} as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

export const PredictionTrigger = {
  CRON: 'CRON',
  MANUAL: 'MANUAL',
} as const;
export type PredictionTrigger = (typeof PredictionTrigger)[keyof typeof PredictionTrigger];

export const PredictionVersion = {
  T_MINUS_24H: 'T_MINUS_24H',
  T_MINUS_2H: 'T_MINUS_2H',
} as const;
export type PredictionVersion = (typeof PredictionVersion)[keyof typeof PredictionVersion];

export const PredictionTaskStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REVIEWED: 'REVIEWED',
  PUBLISHED: 'PUBLISHED',
} as const;
export type PredictionTaskStatus =
  (typeof PredictionTaskStatus)[keyof typeof PredictionTaskStatus];

export const ConsensusLevel = {
  HIGH: 'HIGH',
  MIXED: 'MIXED',
  STRONG_DIVERGENCE: 'STRONG_DIVERGENCE',
} as const;
export type ConsensusLevel = (typeof ConsensusLevel)[keyof typeof ConsensusLevel];

export const EntitlementSource = {
  FREE_DAILY: 'FREE_DAILY',
  INVITE_REWARD: 'INVITE_REWARD',
  PASS_SUBSCRIPTION: 'PASS_SUBSCRIPTION',
  ADMIN_GRANT: 'ADMIN_GRANT',
} as const;
export type EntitlementSource = (typeof EntitlementSource)[keyof typeof EntitlementSource];

export const EntitlementStatus = {
  ACTIVE: 'ACTIVE',
  CONSUMED: 'CONSUMED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
} as const;
export type EntitlementStatus = (typeof EntitlementStatus)[keyof typeof EntitlementStatus];

export const InvitationStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

export const PassTier = {
  TIER_1: 'TIER_1',
  TIER_2: 'TIER_2',
  TIER_3: 'TIER_3',
} as const;
export type PassTier = (typeof PassTier)[keyof typeof PassTier];

export const PaymentChannel = {
  WECHAT_PAY: 'WECHAT_PAY',
  STRIPE: 'STRIPE',
} as const;
export type PaymentChannel = (typeof PaymentChannel)[keyof typeof PaymentChannel];

export const OrderStatus = {
  CREATED: 'CREATED',
  PAID: 'PAID',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ModelPersona = {
  STEADY: 'STEADY',
  ATTACKING: 'ATTACKING',
  UPSET_HUNTER: 'UPSET_HUNTER',
  DATA_DRIVEN: 'DATA_DRIVEN',
} as const;
export type ModelPersona = (typeof ModelPersona)[keyof typeof ModelPersona];

/**
 * 定价层级对应的价格（美分）
 */
export const PassTierPriceCents: Record<string, number> = {
  TIER_1: 999,  // $9.99
  TIER_2: 499,  // $4.99
  TIER_3: 299,  // $2.99
} as const;

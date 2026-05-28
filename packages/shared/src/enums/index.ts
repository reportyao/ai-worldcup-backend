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

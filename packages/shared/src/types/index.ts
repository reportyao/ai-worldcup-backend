import type {
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

// ─── Generic ─────────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuthenticatedUserContext {
  userId: string;
  wechatOpenId?: string;
  locale: Locale;
  isPassActive: boolean;
}

// ─── T1-01: Competition / Team / Match ───────────────────────────────────────

export interface CompetitionSummary {
  id: string;
  code: string;
  name: string;
  type: CompetitionType;
  season: string;
  startDate: string | null;
  endDate: string | null;
}

export interface TeamSummary {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  countryCode: string | null;
  crestUrl: string | null;
}

export interface MatchSummary {
  id: string;
  competitionId: string;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
  kickoffAt: string;
  status: MatchStatus;
  matchday: string | null;
  stage: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface MatchDetail extends MatchSummary {
  competition: CompetitionSummary;
  predictionTasks: PredictionTaskSummary[];
}

// ─── T1-02: AiModel / PredictionTask / ModelPrediction ───────────────────────

export interface AiModelSummary {
  id: string;
  modelId: string;
  displayName: string;
  persona: ModelPersona;
  provider: string;
  isActive: boolean;
  description: string | null;
}

export interface PredictionTaskSummary {
  id: string;
  matchId: string;
  version: PredictionVersion;
  status: PredictionTaskStatus;
  trigger: PredictionTrigger;
  modelCount: number;
  successCount: number;
  failureCount: number;
  consensusLevel: ConsensusLevel | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPredictionSummary {
  id: string;
  predictionTaskId: string;
  aiModelId: string;
  aiModel: AiModelSummary;
  structuredOutput: unknown;
  isSuccess: boolean;
  latencyMs: number | null;
  generatedAt: string;
}

export interface PredictionTaskDetail extends PredictionTaskSummary {
  predictions: ModelPredictionSummary[];
  consensusSummary: unknown | null;
}

// ─── T1-03: User / Guest / Invitation / Entitlement / Order ─────────────────

export interface UserProfile {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  locale: Locale;
  timezone: string;
  isPassActive: boolean;
  passExpiresAt: string | null;
  passTier: PassTier | null;
  createdAt: string;
}

export interface GuestProfile {
  id: string;
  fingerprint: string;
  locale: Locale;
  freeUsedToday: number;
  freeResetDate: string | null;
  createdAt: string;
}

export interface InvitationSummary {
  id: string;
  inviterId: string;
  code: string;
  inviteeId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  rewardGranted: boolean;
  createdAt: string;
}

export interface EntitlementSummary {
  id: string;
  userId: string | null;
  guestId: string | null;
  source: EntitlementSource;
  status: EntitlementStatus;
  validFrom: string;
  validUntil: string;
  usedCount: number;
  maxCount: number;
  orderId: string | null;
  invitationId: string | null;
  description: string | null;
  createdAt: string;
}

export interface EntitlementSnapshot {
  freeDailyRemaining: number;
  inviteRewardRemaining: number;
  isPassActive: boolean;
  passExpiresAt: string | null;
  passTier: PassTier | null;
}

export interface OrderSummary {
  id: string;
  userId: string;
  channel: PaymentChannel;
  amountCents: number;
  currency: string;
  status: OrderStatus;
  passTier: PassTier | null;
  passDays: number | null;
  paidAt: string | null;
  createdAt: string;
}

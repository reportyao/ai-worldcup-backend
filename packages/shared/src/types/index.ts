import type {
  CompetitionType,
  ConsensusLevel,
  Locale,
  MatchStatus,
  ModelPersona,
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

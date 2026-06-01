/**
 * Feature Engine Types
 * --------------------
 * Defines the structured feature schema used as input to AI prediction models.
 * All features are computed from historical match data and stored in MatchFeature table.
 */

/** Recent form statistics for a team */
export interface TeamFormStats {
  /** Number of recent matches analyzed */
  matchesAnalyzed: number;
  /** Wins in recent matches */
  wins: number;
  /** Draws in recent matches */
  draws: number;
  /** Losses in recent matches */
  losses: number;
  /** Goals scored in recent matches */
  goalsScored: number;
  /** Goals conceded in recent matches */
  goalsConceded: number;
  /** Average goals scored per match */
  avgGoalsScored: number;
  /** Average goals conceded per match */
  avgGoalsConceded: number;
  /** Win rate (0-1) */
  winRate: number;
  /** Points per match (W=3, D=1, L=0) */
  pointsPerMatch: number;
  /** Form string, e.g. "WWDLW" (most recent first) */
  formString: string;
  /** Clean sheets count */
  cleanSheets: number;
  /** Failed to score count */
  failedToScore: number;
}

/** Home/Away specific performance */
export interface VenueStats {
  /** Number of matches at this venue type */
  matchesPlayed: number;
  /** Win rate at this venue */
  winRate: number;
  /** Average goals scored at this venue */
  avgGoalsScored: number;
  /** Average goals conceded at this venue */
  avgGoalsConceded: number;
}

/** Head-to-head record between two teams */
export interface HeadToHeadStats {
  /** Total H2H matches found */
  totalMatches: number;
  /** Home team wins in H2H */
  homeWins: number;
  /** Draws in H2H */
  draws: number;
  /** Away team wins in H2H */
  awayWins: number;
  /** Average total goals in H2H */
  avgTotalGoals: number;
  /** Last meeting result description */
  lastMeeting: string | null;
}

/** Schedule fatigue indicator */
export interface ScheduleFatigue {
  /** Days since last match */
  daysSinceLastMatch: number | null;
  /** Number of matches in last 14 days */
  matchesInLast14Days: number;
  /** Whether the team is in a congested schedule */
  isCongested: boolean;
}

/** Competition context */
export interface CompetitionContext {
  /** Competition name */
  competitionName: string;
  /** Competition season */
  season: string;
  /** Competition priority level */
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  /** Stage/round info */
  stage: string | null;
  /** Matchday */
  matchday: string | null;
}

/** Complete feature set for a single match */
export interface MatchFeatureSet {
  /** Feature schema version */
  version: string;
  /** When these features were computed */
  computedAt: string;
  /** Competition context */
  competition: CompetitionContext;
  /** Match metadata */
  match: {
    kickoffAt: string;
    homeTeamName: string;
    homeTeamCode: string;
    awayTeamName: string;
    awayTeamCode: string;
  };
  /** Home team features */
  homeTeam: {
    /** Overall recent form (last 10 matches) */
    recentForm: TeamFormStats;
    /** Last 5 matches form */
    last5Form: TeamFormStats;
    /** Home-specific performance */
    homeVenue: VenueStats;
    /** Schedule fatigue */
    fatigue: ScheduleFatigue;
  };
  /** Away team features */
  awayTeam: {
    /** Overall recent form (last 10 matches) */
    recentForm: TeamFormStats;
    /** Last 5 matches form */
    last5Form: TeamFormStats;
    /** Away-specific performance */
    awayVenue: VenueStats;
    /** Schedule fatigue */
    fatigue: ScheduleFatigue;
  };
  /** Head-to-head record */
  headToHead: HeadToHeadStats;
  /** Data quality assessment */
  dataQuality: {
    /** Overall quality: HIGH (>= 8 matches per team), MEDIUM (>= 4), LOW (< 4) */
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    /** Missing data signals */
    missingSignals: string[];
    /** Number of historical matches available for home team */
    homeTeamHistoryCount: number;
    /** Number of historical matches available for away team */
    awayTeamHistoryCount: number;
  };
}

/** Input for computing features for a specific match */
export interface FeatureComputeInput {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  kickoffAt: Date;
}

/** Result of feature computation */
export interface FeatureComputeResult {
  matchId: string;
  featureVersion: string;
  features: MatchFeatureSet;
  summaryText: string;
  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  missingSignals: string[];
}

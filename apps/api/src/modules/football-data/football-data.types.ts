export type FootballDataProvider = 'api-football' | 'sporttery';

export type FootballDataSyncScope = 'LEAGUES' | 'TEAMS' | 'FIXTURES' | 'LIVE_SCORES' | 'STANDINGS' | 'SPORTTERY_JC';

export type FootballDataSyncStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL_SUCCESS' | 'FAILED';

export interface FootballDataSyncOptions {
  provider?: FootballDataProvider;
  scope: FootballDataSyncScope;
  leagueIds?: number[];
  season?: string;
  from?: string;
  to?: string;
  /** 体彩竞彩销售日期，格式 yyyy-MM-dd；未传时默认当天 */
  saleDate?: string;
  dryRun?: boolean;
  enqueuePredictions?: boolean;
}

export interface FootballDataSyncSummary {
  provider: FootballDataProvider;
  scope: FootballDataSyncScope;
  dryRun: boolean;
  leagueIds: number[];
  saleDate?: string;
  competitionsCreated: number;
  competitionsUpdated: number;
  teamsCreated: number;
  teamsUpdated: number;
  matchesCreated: number;
  matchesUpdated: number;
  matchesSkipped: number;
  marketSnapshotsCreated?: number;
  marketSnapshotsUpdated?: number;
  predictionEnqueued: number;
  predictionFailed: number;
  errorCount: number;
  errors: Array<{ externalId?: string; message: string }>;
}

export interface ApiFootballLeague {
  country_id?: string;
  country_name?: string;
  league_id?: string;
  league_name?: string;
  league_season?: string;
}

export interface ApiFootballTeam {
  team_key?: string;
  team_name?: string;
  team_badge?: string;
  team_logo?: string;
  team_country?: string;
}

export interface ApiFootballFixture {
  match_id?: string;
  country_id?: string;
  country_name?: string;
  league_id?: string;
  league_name?: string;
  match_date?: string;
  match_time?: string;
  match_status?: string;
  match_live?: string;
  match_round?: string;
  match_hometeam_id?: string;
  match_hometeam_name?: string;
  match_hometeam_score?: string;
  match_awayteam_id?: string;
  match_awayteam_name?: string;
  match_awayteam_score?: string;
  league_season?: string;
}

export interface SportteryFootballMatch {
  saleDate: string;
  matchNo: string;
  issueNo?: string;
  leagueName?: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt?: string;
  status?: string;
  handicapLine?: number;
  overUnderLine?: number;
  winDrawLoss?: string;
  handicapResult?: string;
  overUnderResult?: string;
  scoreResult?: string;
  halfFullResult?: string;
  raw: Record<string, unknown>;
}

import type { Locale } from '../enums/index.js';

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

export interface MatchSummary {
  id: string;
  competitionId: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELED';
}

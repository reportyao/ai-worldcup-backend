import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';

import type { ApiFootballFixture, ApiFootballLeague, ApiFootballTeam } from './football-data.types.js';

@Injectable()
export class ApiFootballClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.baseUrl = this.config.get('API_FOOTBALL_BASE_URL', { infer: true }) ?? 'https://apiv3.apifootball.com/';
    this.apiKey = this.config.get('API_FOOTBALL_KEY', { infer: true });
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  async getLeagues(): Promise<ApiFootballLeague[]> {
    return this.request<ApiFootballLeague[]>({ action: 'get_leagues' });
  }

  async getTeams(leagueId: number): Promise<ApiFootballTeam[]> {
    return this.request<ApiFootballTeam[]>({ action: 'get_teams', league_id: String(leagueId) });
  }

  async getFixtures(params: {
    leagueId: number;
    from: string;
    to: string;
    liveOnly?: boolean;
  }): Promise<ApiFootballFixture[]> {
    return this.request<ApiFootballFixture[]>({
      action: 'get_events',
      league_id: String(params.leagueId),
      from: params.from,
      to: params.to,
      ...(params.liveOnly ? { match_live: '1' } : {}),
    });
  }

  private async request<T>(params: Record<string, string>): Promise<T> {
    if (!this.apiKey) {
      throw new Error('API_FOOTBALL_KEY is not configured');
    }

    const url = new URL(this.baseUrl);
    Object.entries({ ...params, APIkey: this.apiKey }).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`API-Football request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as unknown;
    if (Array.isArray(data)) return data as T;
    if (this.isProviderError(data)) {
      throw new Error(data.message ?? data.error ?? 'API-Football returned an error response');
    }
    return data as T;
  }

  private isProviderError(data: unknown): data is { error?: string; message?: string } {
    return Boolean(
      data &&
        typeof data === 'object' &&
        ('error' in data || 'message' in data) &&
        !('league_id' in data) &&
        !('match_id' in data) &&
        !('team_key' in data),
    );
  }
}

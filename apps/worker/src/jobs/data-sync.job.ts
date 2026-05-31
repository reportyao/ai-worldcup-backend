import {
  CompetitionType,
  MatchStatus,
  PredictionTrigger,
  PredictionVersion,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

import { logger } from '../logger.js';
import { QueueName } from '../queues.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';
const prisma = new PrismaClient();
let predictionQueue: Queue | undefined;

function createConnection(): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

function getPredictionQueue(): Queue {
  predictionQueue ??= new Queue(QueueName.PredictionGenerator, { connection: createConnection() });
  return predictionQueue;
}

const SyncScopeSchema = z.enum(['LEAGUES', 'TEAMS', 'FIXTURES', 'LIVE_SCORES', 'STANDINGS']);

export const DataSyncPayloadSchema = z.object({
  scope: SyncScopeSchema.default('FIXTURES'),
  leagueIds: z.array(z.coerce.number().int().positive()).optional(),
  season: z.string().trim().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dryRun: z.coerce.boolean().default(false),
  enqueuePredictions: z.coerce.boolean().default(true),
});

export type DataSyncPayload = z.infer<typeof DataSyncPayloadSchema>;

type ApiFootballLeague = {
  country_id?: string;
  country_name?: string;
  league_id?: string;
  league_name?: string;
  league_season?: string;
};

type ApiFootballTeam = {
  team_key?: string;
  team_name?: string;
  team_badge?: string;
  team_logo?: string;
  team_country?: string;
};

type ApiFootballFixture = {
  match_id?: string;
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
};

type NormalizedOptions = Required<DataSyncPayload>;

type SyncSummary = {
  provider: 'api-football';
  scope: DataSyncPayload['scope'];
  dryRun: boolean;
  leagueIds: number[];
  competitionsCreated: number;
  competitionsUpdated: number;
  teamsCreated: number;
  teamsUpdated: number;
  matchesCreated: number;
  matchesUpdated: number;
  matchesSkipped: number;
  predictionEnqueued: number;
  predictionFailed: number;
  errorCount: number;
  errors: Array<{ externalId?: string; message: string }>;
};

export async function processDataSync(job: Job<unknown>): Promise<{ ok: true; summary: SyncSummary }> {
  const options = normalizeOptions(DataSyncPayloadSchema.parse(job.data));
  const summary = createSummary(options);
  const log = await prisma.footballDataSyncLog.create({
    data: {
      provider: 'api-football',
      scope: options.scope,
      status: 'RUNNING',
      params: toJson(options),
    },
  });

  logger.info({ jobId: job.id, payload: options, syncLogId: log.id }, 'data-sync running');
  try {
    await syncInternal(options, summary);
    const status = resolveFinalStatus(summary);
    await prisma.footballDataSyncLog.update({
      where: { id: log.id },
      data: { status, summary: toJson(summary), finishedAt: new Date() },
    });
    logger.info({ jobId: job.id, status, summary }, 'data-sync finished');
    return { ok: true, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.errorCount += 1;
    summary.errors.push({ message });
    await prisma.footballDataSyncLog.update({
      where: { id: log.id },
      data: {
        status: 'FAILED',
        summary: toJson(summary),
        errorMessage: message,
        finishedAt: new Date(),
      },
    });
    logger.error({ jobId: job.id, err: message, summary }, 'data-sync failed');
    throw error;
  }
}

async function syncInternal(options: NormalizedOptions, summary: SyncSummary): Promise<void> {
  const leagues = await getLeagues();
  const targetIds = new Set(options.leagueIds.map(String));
  const targets = leagues.filter((league) => league.league_id && targetIds.has(String(league.league_id)));
  if (!targets.length) throw new Error('No API-Football leagues selected. Pass leagueIds or configure API_FOOTBALL_LEAGUE_IDS.');

  for (const league of targets) {
    const competition = await upsertCompetition(league, options, summary);
    if (options.scope === 'LEAGUES') continue;
    if (options.scope === 'TEAMS') {
      await syncTeamsForLeague(Number(league.league_id), summary, options.dryRun);
      continue;
    }
    if (options.scope === 'FIXTURES' || options.scope === 'LIVE_SCORES') {
      const fixtures = await getFixtures({
        leagueId: Number(league.league_id),
        from: options.from,
        to: options.to,
        liveOnly: options.scope === 'LIVE_SCORES',
      });
      for (const fixture of fixtures) {
        await upsertFixture(competition.id, fixture, options, summary);
      }
    }
  }
}

async function getLeagues(): Promise<ApiFootballLeague[]> {
  return request<ApiFootballLeague[]>({ action: 'get_leagues' });
}

async function getTeams(leagueId: number): Promise<ApiFootballTeam[]> {
  return request<ApiFootballTeam[]>({ action: 'get_teams', league_id: String(leagueId) });
}

async function getFixtures(params: { leagueId: number; from: string; to: string; liveOnly: boolean }): Promise<ApiFootballFixture[]> {
  return request<ApiFootballFixture[]>({
    action: 'get_events',
    league_id: String(params.leagueId),
    from: params.from,
    to: params.to,
    ...(params.liveOnly ? { match_live: '1' } : {}),
  });
}

async function request<T>(params: Record<string, string>): Promise<T> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('API_FOOTBALL_KEY is not configured');
  const url = new URL(process.env.API_FOOTBALL_BASE_URL ?? 'https://apiv3.apifootball.com/');
  Object.entries({ ...params, APIkey: apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`API-Football request failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as unknown;
  if (Array.isArray(data)) return data as T;
  if (data && typeof data === 'object' && ('error' in data || 'message' in data)) {
    const providerError = data as { error?: string; message?: string };
    throw new Error(providerError.message ?? providerError.error ?? 'API-Football returned an error response');
  }
  return data as T;
}

async function upsertCompetition(league: ApiFootballLeague, options: NormalizedOptions, summary: SyncSummary) {
  const externalId = `api-football:league:${league.league_id}`;
  const season = options.season || league.league_season || options.from.slice(0, 4);
  const data = {
    code: buildCompetitionCode(league, season),
    name: league.league_name?.trim() || `API-Football League ${league.league_id}`,
    type: CompetitionType.OTHER,
    season,
    country: league.country_name?.trim() || null,
    status: 'ACTIVE',
    externalId,
  };
  const existing = await prisma.competition.findUnique({ where: { externalId } });
  if (options.dryRun) {
    if (existing) summary.competitionsUpdated += 1;
    else summary.competitionsCreated += 1;
    return existing ?? { id: `dry-run:${externalId}` };
  }
  const competition = await prisma.competition.upsert({ where: { externalId }, update: data, create: data });
  if (existing) summary.competitionsUpdated += 1;
  else summary.competitionsCreated += 1;
  return competition;
}

async function syncTeamsForLeague(leagueId: number, summary: SyncSummary, dryRun: boolean): Promise<void> {
  const teams = await getTeams(leagueId);
  for (const team of teams) {
    await upsertTeam(team, summary, dryRun);
  }
}

async function upsertFixture(
  competitionId: string,
  fixture: ApiFootballFixture,
  options: NormalizedOptions,
  summary: SyncSummary,
): Promise<void> {
  const externalId = fixture.match_id ? `api-football:match:${fixture.match_id}` : undefined;
  const kickoffAt = parseKickoff(fixture);
  if (!externalId || !kickoffAt || !fixture.match_hometeam_name || !fixture.match_awayteam_name) {
    summary.matchesSkipped += 1;
    summary.errorCount += 1;
    summary.errors.push({ externalId, message: 'Fixture is missing match id, kickoff time, or team names' });
    return;
  }
  const existing = await prisma.match.findUnique({ where: { externalId } });
  if (options.dryRun) {
    if (existing) summary.matchesUpdated += 1;
    else summary.matchesCreated += 1;
    return;
  }

  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam({ team_key: fixture.match_hometeam_id, team_name: fixture.match_hometeam_name }, summary, false),
    upsertTeam({ team_key: fixture.match_awayteam_id, team_name: fixture.match_awayteam_name }, summary, false),
  ]);
  const match = await prisma.match.upsert({
    where: { externalId },
    update: {
      competitionId,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt,
      status: mapMatchStatus(fixture),
      matchday: kickoffAt.toISOString().slice(0, 10),
      stage: fixture.match_round?.trim() || null,
      homeScore: toNullableInt(fixture.match_hometeam_score),
      awayScore: toNullableInt(fixture.match_awayteam_score),
    },
    create: {
      competitionId,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      kickoffAt,
      status: mapMatchStatus(fixture),
      matchday: kickoffAt.toISOString().slice(0, 10),
      stage: fixture.match_round?.trim() || null,
      homeScore: toNullableInt(fixture.match_hometeam_score),
      awayScore: toNullableInt(fixture.match_awayteam_score),
      externalId,
    },
  });
  if (existing) summary.matchesUpdated += 1;
  else {
    summary.matchesCreated += 1;
    if (options.enqueuePredictions) await enqueuePrediction(match.id, summary);
  }
}

async function upsertTeam(team: ApiFootballTeam, summary: SyncSummary, dryRun: boolean) {
  const externalId = team.team_key ? `api-football:team:${team.team_key}` : undefined;
  const name = team.team_name?.trim();
  if (!externalId || !name) throw new Error('Team is missing team_key or team_name');
  const data = {
    code: buildTeamCode(team),
    name,
    shortName: name,
    crestUrl: team.team_badge || team.team_logo || null,
    externalId,
  };
  const existing = await prisma.team.findUnique({ where: { externalId } });
  if (dryRun) {
    if (existing) summary.teamsUpdated += 1;
    else summary.teamsCreated += 1;
    return existing ?? { id: `dry-run:${externalId}` };
  }
  const saved = await prisma.team.upsert({ where: { externalId }, update: data, create: data });
  if (existing) summary.teamsUpdated += 1;
  else summary.teamsCreated += 1;
  return saved;
}

async function enqueuePrediction(matchId: string, summary: SyncSummary): Promise<void> {
  try {
    await getPredictionQueue().add(
      'generate-prediction',
      {
        matchId,
        version: PredictionVersion.T_MINUS_24H,
        trigger: PredictionTrigger.CRON,
        rerun: false,
      },
      {
        jobId: `prediction:${matchId}:${PredictionVersion.T_MINUS_24H}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    summary.predictionEnqueued += 1;
  } catch (error) {
    summary.predictionFailed += 1;
    summary.errorCount += 1;
    summary.errors.push({ message: error instanceof Error ? error.message : String(error) });
  }
}

function normalizeOptions(payload: DataSyncPayload): NormalizedOptions {
  const now = new Date();
  const from = payload.from ?? formatDate(now);
  const to = payload.to ?? formatDate(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
  return {
    scope: payload.scope,
    leagueIds: payload.leagueIds?.length ? payload.leagueIds : parseLeagueIdsFromEnv(),
    season: payload.season ?? '',
    from,
    to,
    dryRun: payload.dryRun,
    enqueuePredictions: payload.enqueuePredictions,
  };
}

function createSummary(options: NormalizedOptions): SyncSummary {
  return {
    provider: 'api-football',
    scope: options.scope,
    dryRun: options.dryRun,
    leagueIds: options.leagueIds,
    competitionsCreated: 0,
    competitionsUpdated: 0,
    teamsCreated: 0,
    teamsUpdated: 0,
    matchesCreated: 0,
    matchesUpdated: 0,
    matchesSkipped: 0,
    predictionEnqueued: 0,
    predictionFailed: 0,
    errorCount: 0,
    errors: [],
  };
}

function parseLeagueIdsFromEnv(): number[] {
  return (process.env.API_FOOTBALL_LEAGUE_IDS ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function resolveFinalStatus(summary: SyncSummary): 'SUCCEEDED' | 'PARTIAL_SUCCESS' | 'FAILED' {
  if (summary.errorCount === 0) return 'SUCCEEDED';
  const changed = summary.competitionsCreated + summary.competitionsUpdated + summary.teamsCreated + summary.teamsUpdated + summary.matchesCreated + summary.matchesUpdated;
  return changed > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';
}

function buildCompetitionCode(league: ApiFootballLeague, season: string): string {
  const acronym = (league.league_name ?? 'LEAGUE')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12) || 'L';
  return `AF-${league.league_id}-${acronym}-${season}`.slice(0, 40);
}

function buildTeamCode(team: ApiFootballTeam): string {
  if (team.team_key) return `AF-${team.team_key}`.slice(0, 30).toUpperCase();
  return `AF-${(team.team_name ?? 'TEAM').replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`.toUpperCase();
}

function parseKickoff(fixture: ApiFootballFixture): Date | null {
  if (!fixture.match_date) return null;
  const time = fixture.match_time && fixture.match_time.trim().length > 0 ? fixture.match_time.trim() : '00:00';
  const iso = `${fixture.match_date}T${time.length === 5 ? `${time}:00` : time}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapMatchStatus(fixture: ApiFootballFixture): MatchStatus {
  const raw = (fixture.match_status ?? '').trim().toLowerCase();
  if (raw.includes('postpon')) return MatchStatus.POSTPONED;
  if (raw.includes('cancel') || raw.includes('abandon')) return MatchStatus.CANCELED;
  if (raw.includes('finish') || raw.includes('after') || raw.includes('pen') || raw === 'ft') return MatchStatus.FINISHED;
  if (fixture.match_live === '1' || /^\d+'?$/.test(raw) || raw.includes('half') || raw.includes('live')) return MatchStatus.LIVE;
  return MatchStatus.SCHEDULED;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toNullableInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

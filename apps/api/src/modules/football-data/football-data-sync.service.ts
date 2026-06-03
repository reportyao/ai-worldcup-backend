import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompetitionType, MatchStatus, PredictionTrigger, PredictionVersion, Prisma } from '@prisma/client';

import type { AppConfig } from '../../config/configuration.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PredictionPipelineService } from '../prediction-pipeline/prediction-pipeline.service.js';

import { ApiFootballClient } from './api-football.client.js';
import { SportteryClient } from './sporttery.client.js';
import type {
  ApiFootballFixture,
  ApiFootballLeague,
  ApiFootballTeam,
  FootballDataSyncOptions,
  FootballDataSyncScope,
  FootballDataSyncStatus,
  FootballDataSyncSummary,
  SportteryFootballMatch,
} from './football-data.types.js';

interface NormalizedFootballDataSyncOptions extends Required<Omit<FootballDataSyncOptions, 'provider' | 'saleDate'>> {
  provider: 'api-football' | 'sporttery';
  saleDate: string;
}

@Injectable()
export class FootballDataSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly client: ApiFootballClient,
    private readonly sportteryClient: SportteryClient,
    private readonly predictionPipeline: PredictionPipelineService,
  ) {}

  async listProviderLeagues() {
    return this.client.getLeagues();
  }

  async listSyncLogs(query: { scope?: FootballDataSyncScope; status?: string; page?: number; pageSize?: number }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.FootballDataSyncLogWhereInput = {
      ...(query.scope === 'SPORTTERY_JC' ? { provider: 'sporttery' } : { provider: 'api-football' }),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.footballDataSyncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.footballDataSyncLog.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async sync(options: FootballDataSyncOptions) {
    const normalized = this.normalizeOptions(options);
    if (normalized.provider === 'api-football' && !this.client.hasCredentials()) throw new BadRequestException('API_FOOTBALL_KEY is not configured');

    const log = await this.prisma.footballDataSyncLog.create({
      data: {
        provider: normalized.provider,
        scope: normalized.scope,
        status: 'RUNNING',
        params: this.toPrismaJson(normalized),
      },
    });

    const summary = this.createEmptySummary(normalized);
    try {
      if (normalized.provider === 'sporttery' || normalized.scope === 'SPORTTERY_JC') {
        await this.syncSporttery(normalized, summary);
      } else {
        await this.syncInternal(normalized, summary);
      }
      const status = this.resolveFinalStatus(summary);
      const updated = await this.prisma.footballDataSyncLog.update({
        where: { id: log.id },
        data: {
          status,
          summary: this.toPrismaJson(summary),
          finishedAt: new Date(),
        },
      });
      return { log: updated, summary };
    } catch (error) {
      summary.errorCount += 1;
      summary.errors.push({ message: error instanceof Error ? error.message : String(error) });
      const updated = await this.prisma.footballDataSyncLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          summary: this.toPrismaJson(summary),
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      return { log: updated, summary };
    }
  }

  private async syncInternal(options: NormalizedFootballDataSyncOptions, summary: FootballDataSyncSummary) {
    const leagues = await this.resolveTargetLeagues(options);
    if (leagues.length === 0) {
      throw new BadRequestException('No API-Football leagues selected. Pass leagueIds or configure API_FOOTBALL_LEAGUE_IDS.');
    }

    for (const league of leagues) {
      const competition = await this.upsertCompetition(league, options, summary);
      if (options.scope === 'LEAGUES') continue;

      if (options.scope === 'TEAMS') {
        await this.syncTeamsForLeague(Number(league.league_id), summary, options.dryRun);
        continue;
      }

      if (options.scope === 'FIXTURES' || options.scope === 'LIVE_SCORES') {
        const fixtures = await this.client.getFixtures({
          leagueId: Number(league.league_id),
          from: options.from,
          to: options.to,
          liveOnly: options.scope === 'LIVE_SCORES',
        });
        for (const fixture of fixtures) {
          await this.upsertFixture(competition.id, fixture, options, summary);
        }
      }
    }
  }


  private async syncSporttery(options: NormalizedFootballDataSyncOptions, summary: FootballDataSyncSummary) {
    const items = await this.sportteryClient.getDailyFootballMatches(options.saleDate);
    if (items.length === 0) {
      summary.errorCount += 1;
      summary.errors.push({ message: `No Sporttery football matches returned for ${options.saleDate}. Configure SPORTTERY_FOOTBALL_JC_URL if the official endpoint changes.` });
      return;
    }
    const competition = await this.upsertSportteryCompetition(options, summary);
    for (const item of items) {
      await this.upsertSportteryMatch(competition.id, item, options, summary);
    }
  }

  private async upsertSportteryCompetition(options: NormalizedFootballDataSyncOptions, summary: FootballDataSyncSummary) {
    const season = options.season || options.saleDate.slice(0, 4);
    const externalId = `sporttery:football:${season}`;
    const data = {
      code: `SPT-JC-${season}`.slice(0, 40),
      name: `中国竞彩网竞彩足球 ${season}`,
      type: CompetitionType.OTHER,
      season,
      country: '中国',
      status: 'ACTIVE',
      externalId,
    };
    if (options.dryRun) {
      const existing = await this.prisma.competition.findUnique({ where: { externalId } });
      if (existing) summary.competitionsUpdated += 1;
      else summary.competitionsCreated += 1;
      return existing ?? { id: `dry-run:${externalId}` };
    }
    const existing = await this.prisma.competition.findUnique({ where: { externalId } });
    const saved = await this.prisma.competition.upsert({ where: { externalId }, update: data, create: data });
    if (existing) summary.competitionsUpdated += 1;
    else summary.competitionsCreated += 1;
    return saved;
  }

  private async upsertSportteryMatch(competitionId: string, item: SportteryFootballMatch, options: NormalizedFootballDataSyncOptions, summary: FootballDataSyncSummary) {
    const externalId = `sporttery:football:${item.saleDate}:${item.matchNo}`;
    const kickoffAt = item.kickoffAt ? new Date(item.kickoffAt) : null;
    if (!kickoffAt || Number.isNaN(kickoffAt.getTime())) {
      if (!options.dryRun) {
        const existingMarket = await this.prisma.sportteryMatchMarket.findUnique({
          where: { provider_saleDate_matchNo: { provider: 'sporttery', saleDate: item.saleDate, matchNo: item.matchNo } },
        });
        await this.prisma.sportteryMatchMarket.upsert({
          where: { provider_saleDate_matchNo: { provider: 'sporttery', saleDate: item.saleDate, matchNo: item.matchNo } },
          update: {
            matchId: null,
            issueNo: item.issueNo ?? null,
            leagueName: item.leagueName ?? null,
            homeTeamName: item.homeTeamName,
            awayTeamName: item.awayTeamName,
            kickoffAt: null,
            status: item.status ?? 'SCHEDULED',
            handicapLine: item.handicapLine ?? null,
            overUnderLine: item.overUnderLine ?? null,
            winDrawLoss: item.winDrawLoss ?? null,
            handicapResult: item.handicapResult ?? null,
            overUnderResult: item.overUnderResult ?? null,
            scoreResult: item.scoreResult ?? null,
            halfFullResult: item.halfFullResult ?? null,
            rawJson: this.toPrismaJson(item.raw),
            syncedAt: new Date(),
          },
          create: {
            provider: 'sporttery',
            saleDate: item.saleDate,
            matchNo: item.matchNo,
            matchId: null,
            issueNo: item.issueNo ?? null,
            leagueName: item.leagueName ?? null,
            homeTeamName: item.homeTeamName,
            awayTeamName: item.awayTeamName,
            kickoffAt: null,
            status: item.status ?? 'SCHEDULED',
            handicapLine: item.handicapLine ?? null,
            overUnderLine: item.overUnderLine ?? null,
            winDrawLoss: item.winDrawLoss ?? null,
            handicapResult: item.handicapResult ?? null,
            overUnderResult: item.overUnderResult ?? null,
            scoreResult: item.scoreResult ?? null,
            halfFullResult: item.halfFullResult ?? null,
            rawJson: this.toPrismaJson(item.raw),
          },
        });
        if (existingMarket) summary.marketSnapshotsUpdated = (summary.marketSnapshotsUpdated ?? 0) + 1;
        else summary.marketSnapshotsCreated = (summary.marketSnapshotsCreated ?? 0) + 1;
      }
      summary.matchesSkipped += 1;
      return;
    }

    if (options.dryRun) {
      const existing = await this.prisma.match.findUnique({ where: { externalId } });
      if (existing) summary.matchesUpdated += 1;
      else summary.matchesCreated += 1;
      return;
    }

    const [homeTeam, awayTeam] = await Promise.all([
      this.upsertSportteryTeam(item.homeTeamName, summary),
      this.upsertSportteryTeam(item.awayTeamName, summary),
    ]);

    const existing = await this.prisma.match.findUnique({ where: { externalId } });
    const match = await this.prisma.match.upsert({
      where: { externalId },
      update: {
        competitionId,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt,
        status: this.mapSportteryStatus(item),
        matchday: item.saleDate,
        stage: item.leagueName ?? null,
        handicapLine: item.handicapLine ?? null,
        overUnderLine: item.overUnderLine ?? null,
      },
      create: {
        competitionId,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt,
        status: this.mapSportteryStatus(item),
        matchday: item.saleDate,
        stage: item.leagueName ?? null,
        handicapLine: item.handicapLine ?? null,
        overUnderLine: item.overUnderLine ?? null,
        externalId,
      },
    });

    const existingMarket = await this.prisma.sportteryMatchMarket.findUnique({
      where: { provider_saleDate_matchNo: { provider: 'sporttery', saleDate: item.saleDate, matchNo: item.matchNo } },
    });
    await this.prisma.sportteryMatchMarket.upsert({
      where: { provider_saleDate_matchNo: { provider: 'sporttery', saleDate: item.saleDate, matchNo: item.matchNo } },
      update: {
        matchId: match.id,
        issueNo: item.issueNo ?? null,
        leagueName: item.leagueName ?? null,
        homeTeamName: item.homeTeamName,
        awayTeamName: item.awayTeamName,
        kickoffAt,
        status: item.status ?? 'SCHEDULED',
        handicapLine: item.handicapLine ?? null,
        overUnderLine: item.overUnderLine ?? null,
        winDrawLoss: item.winDrawLoss ?? null,
        handicapResult: item.handicapResult ?? null,
        overUnderResult: item.overUnderResult ?? null,
        scoreResult: item.scoreResult ?? null,
        halfFullResult: item.halfFullResult ?? null,
        rawJson: this.toPrismaJson(item.raw),
        syncedAt: new Date(),
      },
      create: {
        provider: 'sporttery',
        saleDate: item.saleDate,
        matchNo: item.matchNo,
        issueNo: item.issueNo ?? null,
        matchId: match.id,
        leagueName: item.leagueName ?? null,
        homeTeamName: item.homeTeamName,
        awayTeamName: item.awayTeamName,
        kickoffAt,
        status: item.status ?? 'SCHEDULED',
        handicapLine: item.handicapLine ?? null,
        overUnderLine: item.overUnderLine ?? null,
        winDrawLoss: item.winDrawLoss ?? null,
        handicapResult: item.handicapResult ?? null,
        overUnderResult: item.overUnderResult ?? null,
        scoreResult: item.scoreResult ?? null,
        halfFullResult: item.halfFullResult ?? null,
        rawJson: this.toPrismaJson(item.raw),
      },
    });
    if (existingMarket) summary.marketSnapshotsUpdated = (summary.marketSnapshotsUpdated ?? 0) + 1;
    else summary.marketSnapshotsCreated = (summary.marketSnapshotsCreated ?? 0) + 1;

    if (existing) summary.matchesUpdated += 1;
    else {
      summary.matchesCreated += 1;
      if (options.enqueuePredictions) await this.enqueueInitialPrediction(match.id, summary);
    }
  }

  private async upsertSportteryTeam(name: string, summary: FootballDataSyncSummary, dryRun = false) {
    const normalized = name.trim();
    const externalId = `sporttery:team:${this.slugify(normalized)}`;
    const data = {
      code: `SPT-${this.slugify(normalized).slice(0, 24)}`.toUpperCase(),
      name: normalized,
      nameZh: normalized,
      shortName: normalized,
      externalId,
    };
    if (dryRun) {
      const existing = await this.prisma.team.findUnique({ where: { externalId } });
      if (existing) summary.teamsUpdated += 1;
      else summary.teamsCreated += 1;
      return existing ?? { id: `dry-run:${externalId}` };
    }
    const existing = await this.prisma.team.findUnique({ where: { externalId } });
    const saved = await this.prisma.team.upsert({ where: { externalId }, update: data, create: data });
    if (existing) summary.teamsUpdated += 1;
    else summary.teamsCreated += 1;
    return saved;
  }

  private mapSportteryStatus(item: SportteryFootballMatch): MatchStatus {
    const raw = (item.status ?? '').toLowerCase();
    if (/finish|ended|完|已开奖|已完赛/.test(raw) || item.scoreResult) return MatchStatus.FINISHED;
    if (/live|进行|半场/.test(raw)) return MatchStatus.LIVE;
    if (/cancel|取消/.test(raw)) return MatchStatus.CANCELED;
    if (/postpon|延期/.test(raw)) return MatchStatus.POSTPONED;
    return MatchStatus.SCHEDULED;
  }

  private slugify(value: string): string {
    const ascii = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return ascii || Buffer.from(value).toString('hex').slice(0, 24);
  }


  private async resolveTargetLeagues(options: NormalizedFootballDataSyncOptions) {
    const leagues = await this.client.getLeagues();
    const targetIds = new Set(options.leagueIds.map(String));
    return leagues.filter((league) => league.league_id && targetIds.has(String(league.league_id)));
  }

  private async upsertCompetition(
    league: ApiFootballLeague,
    options: NormalizedFootballDataSyncOptions,
    summary: FootballDataSyncSummary,
  ) {
    const season = options.season || league.league_season || this.inferSeasonFromDate(options.from);
    const externalId = `api-football:league:${league.league_id}:season:${season}`;
    const code = this.buildCompetitionCode(league, season);
    const data = {
      code,
      name: league.league_name?.trim() || `API-Football League ${league.league_id}`,
      type: CompetitionType.OTHER,
      season,
      country: league.country_name?.trim() || null,
      status: 'ACTIVE',
      externalId,
    };

    if (options.dryRun) {
      const existing = await this.prisma.competition.findUnique({ where: { externalId } });
      if (existing) summary.competitionsUpdated += 1;
      else summary.competitionsCreated += 1;
      return existing ?? { id: `dry-run:${externalId}` };
    }

    const existing = await this.prisma.competition.findUnique({ where: { externalId } });
    const competition = await this.prisma.competition.upsert({
      where: { externalId },
      update: data,
      create: data,
    });
    if (existing) summary.competitionsUpdated += 1;
    else summary.competitionsCreated += 1;
    return competition;
  }

  private async syncTeamsForLeague(leagueId: number, summary: FootballDataSyncSummary, dryRun: boolean) {
    const teams = await this.client.getTeams(leagueId);
    for (const team of teams) {
      await this.upsertTeam(team, summary, dryRun);
    }
  }

  private async upsertFixture(
    competitionId: string,
    fixture: ApiFootballFixture,
    options: NormalizedFootballDataSyncOptions,
    summary: FootballDataSyncSummary,
  ) {
    const externalId = fixture.match_id ? `api-football:match:${fixture.match_id}` : undefined;
    const kickoffAt = this.parseKickoff(fixture);
    if (!externalId || !kickoffAt || !fixture.match_hometeam_name || !fixture.match_awayteam_name) {
      summary.matchesSkipped += 1;
      summary.errors.push({ externalId, message: 'Fixture is missing match id, kickoff time, or team names' });
      summary.errorCount += 1;
      return;
    }

    if (options.dryRun) {
      const existing = await this.prisma.match.findUnique({ where: { externalId } });
      if (existing) summary.matchesUpdated += 1;
      else summary.matchesCreated += 1;
      return;
    }

    const [homeTeam, awayTeam] = await Promise.all([
      this.upsertTeam(
        {
          team_key: fixture.match_hometeam_id,
          team_name: fixture.match_hometeam_name,
        },
        summary,
        false,
      ),
      this.upsertTeam(
        {
          team_key: fixture.match_awayteam_id,
          team_name: fixture.match_awayteam_name,
        },
        summary,
        false,
      ),
    ]);

    const existing = await this.prisma.match.findUnique({ where: { externalId } });
    const match = await this.prisma.match.upsert({
      where: { externalId },
      update: {
        competitionId,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt,
        status: this.mapMatchStatus(fixture),
        matchday: kickoffAt.toISOString().slice(0, 10),
        stage: fixture.match_round?.trim() || null,
        homeScore: this.toNullableInt(fixture.match_hometeam_score),
        awayScore: this.toNullableInt(fixture.match_awayteam_score),
      },
      create: {
        competitionId,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt,
        status: this.mapMatchStatus(fixture),
        matchday: kickoffAt.toISOString().slice(0, 10),
        stage: fixture.match_round?.trim() || null,
        homeScore: this.toNullableInt(fixture.match_hometeam_score),
        awayScore: this.toNullableInt(fixture.match_awayteam_score),
        externalId,
      },
    });

    if (existing) summary.matchesUpdated += 1;
    else {
      summary.matchesCreated += 1;
      if (options.enqueuePredictions) await this.enqueueInitialPrediction(match.id, summary);
    }
  }

  private async upsertTeam(team: ApiFootballTeam, summary: FootballDataSyncSummary, dryRun: boolean) {
    const externalId = team.team_key ? `api-football:team:${team.team_key}` : undefined;
    const name = team.team_name?.trim();
    if (!externalId || !name) throw new Error('Team is missing team_key or team_name');
    const data = {
      code: this.buildTeamCode(team),
      name,
      shortName: name,
      // API-Football team_badge/team_logo often points to third-party JPG resources that fail
      // with ERR_HTTP2_PROTOCOL_ERROR in browsers. Keep the team metadata, but do not persist
      // unstable badge URLs for user-facing clients.
      crestUrl: null,
      externalId,
    };

    if (dryRun) {
      const existing = await this.prisma.team.findUnique({ where: { externalId } });
      if (existing) summary.teamsUpdated += 1;
      else summary.teamsCreated += 1;
      return existing ?? { id: `dry-run:${externalId}` };
    }

    const existing = await this.prisma.team.findUnique({ where: { externalId } });
    const saved = await this.prisma.team.upsert({ where: { externalId }, update: data, create: data });
    if (existing) summary.teamsUpdated += 1;
    else summary.teamsCreated += 1;
    return saved;
  }

  private async enqueueInitialPrediction(matchId: string, summary: FootballDataSyncSummary) {
    try {
      await this.predictionPipeline.enqueuePrediction({
        matchId,
        version: PredictionVersion.T_MINUS_24H,
        trigger: PredictionTrigger.CRON,
        rerun: false,
      });
      summary.predictionEnqueued += 1;
    } catch (error) {
      summary.predictionFailed += 1;
      summary.errorCount += 1;
      summary.errors.push({ message: error instanceof Error ? error.message : String(error) });
    }
  }

  private normalizeOptions(options: FootballDataSyncOptions): NormalizedFootballDataSyncOptions {
    const today = new Date();
    const defaultFrom = this.formatDate(today);
    const defaultTo = this.formatDate(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000));
    const leagueIds = options.leagueIds?.length ? options.leagueIds : this.parseLeagueIdsFromEnv();
    return {
      provider: options.provider ?? (options.scope === 'SPORTTERY_JC' ? 'sporttery' : 'api-football'),
      scope: options.scope,
      leagueIds,
      season: options.season ?? '',
      from: options.from ?? defaultFrom,
      to: options.to ?? defaultTo,
      saleDate: options.saleDate ?? options.from ?? this.formatDate(today),
      dryRun: options.dryRun ?? false,
      enqueuePredictions: options.enqueuePredictions ?? false,
    };
  }

  private createEmptySummary(options: NormalizedFootballDataSyncOptions): FootballDataSyncSummary {
    return {
      provider: options.provider,
      scope: options.scope,
      dryRun: options.dryRun,
      leagueIds: options.leagueIds,
      saleDate: options.saleDate,
      competitionsCreated: 0,
      competitionsUpdated: 0,
      teamsCreated: 0,
      teamsUpdated: 0,
      matchesCreated: 0,
      matchesUpdated: 0,
      matchesSkipped: 0,
      marketSnapshotsCreated: 0,
      marketSnapshotsUpdated: 0,
      predictionEnqueued: 0,
      predictionFailed: 0,
      errorCount: 0,
      errors: [],
    };
  }

  private resolveFinalStatus(summary: FootballDataSyncSummary): FootballDataSyncStatus {
    if (summary.errorCount === 0) return 'SUCCEEDED';
    const changed = summary.competitionsCreated + summary.competitionsUpdated + summary.teamsCreated + summary.teamsUpdated + summary.matchesCreated + summary.matchesUpdated;
    return changed > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';
  }

  private parseLeagueIdsFromEnv(): number[] {
    const raw = this.config.get('API_FOOTBALL_LEAGUE_IDS', { infer: true });
    if (!raw) return [];
    return raw
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item) && item > 0);
  }

  private buildCompetitionCode(league: ApiFootballLeague, season: string): string {
    const rawName = league.league_name || 'LEAGUE';
    const acronym = rawName
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 12) || 'L';
    return `AF-${league.league_id}-${acronym}-${season}`.slice(0, 40);
  }

  private buildTeamCode(team: ApiFootballTeam): string {
    if (team.team_key) return `AF-${team.team_key}`.slice(0, 30).toUpperCase();
    return `AF-${(team.team_name ?? 'TEAM').replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`.toUpperCase();
  }

  private parseKickoff(fixture: ApiFootballFixture): Date | null {
    if (!fixture.match_date) return null;
    const time = fixture.match_time && fixture.match_time.trim().length > 0 ? fixture.match_time.trim() : '00:00';
    const iso = `${fixture.match_date}T${time.length === 5 ? `${time}:00` : time}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private mapMatchStatus(fixture: ApiFootballFixture): MatchStatus {
    const raw = (fixture.match_status ?? '').trim().toLowerCase();
    if (/postpon|suspend/.test(raw)) return MatchStatus.POSTPONED;
    if (/cancel|abandon|walkover/.test(raw)) return MatchStatus.CANCELED;
    if (/finish|full[ -]?time|after|extra time|pen|ended/.test(raw) || ['ft', 'aet', 'ap', 'f/t'].includes(raw)) {
      return MatchStatus.FINISHED;
    }
    if (fixture.match_live === '1' || /^\d+'?$/.test(raw) || /half|live|ht|break|interval/.test(raw)) return MatchStatus.LIVE;

    const kickoffAt = this.parseKickoff(fixture);
    const homeScore = this.toNullableInt(fixture.match_hometeam_score);
    const awayScore = this.toNullableInt(fixture.match_awayteam_score);
    if (kickoffAt && kickoffAt.getTime() < Date.now() - 3 * 60 * 60 * 1000 && homeScore != null && awayScore != null) {
      return MatchStatus.FINISHED;
    }
    return MatchStatus.SCHEDULED;
  }

  private inferSeasonFromDate(date: string): string {
    return date.slice(0, 4);
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toNullableInt(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

import { gunzipSync } from 'node:zlib';

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

type JsonRecord = Record<string, unknown>;

type RawFeijingAiPrediction = JsonRecord & {
  matchId?: string | number;
  matchid?: string | number;
  sportsType?: string | number;
  sportstype?: string | number;
  matchtime?: string;
  leagueName?: string;
  leaguename?: string;
  homeTeam?: string;
  hometeam?: string;
  awayTeam?: string;
  awayteam?: string;
  PredictType?: string | number;
  predictType?: string | number;
  predicttype?: string | number;
  PredictOdds?: string | string[];
  predictOdds?: string | string[];
  predictodds?: string | string[];
  PredictContent?: string | number;
  predictContent?: string | number;
  predictcontent?: string | number;
  updateTime?: string;
  updatetime?: string;
};

interface NormalizedFeijingAiPrediction {
  externalMatchId: string;
  sportsType: number | null;
  matchTime: Date | null;
  matchTimeRaw: string | null;
  leagueName: string | null;
  homeTeam: string;
  awayTeam: string;
  predictType: string;
  predictTypeLabel: string;
  predictContent: string;
  predictOdds: string[];
  handicapOrLine: string | null;
  updateTime: Date | null;
  updateTimeRaw: string | null;
  raw: RawFeijingAiPrediction;
}

interface CachedFeijingPayload {
  fetchedAt: Date;
  rows: NormalizedFeijingAiPrediction[];
}

interface ListOptions {
  refresh?: boolean;
  includeUnmatched?: boolean;
  daysBefore?: number;
  daysAhead?: number;
}

const DEFAULT_FEIJING_AI_URL = 'http://interface.titan007.com/football/ai.aspx';
const DEFAULT_FEIJING_AI_KEY = '880306AAC9A249EA';
const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class FeijingAiPredictionService {
  private readonly logger = new Logger(FeijingAiPredictionService.name);
  private cache: CachedFeijingPayload | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async list(options: ListOptions = {}) {
    const fetched = await this.fetchNormalizedPredictions(Boolean(options.refresh));
    const scoped = this.filterByDateWindow(fetched.rows, options);
    const matches = await this.loadCandidateMatches(scoped);
    const mapped = scoped.map((prediction) => {
      const match = this.findBestMatch(prediction, matches);
      return this.toResponseItem(prediction, match);
    });
    const includeUnmatched = options.includeUnmatched ?? true;
    const items = includeUnmatched ? mapped : mapped.filter((item) => item.matched);

    return {
      source: 'feijing-titan007-ai',
      apiUrl: this.getApiBaseUrl(),
      fetchedAt: fetched.fetchedAt.toISOString(),
      total: items.length,
      matchedCount: items.filter((item) => item.matched).length,
      unmatchedCount: items.filter((item) => !item.matched).length,
      items,
    };
  }

  private async fetchNormalizedPredictions(forceRefresh: boolean) {
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cache.fetchedAt.getTime() < CACHE_TTL_MS) {
      return this.cache;
    }

    const url = new URL(this.getApiBaseUrl());
    url.searchParams.set('key', this.getApiKey());

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'AI-WorldCup/1.0 (+https://worldcup.local)',
      },
    });
    if (!response.ok) {
      throw new Error(`飞鲸AI预测接口请求失败：HTTP ${response.status}`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    const payload = this.parsePayload(body);
    const list = Array.isArray(payload.list) ? payload.list : [];
    const rows = list
      .map((row) => this.normalizePrediction(row as RawFeijingAiPrediction))
      .filter((row): row is NormalizedFeijingAiPrediction => row !== null);

    this.cache = { fetchedAt: new Date(), rows };
    return this.cache;
  }

  private parsePayload(buffer: Buffer): JsonRecord {
    const attempts = [buffer, this.tryGunzip(buffer)].filter(Boolean) as Buffer[];
    for (const candidate of attempts) {
      const text = candidate.toString('utf8').replace(/^\uFEFF/, '').trim();
      if (!text) continue;
      try {
        return JSON.parse(text) as JsonRecord;
      } catch {
        // continue to next decoding strategy
      }
    }
    this.logger.warn(`飞鲸AI预测接口返回无法解析，body长度：${buffer.length}`);
    throw new Error('飞鲸AI预测接口返回格式无法解析');
  }

  private tryGunzip(buffer: Buffer): Buffer | null {
    try {
      return gunzipSync(buffer);
    } catch {
      return null;
    }
  }

  private normalizePrediction(row: RawFeijingAiPrediction): NormalizedFeijingAiPrediction | null {
    const externalMatchId = this.pickString(row, 'matchId', 'matchid');
    const homeTeam = this.pickString(row, 'homeTeam', 'hometeam');
    const awayTeam = this.pickString(row, 'awayTeam', 'awayteam');
    const predictType = this.pickString(row, 'PredictType', 'predictType', 'predicttype');
    const predictContent = this.pickString(row, 'PredictContent', 'predictContent', 'predictcontent');
    if (!externalMatchId || !homeTeam || !awayTeam || !predictType || !predictContent) return null;

    const odds = this.normalizeOdds(this.pickUnknown(row, 'PredictOdds', 'predictOdds', 'predictodds'));
    return {
      externalMatchId,
      sportsType: this.toNullableNumber(this.pickUnknown(row, 'sportsType', 'sportstype')),
      matchTime: this.parseApiDate(this.pickString(row, 'matchtime')),
      matchTimeRaw: this.pickString(row, 'matchtime') || null,
      leagueName: this.pickString(row, 'leagueName', 'leaguename') || null,
      homeTeam,
      awayTeam,
      predictType,
      predictTypeLabel: this.predictTypeLabel(predictType),
      predictContent,
      predictOdds: odds,
      handicapOrLine: odds.length >= 2 ? odds[1] : null,
      updateTime: this.parseApiDate(this.pickString(row, 'updateTime', 'updatetime')),
      updateTimeRaw: this.pickString(row, 'updateTime', 'updatetime') || null,
      raw: row,
    };
  }

  private filterByDateWindow(rows: NormalizedFeijingAiPrediction[], options: ListOptions) {
    const daysBefore = Number.isFinite(options.daysBefore) ? Math.max(0, Number(options.daysBefore)) : 3;
    const daysAhead = Number.isFinite(options.daysAhead) ? Math.max(0, Number(options.daysAhead)) : 14;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysBefore);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() + daysAhead);
    return rows.filter((row) => !row.matchTime || (row.matchTime >= start && row.matchTime <= end));
  }

  private async loadCandidateMatches(rows: NormalizedFeijingAiPrediction[]) {
    const datedRows = rows.filter((row) => row.matchTime);
    const now = new Date();
    const minTime = datedRows.reduce<Date>((min, row) => (row.matchTime! < min ? row.matchTime! : min), new Date(now.getTime() - 7 * 86400000));
    const maxTime = datedRows.reduce<Date>((max, row) => (row.matchTime! > max ? row.matchTime! : max), new Date(now.getTime() + 30 * 86400000));
    const start = new Date(minTime.getTime() - 36 * 60 * 60 * 1000);
    const end = new Date(maxTime.getTime() + 36 * 60 * 60 * 1000);

    return this.prisma.match.findMany({
      where: { kickoffAt: { gte: start, lte: end } },
      include: {
        competition: true,
        homeTeam: true,
        awayTeam: true,
        sportteryMarkets: { orderBy: { syncedAt: 'desc' }, take: 1 },
      },
      orderBy: { kickoffAt: 'asc' },
    });
  }

  private findBestMatch(
    prediction: NormalizedFeijingAiPrediction,
    matches: Awaited<ReturnType<FeijingAiPredictionService['loadCandidateMatches']>>,
  ) {
    const byExternalId = matches.find((match) => match.externalId && match.externalId === prediction.externalMatchId);
    if (byExternalId) return byExternalId;

    const byMarketRawId = matches.find((match) =>
      match.sportteryMarkets.some((market) => JSON.stringify(market.rawJson ?? {}).includes(prediction.externalMatchId)),
    );
    if (byMarketRawId) return byMarketRawId;

    const predictionHome = this.normalizeName(prediction.homeTeam);
    const predictionAway = this.normalizeName(prediction.awayTeam);
    return matches.find((match) => {
      const kickoffClose = !prediction.matchTime || Math.abs(match.kickoffAt.getTime() - prediction.matchTime.getTime()) <= 36 * 60 * 60 * 1000;
      if (!kickoffClose) return false;
      const homeNames = [match.homeTeam.name, match.homeTeam.nameZh, match.homeTeam.shortName].filter(Boolean).map((name) => this.normalizeName(String(name)));
      const awayNames = [match.awayTeam.name, match.awayTeam.nameZh, match.awayTeam.shortName].filter(Boolean).map((name) => this.normalizeName(String(name)));
      return homeNames.includes(predictionHome) && awayNames.includes(predictionAway);
    });
  }

  private toResponseItem(
    prediction: NormalizedFeijingAiPrediction,
    match: Awaited<ReturnType<FeijingAiPredictionService['loadCandidateMatches']>>[number] | undefined,
  ) {
    const market = match?.sportteryMarkets[0] ?? null;
    return {
      id: `${prediction.externalMatchId}-${prediction.predictType}-${prediction.predictContent}`,
      matched: Boolean(match),
      externalMatchId: prediction.externalMatchId,
      sportsType: prediction.sportsType,
      matchTime: prediction.matchTime?.toISOString() ?? null,
      matchTimeRaw: prediction.matchTimeRaw,
      leagueName: prediction.leagueName,
      homeTeam: prediction.homeTeam,
      awayTeam: prediction.awayTeam,
      predictType: prediction.predictType,
      predictTypeLabel: prediction.predictTypeLabel,
      predictContent: prediction.predictContent,
      predictOdds: prediction.predictOdds,
      handicapOrLine: prediction.handicapOrLine,
      updateTime: prediction.updateTime?.toISOString() ?? null,
      updateTimeRaw: prediction.updateTimeRaw,
      match: match
        ? {
            id: match.id,
            externalId: match.externalId,
            competition: { id: match.competition.id, name: match.competition.name },
            kickoffAt: match.kickoffAt.toISOString(),
            status: match.status,
            homeTeam: { id: match.homeTeam.id, name: match.homeTeam.name, nameZh: match.homeTeam.nameZh, shortName: match.homeTeam.shortName },
            awayTeam: { id: match.awayTeam.id, name: match.awayTeam.name, nameZh: match.awayTeam.nameZh, shortName: match.awayTeam.shortName },
            score: match.homeScore !== null && match.awayScore !== null ? `${match.homeScore}:${match.awayScore}` : null,
            halfScore: match.homeHalfScore !== null && match.awayHalfScore !== null ? `${match.homeHalfScore}:${match.awayHalfScore}` : null,
            market: market
              ? {
                  matchNo: market.matchNo,
                  saleDate: market.saleDate,
                  handicapLine: market.handicapLine,
                  overUnderLine: market.overUnderLine,
                  winDrawLoss: market.winDrawLoss,
                  handicapResult: market.handicapResult,
                  overUnderResult: market.overUnderResult,
                  scoreResult: market.scoreResult,
                  halfFullResult: market.halfFullResult,
                }
              : null,
          }
        : null,
      raw: prediction.raw,
    };
  }

  private getApiBaseUrl() {
    return process.env.FEIJING_AI_URL || process.env.BET007_AI_URL || DEFAULT_FEIJING_AI_URL;
  }

  private getApiKey() {
    return process.env.FEIJING_AI_KEY || process.env.BET007_AI_KEY || DEFAULT_FEIJING_AI_KEY;
  }

  private pickUnknown(row: RawFeijingAiPrediction, ...keys: string[]) {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return null;
  }

  private pickString(row: RawFeijingAiPrediction, ...keys: string[]) {
    const value = this.pickUnknown(row, ...keys);
    return value === null ? '' : String(value).trim();
  }

  private normalizeOdds(value: unknown) {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    if (value === null || value === undefined) return [];
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }

  private parseApiDate(value: string | null | undefined) {
    if (!value) return null;
    const normalized = value.trim().replace(/-/g, '/');
    const parts = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(normalized);
    if (!parts) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const [, year, month, day, hour, minute, second = '0'] = parts;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private toNullableNumber(value: unknown) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private predictTypeLabel(type: string) {
    switch (String(type)) {
      case '1':
        return '让球胜负';
      case '2':
        return '大小球';
      case '3':
        return '胜平负';
      default:
        return `预测类型${type}`;
    }
  }

  private normalizeName(name: string) {
    return name
      .toLowerCase()
      .replace(/[\s\-_.·•()（）\[\]【】]/g, '')
      .replace(/足球俱乐部|俱乐部|fc|cf|sc|afc|team/g, '')
      .trim();
  }

}

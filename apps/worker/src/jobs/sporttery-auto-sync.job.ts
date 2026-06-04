/**
 * 竞彩数据自动同步定时任务
 *
 * 自动化闭环：
 * 1. 定时抓取体彩竞彩销售日期、比赛双方、盘口数据并落库
 * 2. 定时检查已开赛比赛的赛果并更新
 * 3. 新增比赛自动入队AI预测
 * 4. 赛果变更（完赛）自动触发评分和复盘
 */
import type { Prisma } from '@prisma/client';
import {
  MatchStatus,
  PredictionTrigger,
  PredictionVersion,
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
let scorecardQueue: Queue | undefined;
let reviewQueue: Queue | undefined;

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

function getScorecardQueue(): Queue {
  scorecardQueue ??= new Queue(QueueName.ScorecardUpdate, { connection: createConnection() });
  return scorecardQueue;
}

function getReviewQueue(): Queue {
  reviewQueue ??= new Queue(QueueName.PostMatchReview, { connection: createConnection() });
  return reviewQueue;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload schemas
// ─────────────────────────────────────────────────────────────────────────────

const SportterySyncPayloadSchema = z.object({
  mode: z.enum(['DAILY_FIXTURES', 'RESULT_CHECK', 'MULTI_DAY_SYNC']),
  /** 同步的销售日期，格式 yyyy-MM-dd；未传时默认当天 */
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** 多天同步时的天数范围（向后） */
  daysAhead: z.coerce.number().int().min(0).max(14).default(3),
  /** 是否将新增比赛入队预测 */
  enqueuePredictions: z.coerce.boolean().default(true),
});

export type SportterySyncPayload = z.infer<typeof SportterySyncPayloadSchema>;

interface SportteryAutoSyncSummary {
  mode: string;
  saleDates: string[];
  matchesFetched: number;
  matchesCreated: number;
  matchesUpdated: number;
  matchesSkipped: number;
  resultsUpdated: number;
  predictionsEnqueued: number;
  scorecardsTriggered: number;
  reviewsTriggered: number;
  errors: Array<{ message: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sporttery API fetcher (reuse the same logic as sporttery.client.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface SportteryRawMatch {
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
  source?: 'sporttery' | 'trade500';
  raw: Record<string, unknown>;
}

async function fetchSportteryMatches(saleDate: string): Promise<SportteryRawMatch[]> {
  const officialItems = await fetchOfficialSportteryMatches(saleDate);
  const trade500Items = await fetchTrade500SellingMatches(saleDate);
  const merged = mergeSportteryMatches([...officialItems, ...trade500Items]);

  if (merged.length === 0) {
    logger.warn({ saleDate }, 'sporttery-auto-sync: no data returned from official endpoints or trade500 fallback');
  } else if (trade500Items.length > 0) {
    logger.info(
      { saleDate, officialCount: officialItems.length, trade500Count: trade500Items.length, mergedCount: merged.length },
      'sporttery-auto-sync: merged official data with trade500 selling fixtures fallback',
    );
  }

  return merged;
}

async function fetchOfficialSportteryMatches(saleDate: string): Promise<SportteryRawMatch[]> {
  const configuredUrl = process.env.SPORTTERY_FOOTBALL_JC_URL;
  const encoded = encodeURIComponent(saleDate);

  const urls = configuredUrl
    ? [configuredUrl.replace(/\{date\}|\{saleDate\}|\$\{date\}|\$\{saleDate\}/g, encoded)]
    : [
        `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${encoded}&matchEndDate=${encoded}&leagueId=&pageSize=200&pageNo=1&isFix=0&matchPage=1&pcOrWap=1`,
        `https://webapi.sporttery.cn/gateway/jc/football/getMatchResultV1.qry?matchPage=1&matchBeginDate=${encoded}&matchEndDate=${encoded}&leagueId=&pageSize=200&pageNo=1&isFix=0`,
        `https://webapi.sporttery.cn/gateway/jc/football/getMatchInfoV1.qry?matchDate=${encoded}`,
        `https://webapi.sporttery.cn/gateway/jc/football/getMatchResultV1.qry?matchBeginDate=${encoded}&matchEndDate=${encoded}&pageSize=200&pageNo=1`,
      ];

  const errors: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          referer: 'https://www.sporttery.cn/jc/zqsgkj/',
          origin: 'https://www.sporttery.cn',
          'user-agent': 'Mozilla/5.0 AI-Worldcup-Sporttery-AutoSync/1.0',
        },
        signal: AbortSignal.timeout(Number(process.env.SPORTTERY_TIMEOUT_MS ?? 15_000)),
      });

      if (!response.ok) {
        errors.push(`${response.status} ${url}`);
        continue;
      }

      const text = await response.text();
      const payload = parseJson(text);
      const rows = extractRows(payload);
      const items = rows
        .map((row) => normalizeMatch(row, saleDate, 'sporttery'))
        .filter((item): item is SportteryRawMatch => Boolean(item));

      if (items.length > 0) return items;
      errors.push(`empty ${url}`);
    } catch (error) {
      errors.push(`${error instanceof Error ? error.message : String(error)} ${url}`);
    }
  }

  logger.warn({ saleDate, errors: errors.slice(0, 3) }, 'sporttery-auto-sync: official endpoints returned no data');
  return [];
}

async function fetchTrade500SellingMatches(saleDate: string): Promise<SportteryRawMatch[]> {
  const enabled = (process.env.SPORTTERY_TRADE500_FALLBACK_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!enabled) return [];

  const configuredUrl = process.env.SPORTTERY_TRADE500_JCZQ_URL ?? 'https://trade.500.com/jczq/';
  try {
    const response = await fetch(configuredUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        referer: 'https://trade.500.com/jczq/',
        'user-agent': 'Mozilla/5.0 AI-Worldcup-Sporttery-AutoSync/1.0',
      },
      signal: AbortSignal.timeout(Number(process.env.SPORTTERY_TIMEOUT_MS ?? 15_000)),
    });

    if (!response.ok) {
      logger.warn({ saleDate, status: response.status }, 'sporttery-auto-sync: trade500 fallback request failed');
      return [];
    }

    const html = decodeChineseHtml(Buffer.from(await response.arrayBuffer()));
    return extractTrade500Rows(html, saleDate);
  } catch (error) {
    logger.warn({ saleDate, error: error instanceof Error ? error.message : String(error) }, 'sporttery-auto-sync: trade500 fallback failed');
    return [];
  }
}

function decodeChineseHtml(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (!/�/.test(utf8) && !/charset=(gb2312|gbk|gb18030)/i.test(utf8)) return utf8;
  return new TextDecoder('gb18030').decode(buffer);
}

function extractTrade500Rows(html: string, saleDate: string): SportteryRawMatch[] {
  const rows: SportteryRawMatch[] = [];
  const rowRegex = /<tr\b([^>]*class=["'][^"']*bet-tb-tr[^"']*["'][^>]*)>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(html))) {
    const attrs = parseHtmlAttributes(match[1]);
    const processDate = attrs['data-processdate'] ?? attrs['data-saledate'] ?? saleDate;
    if (processDate !== saleDate) continue;
    if (attrs['data-isend'] === '1') continue;

    const matchNo = attrs['data-matchnum'];
    const homeTeamName = attrs['data-homesxname'];
    const awayTeamName = attrs['data-awaysxname'];
    if (!matchNo || !homeTeamName || !awayTeamName) continue;

    const matchDate = attrs['data-matchdate'];
    const matchTime = attrs['data-matchtime'];
    const kickoffAt = matchDate && matchTime ? normalizeDateTimeWithCst(matchDate, matchTime) : undefined;
    const handicapLine = parseFiniteNumber(attrs['data-rangqiu']);

    rows.push({
      saleDate: processDate,
      matchNo,
      issueNo: attrs['data-processid'] ?? attrs['data-id'] ?? undefined,
      leagueName: attrs['data-simpleleague'] ?? undefined,
      homeTeamName,
      awayTeamName,
      kickoffAt,
      status: 'SCHEDULED',
      handicapLine,
      source: 'trade500',
      raw: {
        source: 'trade500',
        attrs,
        rowText: stripHtml(match[2]),
      },
    });
  }

  return rows;
}

function parseHtmlAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z0-9_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(input))) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function normalizeDateTimeWithCst(datePart: string, timePart: string): string | undefined {
  const normalizedTime = /^\d{1}:/.test(timePart) ? `0${timePart}` : timePart;
  const withSeconds = /^\d{2}:\d{2}$/.test(normalizedTime) ? `${normalizedTime}:00` : normalizedTime;
  const date = new Date(`${datePart}T${withSeconds}+08:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseFiniteNumber(value?: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeSportteryMatches(items: SportteryRawMatch[]): SportteryRawMatch[] {
  const merged = new Map<string, SportteryRawMatch>();
  for (const item of items) {
    const key = `${item.saleDate}:${item.matchNo}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    const preferNew = !existing.kickoffAt && Boolean(item.kickoffAt) || (!existing.scoreResult && Boolean(item.scoreResult));
    merged.set(key, preferNew ? { ...existing, ...item, raw: { official: existing.raw, fallback: item.raw } } : { ...item, ...existing, raw: { official: existing.raw, fallback: item.raw } });
  }
  return [...merged.values()];
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^callback\((.*)\);?$/s, '$1');
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function extractRows(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const candidates = [payload.value, payload.data, payload.result, payload.rows, payload.list, payload.matches, payload];
  for (const candidate of candidates) {
    const rows = unwrapRows(candidate);
    if (rows.length > 0) return rows;
  }
  return [];
}

function unwrapRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const nestedKeys = ['matchResult', 'matchInfo', 'list', 'rows', 'matches', 'data', 'value'];
  for (const key of nestedKeys) {
    const rows = unwrapRows(record[key]);
    if (rows.length > 0) return rows;
  }
  return [];
}

function normalizeMatch(row: Record<string, unknown>, fallbackDate: string, source: 'sporttery' | 'trade500' = 'sporttery'): SportteryRawMatch | null {
  const saleDate = firstString(row, ['saleDate', 'matchDate', 'businessDate', 'date']) ?? fallbackDate;
  const matchNo = firstString(row, ['matchNumStr', 'matchNo', 'matchNum', 'num', 'serialNo', 'matchCode']);
  const homeTeamName = firstString(row, ['homeTeamAbbName', 'homeTeamName', 'homeName', 'hostName', 'allHomeTeam', 'homeTeam', 'home']);
  const awayTeamName = firstString(row, ['awayTeamAbbName', 'awayTeamName', 'awayName', 'guestName', 'allAwayTeam', 'awayTeam', 'away']);
  if (!matchNo || !homeTeamName || !awayTeamName) return null;

  return {
    saleDate,
    matchNo,
    issueNo: firstString(row, ['issueNo', 'issue', 'poolCode', 'matchId']),
    leagueName: firstString(row, ['leagueAbbName', 'leagueName', 'lName']),
    homeTeamName,
    awayTeamName,
    kickoffAt: normalizeKickoff(row, saleDate),
    status: firstString(row, ['matchStatus', 'status', 'matchState', 'matchResultStatus', 'poolStatus', 'resultStatus']),
    handicapLine: firstNumber(row, ['handicap', 'fixedodds', 'goalline', 'hhadGoalLine', 'letBall', 'goalLine']),
    overUnderLine: firstNumber(row, ['overUnderLine', 'totalGoalLine']),
    winDrawLoss: mapResult(firstString(row, ['spfResult', 'hadResult', 'winDrawLoss', 'result', 'winFlag'])),
    handicapResult: mapResult(firstString(row, ['rqspfResult', 'hhadResult', 'handicapResult', 'letBallResult'])),
    overUnderResult: mapOverUnder(firstString(row, ['overUnderResult', 'bigSmallResult', 'ouResult'])),
    scoreResult: firstString(row, ['scoreResult', 'bfResult', 'score', 'fullScore', 'sectionsNo999']),
    halfFullResult: firstString(row, ['halfFullResult', 'bqcResult', 'hafuResult', 'sectionsNo1']),
    source,
    raw: row,
  };
}

function normalizeKickoff(row: Record<string, unknown>, saleDate: string): string | undefined {
  const combined = firstString(row, ['matchTime', 'startTime', 'kickoffAt', 'matchDateTime']);
  if (combined && /\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{1,2}:\d{2}/.test(combined)) {
    const date = new Date(combined.replace(/\//g, '-'));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const time = firstString(row, ['startTime', 'time']);
  if (!time || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) return undefined;

  const normalizedTime = /^\d{1}:/.test(time) ? `0${time}` : time;
  const withSeconds = /^\d{2}:\d{2}$/.test(normalizedTime) ? `${normalizedTime}:00` : normalizedTime;
  const date = new Date(`${saleDate}T${withSeconds}+08:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return undefined;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function mapResult(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^(3|胜|主胜|H|HOME|HOME_WIN)$/i.test(value)) return 'HOME_WIN';
  if (/^(1|平|D|DRAW)$/i.test(value)) return 'DRAW';
  if (/^(0|负|客胜|A|AWAY|AWAY_WIN)$/i.test(value)) return 'AWAY_WIN';
  return value;
}

function mapOverUnder(value?: string): string | undefined {
  if (!value) return undefined;
  if (/^(大|OVER)$/i.test(value)) return 'OVER';
  if (/^(小|UNDER)$/i.test(value)) return 'UNDER';
  return value;
}

function mapSportteryStatus(item: SportteryRawMatch): MatchStatus {
  const raw = (item.status ?? '').toLowerCase();
  if (/finish|ended|完|已开奖|已完赛/.test(raw) || item.scoreResult) return MatchStatus.FINISHED;
  if (/live|进行|半场/.test(raw)) return MatchStatus.LIVE;
  if (/cancel|取消/.test(raw)) return MatchStatus.CANCELED;
  if (/postpon|延期/.test(raw)) return MatchStatus.POSTPONED;
  return MatchStatus.SCHEDULED;
}

function slugify(value: string): string {
  const ascii = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return ascii || Buffer.from(value).toString('hex').slice(0, 24);
}

function formatDate(date: Date): string {
  // 使用北京时间
  const offset = 8 * 60 * 60 * 1000;
  const local = new Date(date.getTime() + offset);
  return local.toISOString().slice(0, 10);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseScore(scoreResult: string): { home: number; away: number } | null {
  const match = scoreResult.match(/(\d+)\s*[:-]\s*(\d+)/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processSportteryAutoSync(job: Job<unknown>): Promise<{ ok: true; summary: SportteryAutoSyncSummary }> {
  const payload = SportterySyncPayloadSchema.parse(job.data);
  logger.info({ jobId: job.id, payload }, 'sporttery-auto-sync: starting');

  const summary: SportteryAutoSyncSummary = {
    mode: payload.mode,
    saleDates: [],
    matchesFetched: 0,
    matchesCreated: 0,
    matchesUpdated: 0,
    matchesSkipped: 0,
    resultsUpdated: 0,
    predictionsEnqueued: 0,
    scorecardsTriggered: 0,
    reviewsTriggered: 0,
    errors: [],
  };

  try {
    switch (payload.mode) {
      case 'DAILY_FIXTURES':
        await syncDailyFixtures(payload, summary);
        break;
      case 'RESULT_CHECK':
        await checkResults(payload, summary);
        break;
      case 'MULTI_DAY_SYNC':
        await syncMultipleDays(payload, summary);
        break;
    }
  } catch (error) {
    summary.errors.push({ message: error instanceof Error ? error.message : String(error) });
  }

  // 写入同步日志
  await prisma.footballDataSyncLog.create({
    data: {
      provider: 'sporttery',
      scope: `AUTO_${payload.mode}`,
      status: summary.errors.length === 0 ? 'SUCCEEDED' : (summary.matchesCreated + summary.matchesUpdated > 0 ? 'PARTIAL_SUCCESS' : 'FAILED'),
      params: toPrismaJson(payload),
      summary: toPrismaJson(summary),
      finishedAt: new Date(),
    },
  });

  logger.info({ jobId: job.id, summary }, 'sporttery-auto-sync: completed');
  return { ok: true, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode: DAILY_FIXTURES - 每天定时同步当天+未来N天竞彩赛程
// ─────────────────────────────────────────────────────────────────────────────

async function syncDailyFixtures(payload: SportterySyncPayload, summary: SportteryAutoSyncSummary): Promise<void> {
  const today = payload.saleDate ? new Date(`${payload.saleDate}T00:00:00+08:00`) : new Date();
  const daysAhead = payload.daysAhead ?? 3;

  for (let i = 0; i <= daysAhead; i++) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const saleDate = formatDate(date);
    summary.saleDates.push(saleDate);

    const items = await fetchSportteryMatches(saleDate);
    summary.matchesFetched += items.length;

    if (items.length === 0) {
      logger.info({ saleDate }, 'sporttery-auto-sync: no matches for date');
      continue;
    }

    // 确保竞彩赛事存在
    const season = saleDate.slice(0, 4);
    const competitionExternalId = `sporttery:football:${season}`;
    const competition = await prisma.competition.upsert({
      where: { externalId: competitionExternalId },
      update: { status: 'ACTIVE' },
      create: {
        code: `SPT-JC-${season}`.slice(0, 40),
        name: `中国竞彩网竞彩足球 ${season}`,
        type: 'OTHER',
        season,
        country: '中国',
        status: 'ACTIVE',
        externalId: competitionExternalId,
      },
    });

    for (const item of items) {
      try {
        await upsertSportteryMatchAndTrigger(competition.id, item, payload.enqueuePredictions, summary);
      } catch (error) {
        summary.errors.push({ message: `${item.matchNo}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode: RESULT_CHECK - 定时检查已开赛比赛的赛果
// ─────────────────────────────────────────────────────────────────────────────

async function checkResults(payload: SportterySyncPayload, summary: SportteryAutoSyncSummary): Promise<void> {
  // 1. 查找最近3天内状态为 SCHEDULED 或 LIVE 的比赛对应的销售日期
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const pendingMarkets = await prisma.sportteryMatchMarket.findMany({
    where: {
      provider: 'sporttery',
      OR: [
        { status: 'SCHEDULED' },
        { status: { contains: 'LIVE' } },
        { status: { contains: '进行' } },
      ],
      kickoffAt: { gte: threeDaysAgo, lte: new Date() },
    },
    select: { saleDate: true },
    distinct: ['saleDate'],
  });

  const saleDates = [...new Set(pendingMarkets.map((m) => m.saleDate))];

  // 2. 始终包含今天和昨天的日期，确保跨天赛果能被拉取
  const today = formatDate(new Date());
  const yesterday = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (!saleDates.includes(today)) saleDates.push(today);
  if (!saleDates.includes(yesterday)) saleDates.push(yesterday);

  // 3. 同时查找 match 表中仍为 SCHEDULED 状态但 kickoffAt 已过的比赛对应的 saleDate
  const pendingMatches = await prisma.match.findMany({
    where: {
      status: { in: ['SCHEDULED', 'LIVE'] },
      kickoffAt: { gte: threeDaysAgo, lte: new Date() },
    },
    select: { matchday: true },
  });
  for (const m of pendingMatches) {
    if (m.matchday && !saleDates.includes(m.matchday)) {
      saleDates.push(m.matchday);
    }
  }

  summary.saleDates = saleDates;

  for (const saleDate of saleDates) {
    const items = await fetchSportteryMatches(saleDate);
    summary.matchesFetched += items.length;

    for (const item of items) {
      try {
        await updateMatchResult(item, summary);
      } catch (error) {
        summary.errors.push({ message: `${item.matchNo}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode: MULTI_DAY_SYNC - 一次性同步多天数据
// ─────────────────────────────────────────────────────────────────────────────

async function syncMultipleDays(payload: SportterySyncPayload, summary: SportteryAutoSyncSummary): Promise<void> {
  const today = payload.saleDate ? new Date(`${payload.saleDate}T00:00:00+08:00`) : new Date();
  const daysAhead = payload.daysAhead ?? 3;

  for (let i = 0; i <= daysAhead; i++) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const saleDate = formatDate(date);
    summary.saleDates.push(saleDate);

    const items = await fetchSportteryMatches(saleDate);
    summary.matchesFetched += items.length;

    if (items.length === 0) continue;

    const season = saleDate.slice(0, 4);
    const competitionExternalId = `sporttery:football:${season}`;
    const competition = await prisma.competition.upsert({
      where: { externalId: competitionExternalId },
      update: { status: 'ACTIVE' },
      create: {
        code: `SPT-JC-${season}`.slice(0, 40),
        name: `中国竞彩网竞彩足球 ${season}`,
        type: 'OTHER',
        season,
        country: '中国',
        status: 'ACTIVE',
        externalId: competitionExternalId,
      },
    });

    for (const item of items) {
      try {
        await upsertSportteryMatchAndTrigger(competition.id, item, payload.enqueuePredictions, summary);
      } catch (error) {
        summary.errors.push({ message: `${item.matchNo}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: Upsert match + auto-trigger prediction
// ─────────────────────────────────────────────────────────────────────────────

async function upsertSportteryMatchAndTrigger(
  competitionId: string,
  item: SportteryRawMatch,
  enqueuePredictions: boolean,
  summary: SportteryAutoSyncSummary,
): Promise<void> {
  const externalId = `sporttery:football:${item.saleDate}:${item.matchNo}`;
  const kickoffAt = item.kickoffAt ? new Date(item.kickoffAt) : null;
  const existingMarket = await prisma.sportteryMatchMarket.findUnique({
    where: { provider_saleDate_matchNo: { provider: 'sporttery', saleDate: item.saleDate, matchNo: item.matchNo } },
  });

  if (!kickoffAt || Number.isNaN(kickoffAt.getTime())) {
    await prisma.sportteryMatchMarket.upsert({
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
        rawJson: toPrismaJson(item.raw),
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
        rawJson: toPrismaJson(item.raw),
      },
    });
    summary.matchesSkipped += 1;
    if (existingMarket) summary.matchesUpdated += 1;
    else summary.matchesCreated += 1;
    return;
  }

  // Upsert teams
  const [homeTeam, awayTeam] = await Promise.all([
    upsertTeam(item.homeTeamName),
    upsertTeam(item.awayTeamName),
  ]);

  const matchStatus = mapSportteryStatus(item);
  const existing = await prisma.match.findUnique({ where: { externalId } });
  const wasFinished = existing?.status === MatchStatus.FINISHED;

  // Upsert match
  const matchData = {
    competitionId,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    kickoffAt,
    status: matchStatus,
    matchday: item.saleDate,
    handicapLine: item.handicapLine ?? null,
    overUnderLine: item.overUnderLine ?? null,
    externalId,
  };

  // 如果有比分，解析并更新
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  if (item.scoreResult) {
    const score = parseScore(item.scoreResult);
    if (score) {
      homeScore = score.home;
      awayScore = score.away;
    }
  }

  const match = await prisma.match.upsert({
    where: { externalId },
    update: {
      ...matchData,
      ...(homeScore !== null ? { homeScore } : {}),
      ...(awayScore !== null ? { awayScore } : {}),
    },
    create: {
      ...matchData,
      homeScore,
      awayScore,
    },
  });

  // Upsert SportteryMatchMarket
  await prisma.sportteryMatchMarket.upsert({
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
      rawJson: toPrismaJson(item.raw),
      syncedAt: new Date(),
    },
    create: {
      provider: 'sporttery',
      saleDate: item.saleDate,
      matchNo: item.matchNo,
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
      rawJson: toPrismaJson(item.raw),
    },
  });

  if (existing) {
    summary.matchesUpdated += 1;
  } else {
    summary.matchesCreated += 1;
  }

  // 自动触发逻辑
  // 1. 未开赛且允许预测 -> 入队 AI 预测；enqueuePredictionForMatch 内部会跳过已有任务，便于补偿同步。
  if (matchStatus === MatchStatus.SCHEDULED && enqueuePredictions) {
    await enqueuePredictionForMatch(match.id, summary);
  }

  // 2. 比赛从非完赛变为完赛 -> 触发评分和复盘
  if (!wasFinished && matchStatus === MatchStatus.FINISHED) {
    await triggerPostMatchPipeline(match.id, summary);
  }
}

async function updateMatchResult(item: SportteryRawMatch, summary: SportteryAutoSyncSummary): Promise<void> {
  const externalId = `sporttery:football:${item.saleDate}:${item.matchNo}`;
  let match = await prisma.match.findUnique({ where: { externalId } });

  // 跨 saleDate 匹配：体彩赛果数据的 saleDate 可能与原始入库时的 saleDate 不同
  // 例如：比赛入库时 saleDate=2026-06-03，但赛果在 saleDate=2026-06-04 的接口中返回
  if (!match) {
    // 通过 matchNo 在近几天的 externalId 中搜索
    const matchNoSuffix = `:${item.matchNo}`;
    const candidates = await prisma.match.findMany({
      where: {
        externalId: { endsWith: matchNoSuffix },
        status: { in: ['SCHEDULED', 'LIVE'] },
      },
    });
    if (candidates.length === 1) {
      match = candidates[0];
    } else if (candidates.length > 1) {
      // 多个候选时，选择 kickoffAt 最接近当前时间的
      match = candidates.sort((a, b) =>
        Math.abs(a.kickoffAt.getTime() - Date.now()) - Math.abs(b.kickoffAt.getTime() - Date.now())
      )[0];
    }
  }

  // 还是找不到，尝试通过 sportteryMatchMarket 的 matchId 关联
  if (!match) {
    const market = await prisma.sportteryMatchMarket.findFirst({
      where: {
        provider: 'sporttery',
        matchNo: item.matchNo,
        matchId: { not: null },
      },
      orderBy: { syncedAt: 'desc' },
    });
    if (market?.matchId) {
      match = await prisma.match.findUnique({ where: { id: market.matchId } });
    }
  }

  if (!match) return;

  const newStatus = mapSportteryStatus(item);
  const wasFinished = match.status === MatchStatus.FINISHED;

  // 解析比分
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  if (item.scoreResult) {
    const score = parseScore(item.scoreResult);
    if (score) {
      homeScore = score.home;
      awayScore = score.away;
    }
  }

  // 只有状态或比分有变化时才更新
  const statusChanged = match.status !== newStatus;
  const scoreChanged = (homeScore !== null && match.homeScore !== homeScore) || (awayScore !== null && match.awayScore !== awayScore);

  if (!statusChanged && !scoreChanged) return;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      status: newStatus,
      ...(homeScore !== null ? { homeScore } : {}),
      ...(awayScore !== null ? { awayScore } : {}),
    },
  });

  // 更新 SportteryMatchMarket
  await prisma.sportteryMatchMarket.updateMany({
    where: { provider: 'sporttery', saleDate: item.saleDate, matchNo: item.matchNo },
    data: {
      status: item.status ?? newStatus,
      winDrawLoss: item.winDrawLoss ?? null,
      handicapResult: item.handicapResult ?? null,
      overUnderResult: item.overUnderResult ?? null,
      scoreResult: item.scoreResult ?? null,
      halfFullResult: item.halfFullResult ?? null,
      rawJson: toPrismaJson(item.raw),
      syncedAt: new Date(),
    },
  });

  summary.resultsUpdated += 1;

  // 完赛触发评分和复盘
  if (!wasFinished && newStatus === MatchStatus.FINISHED) {
    await triggerPostMatchPipeline(match.id, summary);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-trigger helpers
// ─────────────────────────────────────────────────────────────────────────────

async function enqueuePredictionForMatch(matchId: string, summary: SportteryAutoSyncSummary): Promise<void> {
  try {
    // 检查是否已有预测任务
    const existingTask = await prisma.predictionTask.findUnique({
      where: { matchId_version: { matchId, version: PredictionVersion.T_MINUS_7H } },
    });
    if (existingTask) return;

    await getPredictionQueue().add(
      'generate-prediction',
      {
        matchId,
        version: PredictionVersion.T_MINUS_7H,
        trigger: PredictionTrigger.CRON,
        rerun: false,
      },
      {
        jobId: `sporttery-auto-prediction-${matchId}-${PredictionVersion.T_MINUS_7H}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
    summary.predictionsEnqueued += 1;
    logger.info({ matchId }, 'sporttery-auto-sync: prediction enqueued');
  } catch (error) {
    summary.errors.push({ message: `prediction enqueue failed for ${matchId}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function triggerPostMatchPipeline(matchId: string, summary: SportteryAutoSyncSummary): Promise<void> {
  try {
    // 触发评分
    await getScorecardQueue().add(
      'update-scorecard',
      { matchId, trigger: 'CRON', mode: 'MATCH' },
      {
        jobId: `sporttery-auto-scorecard-${matchId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    summary.scorecardsTriggered += 1;

    // 触发复盘
    await getReviewQueue().add(
      'generate-review',
      { matchId, trigger: 'CRON' },
      {
        jobId: `sporttery-auto-review-${matchId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    summary.reviewsTriggered += 1;

    logger.info({ matchId }, 'sporttery-auto-sync: post-match pipeline triggered');
  } catch (error) {
    summary.errors.push({ message: `post-match pipeline failed for ${matchId}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function upsertTeam(name: string): Promise<{ id: string }> {
  const normalized = name.trim();
  const externalId = `sporttery:team:${slugify(normalized)}`;
  return prisma.team.upsert({
    where: { externalId },
    update: { name: normalized, nameZh: normalized, shortName: normalized },
    create: {
      code: `SPT-${slugify(normalized).slice(0, 24)}`.toUpperCase(),
      name: normalized,
      nameZh: normalized,
      shortName: normalized,
      externalId,
    },
  });
}

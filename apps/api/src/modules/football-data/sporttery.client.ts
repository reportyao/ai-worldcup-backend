import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../../config/configuration.js';
import type { SportteryFootballMatch } from './football-data.types.js';

interface SportteryEndpointPayload {
  value?: unknown;
  data?: unknown;
  result?: unknown;
  rows?: unknown;
  list?: unknown;
  matches?: unknown;
  [key: string]: unknown;
}

@Injectable()
export class SportteryClient {
  private readonly logger = new Logger(SportteryClient.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async getDailyFootballMatches(saleDate: string): Promise<SportteryFootballMatch[]> {
    const urls = this.buildCandidateUrls(saleDate);
    const errors: string[] = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: {
            accept: 'application/json,text/plain,*/*',
            referer: 'https://www.sporttery.cn/jc/zqsgkj/',
            origin: 'https://www.sporttery.cn',
            'user-agent': 'Mozilla/5.0 AI-Worldcup-Sporttery-Sync/1.0',
          },
          signal: AbortSignal.timeout(Number(process.env.SPORTTERY_TIMEOUT_MS ?? 15_000)),
        });
        if (!response.ok) {
          errors.push(`${response.status} ${url}`);
          continue;
        }
        const text = await response.text();
        const payload = this.parseJson(text);
        const items = this.extractRows(payload).map((row) => this.normalizeMatch(row, saleDate)).filter((item): item is SportteryFootballMatch => Boolean(item));
        if (items.length > 0) return items;
        errors.push(`empty ${url}`);
      } catch (error) {
        errors.push(`${error instanceof Error ? error.message : String(error)} ${url}`);
      }
    }
    this.logger.warn(`Sporttery sync returned no rows. ${errors.slice(0, 3).join('; ')}`);
    return [];
  }

  private buildCandidateUrls(saleDate: string): string[] {
    const configured = process.env.SPORTTERY_FOOTBALL_JC_URL || this.config.get('SPORTTERY_FOOTBALL_JC_URL' as never, { infer: true }) as string | undefined;
    if (configured) return [this.interpolateUrl(configured, saleDate)];
    const encoded = encodeURIComponent(saleDate);
    return [
      `https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry?matchBeginDate=${encoded}&matchEndDate=${encoded}&leagueId=&pageSize=200&pageNo=1&isFix=0&matchPage=1&pcOrWap=1`,
      `https://webapi.sporttery.cn/gateway/jc/football/getMatchResultV1.qry?matchPage=1&matchBeginDate=${encoded}&matchEndDate=${encoded}&leagueId=&pageSize=200&pageNo=1&isFix=0`,
      `https://webapi.sporttery.cn/gateway/jc/football/getMatchInfoV1.qry?matchDate=${encoded}`,
      `https://webapi.sporttery.cn/gateway/jc/football/getMatchResultV1.qry?matchBeginDate=${encoded}&matchEndDate=${encoded}&pageSize=200&pageNo=1`,
    ];
  }

  private interpolateUrl(url: string, saleDate: string): string {
    return url.replace(/\{date\}|\{saleDate\}|\$\{date\}|\$\{saleDate\}/g, encodeURIComponent(saleDate));
  }

  private parseJson(text: string): SportteryEndpointPayload {
    const cleaned = text.trim().replace(/^callback\((.*)\);?$/s, '$1');
    return JSON.parse(cleaned) as SportteryEndpointPayload;
  }

  private extractRows(payload: SportteryEndpointPayload): Array<Record<string, unknown>> {
    const candidates = [payload.value, payload.data, payload.result, payload.rows, payload.list, payload.matches, payload];
    for (const candidate of candidates) {
      const rows = this.unwrapRows(candidate);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  private unwrapRows(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    const nestedKeys = ['matchResult', 'matchInfo', 'list', 'rows', 'matches', 'data', 'value'];
    for (const key of nestedKeys) {
      const rows = this.unwrapRows(record[key]);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  private normalizeMatch(row: Record<string, unknown>, fallbackDate: string): SportteryFootballMatch | null {
    const saleDate = this.firstString(row, ['saleDate', 'matchDate', 'businessDate', 'date']) ?? fallbackDate;
    const matchNo = this.firstString(row, ['matchNumStr', 'matchNo', 'matchNum', 'num', 'serialNo', 'matchCode']);
    const homeTeamName = this.firstString(row, ['homeTeamAbbName', 'homeTeamName', 'homeName', 'hostName', 'allHomeTeam', 'homeTeam', 'home']);
    const awayTeamName = this.firstString(row, ['awayTeamAbbName', 'awayTeamName', 'awayName', 'guestName', 'allAwayTeam', 'awayTeam', 'away']);
    if (!matchNo || !homeTeamName || !awayTeamName) return null;

    return {
      saleDate,
      matchNo,
      issueNo: this.firstString(row, ['issueNo', 'issue', 'poolCode', 'matchId']),
      leagueName: this.firstString(row, ['leagueAbbName', 'leagueName', 'lName']),
      homeTeamName,
      awayTeamName,
      kickoffAt: this.normalizeKickoff(row, saleDate),
      status: this.firstString(row, ['matchStatus', 'status', 'matchState', 'matchResultStatus', 'poolStatus', 'resultStatus']),
      handicapLine: this.firstNumber(row, ['handicap', 'fixedodds', 'goalline', 'hhadGoalLine', 'letBall', 'goalLine']),
      overUnderLine: this.firstNumber(row, ['overUnderLine', 'totalGoalLine']),
      winDrawLoss: this.mapResult(this.firstString(row, ['spfResult', 'hadResult', 'winDrawLoss', 'result', 'winFlag'])),
      handicapResult: this.mapResult(this.firstString(row, ['rqspfResult', 'hhadResult', 'handicapResult', 'letBallResult'])),
      overUnderResult: this.mapOverUnder(this.firstString(row, ['overUnderResult', 'bigSmallResult', 'ouResult'])),
      scoreResult: this.firstString(row, ['scoreResult', 'bfResult', 'score', 'fullScore', 'sectionsNo999']),
      halfFullResult: this.firstString(row, ['halfFullResult', 'bqcResult', 'hafuResult', 'sectionsNo1']),
      raw: row,
    };
  }

  private normalizeKickoff(row: Record<string, unknown>, saleDate: string): string | undefined {
    const combined = this.firstString(row, ['matchTime', 'startTime', 'kickoffAt', 'matchDateTime']);
    if (combined && /\d{4}-\d{2}-\d{2}/.test(combined)) return new Date(combined.replace(/\//g, '-')).toISOString();
    const time = this.firstString(row, ['matchTime', 'startTime', 'time']) ?? '00:00:00';
    const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
    const date = new Date(`${saleDate}T${normalizedTime}+08:00`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  private firstString(row: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return undefined;
  }

  private firstNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
      const value = row[key];
      if (value === undefined || value === null || value === '') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private mapResult(value?: string): string | undefined {
    if (!value) return undefined;
    if (/^(3|胜|主胜|H|HOME|HOME_WIN)$/i.test(value)) return 'HOME_WIN';
    if (/^(1|平|D|DRAW)$/i.test(value)) return 'DRAW';
    if (/^(0|负|客胜|A|AWAY|AWAY_WIN)$/i.test(value)) return 'AWAY_WIN';
    return value;
  }

  private mapOverUnder(value?: string): string | undefined {
    if (!value) return undefined;
    if (/^(大|OVER)$/i.test(value)) return 'OVER';
    if (/^(小|UNDER)$/i.test(value)) return 'UNDER';
    return value;
  }
}

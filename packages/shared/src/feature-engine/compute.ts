/**
 * Feature Engine - Compute Module
 * --------------------------------
 * Pure functions that compute team features from historical match data.
 * These functions are database-agnostic and operate on normalized input arrays.
 */

import type {
  HeadToHeadStats,
  MatchFeatureSet,
  ScheduleFatigue,
  TeamFormStats,
  VenueStats,
  FeatureComputeResult,
  CompetitionContext,
} from './types.js';

// ─── Input Types (database-agnostic) ────────────────────────────────────────────

/** Minimal match record needed for feature computation */
export interface HistoricalMatch {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoffAt: Date;
  status: string;
  competitionId: string;
}

export interface MatchContext {
  matchId: string;
  homeTeamId: string;
  homeTeamName: string;
  homeTeamCode: string;
  awayTeamId: string;
  awayTeamName: string;
  awayTeamCode: string;
  competitionId: string;
  competitionName: string;
  competitionSeason: string;
  competitionPriority: 'P0' | 'P1' | 'P2' | 'P3';
  kickoffAt: Date;
  stage: string | null;
  matchday: string | null;
}

export const FEATURE_VERSION = 'v1.0';

// ─── Core Computation ───────────────────────────────────────────────────────────

/**
 * Compute the full feature set for a match given historical data.
 */
export function computeMatchFeatures(
  context: MatchContext,
  homeTeamMatches: HistoricalMatch[],
  awayTeamMatches: HistoricalMatch[],
  h2hMatches: HistoricalMatch[],
): FeatureComputeResult {
  const homeRecentForm = computeTeamForm(context.homeTeamId, homeTeamMatches, 10);
  const homeLast5Form = computeTeamForm(context.homeTeamId, homeTeamMatches, 5);
  const homeVenue = computeVenueStats(context.homeTeamId, homeTeamMatches, 'home');
  const homeFatigue = computeFatigue(context.homeTeamId, homeTeamMatches, context.kickoffAt);

  const awayRecentForm = computeTeamForm(context.awayTeamId, awayTeamMatches, 10);
  const awayLast5Form = computeTeamForm(context.awayTeamId, awayTeamMatches, 5);
  const awayVenue = computeVenueStats(context.awayTeamId, awayTeamMatches, 'away');
  const awayFatigue = computeFatigue(context.awayTeamId, awayTeamMatches, context.kickoffAt);

  const headToHead = computeHeadToHead(context.homeTeamId, context.awayTeamId, h2hMatches);

  const dataQuality = assessDataQuality(homeTeamMatches, awayTeamMatches, h2hMatches);

  const competition: CompetitionContext = {
    competitionName: context.competitionName,
    season: context.competitionSeason,
    priority: context.competitionPriority,
    stage: context.stage,
    matchday: context.matchday,
  };

  const features: MatchFeatureSet = {
    version: FEATURE_VERSION,
    computedAt: new Date().toISOString(),
    competition,
    match: {
      kickoffAt: context.kickoffAt.toISOString(),
      homeTeamName: context.homeTeamName,
      homeTeamCode: context.homeTeamCode,
      awayTeamName: context.awayTeamName,
      awayTeamCode: context.awayTeamCode,
    },
    homeTeam: {
      recentForm: homeRecentForm,
      last5Form: homeLast5Form,
      homeVenue,
      fatigue: homeFatigue,
    },
    awayTeam: {
      recentForm: awayRecentForm,
      last5Form: awayLast5Form,
      awayVenue: awayVenue,
      fatigue: awayFatigue,
    },
    headToHead,
    dataQuality,
  };

  const summaryText = generateSummaryText(features);

  return {
    matchId: context.matchId,
    featureVersion: FEATURE_VERSION,
    features,
    summaryText,
    dataQuality: dataQuality.level,
    missingSignals: dataQuality.missingSignals,
  };
}

// ─── Team Form Calculation ──────────────────────────────────────────────────────

function computeTeamForm(teamId: string, matches: HistoricalMatch[], limit: number): TeamFormStats {
  // Only use finished matches with valid scores
  const finished = matches
    .filter((m) => m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null)
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime())
    .slice(0, limit);

  if (finished.length === 0) {
    return createEmptyFormStats();
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsScored = 0;
  let goalsConceded = 0;
  let cleanSheets = 0;
  let failedToScore = 0;
  const formChars: string[] = [];

  for (const match of finished) {
    const isHome = match.homeTeamId === teamId;
    const scored = isHome ? match.homeScore! : match.awayScore!;
    const conceded = isHome ? match.awayScore! : match.homeScore!;

    goalsScored += scored;
    goalsConceded += conceded;

    if (conceded === 0) cleanSheets++;
    if (scored === 0) failedToScore++;

    if (scored > conceded) {
      wins++;
      formChars.push('W');
    } else if (scored === conceded) {
      draws++;
      formChars.push('D');
    } else {
      losses++;
      formChars.push('L');
    }
  }

  const matchesAnalyzed = finished.length;
  return {
    matchesAnalyzed,
    wins,
    draws,
    losses,
    goalsScored,
    goalsConceded,
    avgGoalsScored: round2(goalsScored / matchesAnalyzed),
    avgGoalsConceded: round2(goalsConceded / matchesAnalyzed),
    winRate: round2(wins / matchesAnalyzed),
    pointsPerMatch: round2((wins * 3 + draws) / matchesAnalyzed),
    formString: formChars.join(''),
    cleanSheets,
    failedToScore,
  };
}

// ─── Venue Stats ────────────────────────────────────────────────────────────────

function computeVenueStats(teamId: string, matches: HistoricalMatch[], venue: 'home' | 'away'): VenueStats {
  const venueMatches = matches.filter((m) => {
    if (m.status !== 'FINISHED' || m.homeScore === null || m.awayScore === null) return false;
    return venue === 'home' ? m.homeTeamId === teamId : m.awayTeamId === teamId;
  });

  if (venueMatches.length === 0) {
    return { matchesPlayed: 0, winRate: 0, avgGoalsScored: 0, avgGoalsConceded: 0 };
  }

  let wins = 0;
  let goalsScored = 0;
  let goalsConceded = 0;

  for (const match of venueMatches) {
    const isHome = match.homeTeamId === teamId;
    const scored = isHome ? match.homeScore! : match.awayScore!;
    const conceded = isHome ? match.awayScore! : match.homeScore!;
    goalsScored += scored;
    goalsConceded += conceded;
    if (scored > conceded) wins++;
  }

  return {
    matchesPlayed: venueMatches.length,
    winRate: round2(wins / venueMatches.length),
    avgGoalsScored: round2(goalsScored / venueMatches.length),
    avgGoalsConceded: round2(goalsConceded / venueMatches.length),
  };
}

// ─── Schedule Fatigue ───────────────────────────────────────────────────────────

function computeFatigue(teamId: string, matches: HistoricalMatch[], referenceDate: Date): ScheduleFatigue {
  const allTeamMatches = matches
    .filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId)
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());

  // Days since last match
  const lastMatch = allTeamMatches.find((m) => m.kickoffAt < referenceDate);
  const daysSinceLastMatch = lastMatch
    ? Math.floor((referenceDate.getTime() - lastMatch.kickoffAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Matches in last 14 days
  const fourteenDaysAgo = new Date(referenceDate.getTime() - 14 * 24 * 60 * 60 * 1000);
  const matchesInLast14Days = allTeamMatches.filter(
    (m) => m.kickoffAt >= fourteenDaysAgo && m.kickoffAt < referenceDate,
  ).length;

  return {
    daysSinceLastMatch,
    matchesInLast14Days,
    isCongested: matchesInLast14Days >= 4,
  };
}

// ─── Head-to-Head ───────────────────────────────────────────────────────────────

function computeHeadToHead(
  homeTeamId: string,
  awayTeamId: string,
  h2hMatches: HistoricalMatch[],
): HeadToHeadStats {
  const finished = h2hMatches
    .filter((m) => m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null)
    .sort((a, b) => b.kickoffAt.getTime() - a.kickoffAt.getTime());

  if (finished.length === 0) {
    return {
      totalMatches: 0,
      homeWins: 0,
      draws: 0,
      awayWins: 0,
      avgTotalGoals: 0,
      lastMeeting: null,
    };
  }

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let totalGoals = 0;

  for (const match of finished) {
    const totalMatchGoals = match.homeScore! + match.awayScore!;
    totalGoals += totalMatchGoals;

    // Determine winner relative to the current match's home/away assignment
    const isCurrentHomeTeamHome = match.homeTeamId === homeTeamId;
    const homeGoals = isCurrentHomeTeamHome ? match.homeScore! : match.awayScore!;
    const awayGoals = isCurrentHomeTeamHome ? match.awayScore! : match.homeScore!;

    if (homeGoals > awayGoals) homeWins++;
    else if (homeGoals === awayGoals) draws++;
    else awayWins++;
  }

  const lastMatch = finished[0];
  const lastMeeting = lastMatch
    ? `${lastMatch.kickoffAt.toISOString().slice(0, 10)}: ${lastMatch.homeScore}-${lastMatch.awayScore}`
    : null;

  return {
    totalMatches: finished.length,
    homeWins,
    draws,
    awayWins,
    avgTotalGoals: round2(totalGoals / finished.length),
    lastMeeting,
  };
}

// ─── Data Quality Assessment ────────────────────────────────────────────────────

function assessDataQuality(
  homeMatches: HistoricalMatch[],
  awayMatches: HistoricalMatch[],
  h2hMatches: HistoricalMatch[],
): MatchFeatureSet['dataQuality'] {
  const homeFinished = homeMatches.filter((m) => m.status === 'FINISHED').length;
  const awayFinished = awayMatches.filter((m) => m.status === 'FINISHED').length;
  const missingSignals: string[] = [];

  if (homeFinished < 3) missingSignals.push('主队历史数据不足（<3场）');
  if (awayFinished < 3) missingSignals.push('客队历史数据不足（<3场）');
  if (h2hMatches.filter((m) => m.status === 'FINISHED').length === 0) {
    missingSignals.push('无历史交锋记录');
  }
  // Odds are not available in current data
  missingSignals.push('赔率数据暂不可用');

  const minMatches = Math.min(homeFinished, awayFinished);
  let level: 'HIGH' | 'MEDIUM' | 'LOW';
  if (minMatches >= 8) level = 'HIGH';
  else if (minMatches >= 4) level = 'MEDIUM';
  else level = 'LOW';

  return {
    level,
    missingSignals,
    homeTeamHistoryCount: homeFinished,
    awayTeamHistoryCount: awayFinished,
  };
}

// ─── Summary Text Generation ────────────────────────────────────────────────────

/**
 * Generate a concise text summary of features for direct inclusion in AI prompts.
 */
export function generateSummaryText(features: MatchFeatureSet): string {
  const { homeTeam, awayTeam, headToHead, competition, match } = features;
  const lines: string[] = [];

  lines.push(`## 比赛背景`);
  lines.push(`${competition.competitionName} ${competition.season} | ${competition.stage || '常规轮次'} | ${match.kickoffAt}`);
  lines.push(`${match.homeTeamName} (主) vs ${match.awayTeamName} (客)`);
  lines.push('');

  // Home team
  lines.push(`## ${match.homeTeamName}（主队）近期状态`);
  if (homeTeam.recentForm.matchesAnalyzed > 0) {
    lines.push(`- 近${homeTeam.recentForm.matchesAnalyzed}场: ${homeTeam.recentForm.wins}胜${homeTeam.recentForm.draws}平${homeTeam.recentForm.losses}负 | 走势: ${homeTeam.recentForm.formString}`);
    lines.push(`- 场均进球: ${homeTeam.recentForm.avgGoalsScored} | 场均失球: ${homeTeam.recentForm.avgGoalsConceded}`);
    lines.push(`- 胜率: ${(homeTeam.recentForm.winRate * 100).toFixed(0)}% | 场均积分: ${homeTeam.recentForm.pointsPerMatch}`);
  } else {
    lines.push(`- 无可用历史数据`);
  }
  if (homeTeam.last5Form.matchesAnalyzed > 0) {
    lines.push(`- 近5场走势: ${homeTeam.last5Form.formString} (胜率${(homeTeam.last5Form.winRate * 100).toFixed(0)}%)`);
  }
  if (homeTeam.homeVenue.matchesPlayed > 0) {
    lines.push(`- 主场表现(${homeTeam.homeVenue.matchesPlayed}场): 胜率${(homeTeam.homeVenue.winRate * 100).toFixed(0)}% | 场均进球${homeTeam.homeVenue.avgGoalsScored}`);
  }
  if (homeTeam.fatigue.daysSinceLastMatch !== null) {
    lines.push(`- 休息天数: ${homeTeam.fatigue.daysSinceLastMatch}天 | 近14天比赛: ${homeTeam.fatigue.matchesInLast14Days}场${homeTeam.fatigue.isCongested ? ' ⚠️密集赛程' : ''}`);
  }
  lines.push('');

  // Away team
  lines.push(`## ${match.awayTeamName}（客队）近期状态`);
  if (awayTeam.recentForm.matchesAnalyzed > 0) {
    lines.push(`- 近${awayTeam.recentForm.matchesAnalyzed}场: ${awayTeam.recentForm.wins}胜${awayTeam.recentForm.draws}平${awayTeam.recentForm.losses}负 | 走势: ${awayTeam.recentForm.formString}`);
    lines.push(`- 场均进球: ${awayTeam.recentForm.avgGoalsScored} | 场均失球: ${awayTeam.recentForm.avgGoalsConceded}`);
    lines.push(`- 胜率: ${(awayTeam.recentForm.winRate * 100).toFixed(0)}% | 场均积分: ${awayTeam.recentForm.pointsPerMatch}`);
  } else {
    lines.push(`- 无可用历史数据`);
  }
  if (awayTeam.last5Form.matchesAnalyzed > 0) {
    lines.push(`- 近5场走势: ${awayTeam.last5Form.formString} (胜率${(awayTeam.last5Form.winRate * 100).toFixed(0)}%)`);
  }
  if (awayTeam.awayVenue.matchesPlayed > 0) {
    lines.push(`- 客场表现(${awayTeam.awayVenue.matchesPlayed}场): 胜率${(awayTeam.awayVenue.winRate * 100).toFixed(0)}% | 场均进球${awayTeam.awayVenue.avgGoalsScored}`);
  }
  if (awayTeam.fatigue.daysSinceLastMatch !== null) {
    lines.push(`- 休息天数: ${awayTeam.fatigue.daysSinceLastMatch}天 | 近14天比赛: ${awayTeam.fatigue.matchesInLast14Days}场${awayTeam.fatigue.isCongested ? ' ⚠️密集赛程' : ''}`);
  }
  lines.push('');

  // Head-to-head
  lines.push(`## 历史交锋`);
  if (headToHead.totalMatches > 0) {
    lines.push(`- ${headToHead.totalMatches}场交锋: ${match.homeTeamName}${headToHead.homeWins}胜 平${headToHead.draws}场 ${match.awayTeamName}${headToHead.awayWins}胜`);
    lines.push(`- 场均总进球: ${headToHead.avgTotalGoals}`);
    if (headToHead.lastMeeting) {
      lines.push(`- 最近一次: ${headToHead.lastMeeting}`);
    }
  } else {
    lines.push(`- 无历史交锋记录`);
  }
  lines.push('');

  // Data quality note
  lines.push(`## 数据质量: ${features.dataQuality.level}`);
  if (features.dataQuality.missingSignals.length > 0) {
    lines.push(`- 缺失信号: ${features.dataQuality.missingSignals.join('、')}`);
  }

  return lines.join('\n');
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function createEmptyFormStats(): TeamFormStats {
  return {
    matchesAnalyzed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsScored: 0,
    goalsConceded: 0,
    avgGoalsScored: 0,
    avgGoalsConceded: 0,
    winRate: 0,
    pointsPerMatch: 0,
    formString: '',
    cleanSheets: 0,
    failedToScore: 0,
  };
}

import {
  computeMatchFeatures,
  FEATURE_VERSION,
  type HistoricalMatch,
  type MatchContext,
} from '@ai-worldcup/shared';
import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * Feature Compute Worker Job
 *
 * Two modes:
 * 1. BATCH: Pre-compute features for all upcoming matches within a time window.
 *    Triggered by cron (e.g. daily at 03:00).
 * 2. SINGLE: Compute feature for a specific match (on-demand).
 *
 * Idempotent: re-computing overwrites the existing MatchFeature record.
 */

export const FeatureComputePayloadSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('BATCH'),
    /** How many days ahead to look for upcoming matches */
    daysAhead: z.number().int().min(1).max(30).default(7),
  }),
  z.object({
    mode: z.literal('SINGLE'),
    matchId: z.string().min(1),
  }),
]);

export type FeatureComputePayload = z.infer<typeof FeatureComputePayloadSchema>;

const prisma = new PrismaClient();

/** Maximum number of historical matches to fetch per team */
const HISTORY_LIMIT = 30;

export async function processFeatureCompute(job: Job<unknown>): Promise<{ ok: true; computed: number }> {
  const payload = FeatureComputePayloadSchema.parse(job.data);
  logger.info({ jobId: job.id, payload }, 'feature-compute: starting');

  if (payload.mode === 'BATCH') {
    return batchCompute(payload.daysAhead);
  }
  await computeForMatch(payload.matchId);
  return { ok: true, computed: 1 };
}

async function batchCompute(daysAhead: number): Promise<{ ok: true; computed: number }> {
  const now = new Date();
  const futureLimit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  // Find upcoming scheduled matches that don't yet have a feature computed with current version
  const upcomingMatches = await prisma.match.findMany({
    where: {
      status: 'SCHEDULED',
      kickoffAt: { gte: now, lte: futureLimit },
    },
    include: {
      competition: true,
      homeTeam: true,
      awayTeam: true,
    },
    orderBy: { kickoffAt: 'asc' },
    take: 500,
  });

  let computed = 0;
  for (const match of upcomingMatches) {
    // Skip if already computed with current version
    const existing = await prisma.matchFeature.findFirst({
      where: { matchId: match.id, featureVersion: FEATURE_VERSION },
    });
    if (existing) continue;

    try {
      await computeForMatch(match.id);
      computed++;
    } catch (err) {
      logger.warn({ matchId: match.id, error: (err as Error).message }, 'feature-compute: failed for match');
    }
  }

  logger.info({ computed, total: upcomingMatches.length }, 'feature-compute: batch completed');
  return { ok: true, computed };
}

async function computeForMatch(matchId: string): Promise<void> {
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      competition: true,
      homeTeam: true,
      awayTeam: true,
    },
  });

  // Fetch historical matches for home team (before this match's kickoff)
  const homeTeamMatches = await fetchTeamHistory(match.homeTeamId, match.kickoffAt);
  const awayTeamMatches = await fetchTeamHistory(match.awayTeamId, match.kickoffAt);

  // Fetch head-to-head matches
  const h2hMatches = await fetchH2HHistory(match.homeTeamId, match.awayTeamId, match.kickoffAt);

  const context: MatchContext = {
    matchId: match.id,
    homeTeamId: match.homeTeamId,
    homeTeamName: match.homeTeam.name,
    homeTeamCode: match.homeTeam.code,
    awayTeamId: match.awayTeamId,
    awayTeamName: match.awayTeam.name,
    awayTeamCode: match.awayTeam.code,
    competitionId: match.competitionId,
    competitionName: match.competition.name,
    competitionSeason: match.competition.season,
    competitionPriority: mapPriority((match.competition as { priority?: string }).priority),
    kickoffAt: match.kickoffAt,
    stage: match.stage,
    matchday: match.matchday,
  };

  const result = computeMatchFeatures(context, homeTeamMatches, awayTeamMatches, h2hMatches);

  // Upsert MatchFeature
  await prisma.matchFeature.upsert({
    where: {
      matchId_featureVersion: { matchId, featureVersion: FEATURE_VERSION },
    },
    create: {
      matchId,
      featureVersion: FEATURE_VERSION,
      featuresJson: JSON.parse(JSON.stringify(result.features)),
      summaryText: result.summaryText,
      dataQuality: result.dataQuality,
      missingSignals: result.missingSignals,
      computedAt: new Date(),
    },
    update: {
      featuresJson: JSON.parse(JSON.stringify(result.features)),
      summaryText: result.summaryText,
      dataQuality: result.dataQuality,
      missingSignals: result.missingSignals,
      computedAt: new Date(),
    },
  });

  logger.info(
    { matchId, dataQuality: result.dataQuality, homeHistory: homeTeamMatches.length, awayHistory: awayTeamMatches.length },
    'feature-compute: match feature saved',
  );
}

async function fetchTeamHistory(teamId: string, beforeDate: Date): Promise<HistoricalMatch[]> {
  const matches = await prisma.match.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: 'FINISHED',
      kickoffAt: { lt: beforeDate },
    },
    orderBy: { kickoffAt: 'desc' },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      kickoffAt: true,
      status: true,
      competitionId: true,
    },
  });
  return matches;
}

async function fetchH2HHistory(homeTeamId: string, awayTeamId: string, beforeDate: Date): Promise<HistoricalMatch[]> {
  const matches = await prisma.match.findMany({
    where: {
      OR: [
        { homeTeamId, awayTeamId },
        { homeTeamId: awayTeamId, awayTeamId: homeTeamId },
      ],
      status: 'FINISHED',
      kickoffAt: { lt: beforeDate },
    },
    orderBy: { kickoffAt: 'desc' },
    take: 10,
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      homeScore: true,
      awayScore: true,
      kickoffAt: true,
      status: true,
      competitionId: true,
    },
  });
  return matches;
}

function mapPriority(priority?: string | null): 'P0' | 'P1' | 'P2' | 'P3' {
  if (!priority) return 'P2';
  if (priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3') return priority;
  return 'P2';
}

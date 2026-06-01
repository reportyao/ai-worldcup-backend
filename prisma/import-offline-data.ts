/**
 * Offline Data Import Script
 * ---------------------------
 * Imports the pre-fetched league/team/match data from `data/recommended-leagues/`
 * into the database in a single run.
 *
 * Usage: npx tsx prisma/import-offline-data.ts
 *
 * Idempotent: uses upsert with externalId as the unique key.
 */

import { CompetitionType, PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ─── Types ──────────────────────────────────────────────────────────────────────

interface LeagueIndex {
  league_id: number;
  league_name: string;
  league_season?: string;
  country_name?: string;
  priority: number;
  tier?: string;
}

interface RawTeam {
  source_label?: string;
  tier?: string;
  priority?: number;
  league_id: string;
  league_name?: string;
  league_season?: string;
  country_name?: string;
  team_key: string;
  team_name: string;
  team_country?: string;
  team_badge?: string;
}

interface RawEvent {
  source_label?: string;
  tier?: string;
  priority?: number;
  league_id: string;
  league_name?: string;
  league_season?: string;
  country_name?: string;
  match_id: string;
  match_date?: string;
  match_time?: string;
  match_status?: string;
  match_round?: string;
  match_hometeam_id?: string;
  match_hometeam_name?: string;
  match_hometeam_score?: string;
  match_awayteam_id?: string;
  match_awayteam_name?: string;
  match_awayteam_score?: string;
  match_stadium?: string;
  match_referee?: string;
  match_live?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '../data/recommended-leagues');

function loadJson<T>(filename: string): T {
  const filepath = path.join(DATA_DIR, filename);
  const raw = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Map numeric priority from index file to CompetitionPriority enum.
 * 1-9 -> P0 (World Cup & qualifiers)
 * 10-19 -> P1 (European cups)
 * 20-31 -> P1 (Top 5 leagues)
 * 32-39 -> P2 (Americas leagues)
 * 40+ -> P3 (Asian leagues)
 */
function mapPriority(numPriority: number): 'P0' | 'P1' | 'P2' | 'P3' {
  if (numPriority <= 9) return 'P0';
  if (numPriority <= 31) return 'P1';
  if (numPriority <= 39) return 'P2';
  return 'P3';
}

/**
 * Map tier string to CompetitionType enum.
 */
function mapCompetitionType(tier?: string, leagueName?: string): CompetitionType {
  if (tier === 'international') return CompetitionType.WORLD_CUP;
  if (tier === 'continental' || leagueName?.includes('Champions League') || leagueName?.includes('Europa')) {
    return CompetitionType.CONTINENTAL_CUP;
  }
  return CompetitionType.CITY_LEAGUE;
}

/**
 * Build a stable competition code from league data.
 */
function buildCompetitionCode(leagueId: string | number, season?: string): string {
  return `AFL-${leagueId}-${season || 'current'}`;
}

/**
 * Build a stable team code from team data.
 */
function buildTeamCode(teamKey: string, teamName: string): string {
  // Use first 3 chars of cleaned name + key suffix for uniqueness
  const clean = teamName.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3);
  return `${clean}-${teamKey}`;
}

/**
 * Parse match status from API-Football status string.
 */
function mapMatchStatus(status?: string): 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELED' {
  if (!status) return 'SCHEDULED';
  const s = status.toLowerCase().trim();
  if (s === 'finished' || s === 'after pens' || s === 'after et') return 'FINISHED';
  if (s.includes('half') || s === 'live' || /^\d+$/.test(s)) return 'LIVE';
  if (s === 'postponed') return 'POSTPONED';
  if (s === 'cancelled' || s === 'canceled' || s === 'suspended') return 'CANCELED';
  return 'SCHEDULED';
}

/**
 * Parse kickoff datetime from match_date + match_time.
 */
function parseKickoff(matchDate?: string, matchTime?: string): Date | null {
  if (!matchDate) return null;
  const time = matchTime || '00:00';
  const dt = new Date(`${matchDate}T${time}:00Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

function toNullableInt(val?: string): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

// ─── Main Import Logic ──────────────────────────────────────────────────────────

async function importCompetitions(leagueIndex: LeagueIndex[]): Promise<Map<string, string>> {
  const competitionMap = new Map<string, string>(); // leagueId -> dbId
  let created = 0;
  let updated = 0;

  for (const league of leagueIndex) {
    const externalId = `api-football:league:${league.league_id}`;
    const code = buildCompetitionCode(league.league_id, league.league_season);
    const data = {
      code,
      name: league.league_name,
      type: mapCompetitionType(league.tier, league.league_name),
      priority: mapPriority(league.priority),
      season: league.league_season || '2024-25',
      country: league.country_name || null,
      status: 'ACTIVE',
      externalId,
    };

    const existing = await prisma.competition.findUnique({ where: { externalId } });
    const competition = await prisma.competition.upsert({
      where: { externalId },
      update: data,
      create: data,
    });

    competitionMap.set(String(league.league_id), competition.id);
    if (existing) updated++;
    else created++;
  }

  console.log(`  ✓ Competitions: ${created} created, ${updated} updated`);
  return competitionMap;
}

async function importTeams(teams: RawTeam[]): Promise<Map<string, string>> {
  const teamMap = new Map<string, string>(); // teamKey -> dbId
  let created = 0;
  let updated = 0;

  for (const team of teams) {
    if (!team.team_key || !team.team_name) continue;

    const externalId = `api-football:team:${team.team_key}`;
    const code = buildTeamCode(team.team_key, team.team_name);
    const data = {
      code,
      name: team.team_name,
      shortName: team.team_name,
      crestUrl: team.team_badge || null,
      countryCode: null as string | null,
      externalId,
    };

    const existing = await prisma.team.findUnique({ where: { externalId } });
    const saved = await prisma.team.upsert({
      where: { externalId },
      update: data,
      create: data,
    });

    teamMap.set(team.team_key, saved.id);
    if (existing) updated++;
    else created++;
  }

  console.log(`  ✓ Teams: ${created} created, ${updated} updated (total: ${teamMap.size})`);
  return teamMap;
}

async function importMatches(
  events: RawEvent[],
  competitionMap: Map<string, string>,
  teamMap: Map<string, string>,
): Promise<void> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const event of events) {
    if (!event.match_id || !event.match_hometeam_id || !event.match_awayteam_id) {
      skipped++;
      continue;
    }

    const competitionId = competitionMap.get(event.league_id);
    if (!competitionId) {
      skipped++;
      continue;
    }

    // Ensure teams exist (lazy create if not in teamMap)
    let homeTeamId = teamMap.get(event.match_hometeam_id);
    let awayTeamId = teamMap.get(event.match_awayteam_id);

    if (!homeTeamId && event.match_hometeam_name) {
      const externalId = `api-football:team:${event.match_hometeam_id}`;
      const code = buildTeamCode(event.match_hometeam_id, event.match_hometeam_name);
      const saved = await prisma.team.upsert({
        where: { externalId },
        update: { name: event.match_hometeam_name, shortName: event.match_hometeam_name },
        create: { code, name: event.match_hometeam_name, shortName: event.match_hometeam_name, externalId },
      });
      homeTeamId = saved.id;
      teamMap.set(event.match_hometeam_id, saved.id);
    }

    if (!awayTeamId && event.match_awayteam_name) {
      const externalId = `api-football:team:${event.match_awayteam_id}`;
      const code = buildTeamCode(event.match_awayteam_id, event.match_awayteam_name);
      const saved = await prisma.team.upsert({
        where: { externalId },
        update: { name: event.match_awayteam_name, shortName: event.match_awayteam_name },
        create: { code, name: event.match_awayteam_name, shortName: event.match_awayteam_name, externalId },
      });
      awayTeamId = saved.id;
      teamMap.set(event.match_awayteam_id, saved.id);
    }

    if (!homeTeamId || !awayTeamId) {
      skipped++;
      continue;
    }

    const kickoffAt = parseKickoff(event.match_date, event.match_time);
    if (!kickoffAt) {
      skipped++;
      continue;
    }

    const externalId = `api-football:match:${event.match_id}`;
    const status = mapMatchStatus(event.match_status);
    const matchday = event.match_date || kickoffAt.toISOString().slice(0, 10);
    const stage = event.match_round?.trim() || null;
    const homeScore = toNullableInt(event.match_hometeam_score);
    const awayScore = toNullableInt(event.match_awayteam_score);

    const existing = await prisma.match.findUnique({ where: { externalId } });
    try {
      await prisma.match.upsert({
        where: { externalId },
        update: {
          kickoffAt,
          status,
          matchday,
          stage,
          homeScore,
          awayScore,
          competition: { connect: { id: competitionId } },
          homeTeam: { connect: { id: homeTeamId } },
          awayTeam: { connect: { id: awayTeamId } },
        },
        create: {
          kickoffAt,
          status,
          matchday,
          stage,
          homeScore,
          awayScore,
          externalId,
          competition: { connect: { id: competitionId } },
          homeTeam: { connect: { id: homeTeamId } },
          awayTeam: { connect: { id: awayTeamId } },
        },
      });
      if (existing) updated++;
      else created++;
    } catch (err: unknown) {
      // Handle duplicate composite key (same teams + kickoff already exists with different externalId)
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
        // Try to update by composite key instead
        await prisma.match.updateMany({
          where: { competitionId, homeTeamId, awayTeamId, kickoffAt },
          data: { status, matchday, stage, homeScore, awayScore, externalId },
        });
        updated++;
      } else {
        throw err;
      }
    }
  }

  console.log(`  ✓ Matches: ${created} created, ${updated} updated, ${skipped} skipped`);
}

// ─── Entry Point ────────────────────────────────────────────────────────────────

async function main() {
  console.log('📦 Importing offline data from data/recommended-leagues/...\n');

  // 1. Load data files
  const leagueIndex = loadJson<LeagueIndex[]>('recommended_leagues_index.json');
  const teams = loadJson<RawTeam[]>('all_teams.json');
  const events = loadJson<RawEvent[]>('all_events.json');

  console.log(`  Loaded: ${leagueIndex.length} leagues, ${teams.length} teams, ${events.length} events\n`);

  // 2. Import competitions
  const competitionMap = await importCompetitions(leagueIndex);

  // 3. Import teams
  const teamMap = await importTeams(teams);

  // 4. Import matches
  await importMatches(events, competitionMap, teamMap);

  console.log('\n✅ Offline data import complete!');
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

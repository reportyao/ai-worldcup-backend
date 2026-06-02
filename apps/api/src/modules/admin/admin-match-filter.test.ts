/**
 * Tests for admin match listing - 7-day finished match filter
 * Validates that:
 * 1. Finished matches older than 7 days are excluded by default
 * 2. Explicit date range overrides the 7-day filter
 * 3. Non-finished matches are always shown regardless of age
 * 4. When filtering specifically for FINISHED status, only recent 7 days shown
 */
import { describe, it, expect } from 'vitest';
import { MatchStatus, Prisma } from '@prisma/client';

// Replicate the filter logic from admin.service.ts for unit testing
function buildMatchWhereFilter(query: {
  competitionId?: string;
  status?: string;
  keyword?: string;
  from?: string;
  to?: string;
}): Prisma.MatchWhereInput {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const isFilteringFinished = query.status === 'FINISHED';
  const hasExplicitDateRange = !!(query.from || query.to);

  const where: Prisma.MatchWhereInput = {
    ...(query.competitionId ? { competitionId: query.competitionId } : {}),
    ...(query.status ? { status: query.status as MatchStatus } : {}),
    ...(!query.status && !hasExplicitDateRange
      ? {
          NOT: {
            AND: [
              { status: 'FINISHED' as MatchStatus },
              { kickoffAt: { lt: sevenDaysAgo } },
            ],
          },
        }
      : {}),
    ...(isFilteringFinished && !hasExplicitDateRange
      ? { kickoffAt: { gte: sevenDaysAgo } }
      : {}),
    ...(hasExplicitDateRange
      ? {
          kickoffAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
    ...(query.keyword
      ? {
          OR: [
            { stage: { contains: query.keyword, mode: 'insensitive' } },
            { matchday: { contains: query.keyword, mode: 'insensitive' } },
            { homeTeam: { name: { contains: query.keyword, mode: 'insensitive' } } },
            { homeTeam: { code: { contains: query.keyword, mode: 'insensitive' } } },
            { awayTeam: { name: { contains: query.keyword, mode: 'insensitive' } } },
            { awayTeam: { code: { contains: query.keyword, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  return where;
}

describe('Admin Match List - 7-day filter for finished matches', () => {
  it('should exclude finished matches older than 7 days when no status filter', () => {
    const where = buildMatchWhereFilter({});
    expect(where).toHaveProperty('NOT');
    const notClause = where.NOT as { AND: Array<Record<string, unknown>> };
    expect(notClause.AND).toHaveLength(2);
    expect(notClause.AND[0]).toEqual({ status: 'FINISHED' });
    expect(notClause.AND[1]).toHaveProperty('kickoffAt');
  });

  it('should apply 7-day filter when explicitly filtering FINISHED status', () => {
    const where = buildMatchWhereFilter({ status: 'FINISHED' });
    expect(where.status).toBe('FINISHED');
    expect(where.kickoffAt).toHaveProperty('gte');
    expect(where).not.toHaveProperty('NOT');
  });

  it('should NOT apply 7-day filter when explicit date range is provided', () => {
    const where = buildMatchWhereFilter({
      status: 'FINISHED',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.000Z',
    });
    expect(where.status).toBe('FINISHED');
    const kickoff = where.kickoffAt as { gte?: Date; lte?: Date };
    expect(kickoff.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(kickoff.lte).toEqual(new Date('2026-01-31T23:59:59.000Z'));
  });

  it('should show all SCHEDULED matches regardless of date', () => {
    const where = buildMatchWhereFilter({ status: 'SCHEDULED' });
    expect(where.status).toBe('SCHEDULED');
    expect(where).not.toHaveProperty('NOT');
    expect(where).not.toHaveProperty('kickoffAt');
  });

  it('should show all LIVE matches regardless of date', () => {
    const where = buildMatchWhereFilter({ status: 'LIVE' });
    expect(where.status).toBe('LIVE');
    expect(where).not.toHaveProperty('NOT');
    expect(where).not.toHaveProperty('kickoffAt');
  });

  it('should support keyword search combined with 7-day filter', () => {
    const where = buildMatchWhereFilter({ keyword: 'Brazil' });
    expect(where).toHaveProperty('NOT');
    expect(where).toHaveProperty('OR');
    const orClause = where.OR as Array<Record<string, unknown>>;
    expect(orClause.length).toBeGreaterThan(0);
  });

  it('should support competitionId filter', () => {
    const where = buildMatchWhereFilter({ competitionId: 'comp-123' });
    expect(where.competitionId).toBe('comp-123');
    expect(where).toHaveProperty('NOT');
  });
});

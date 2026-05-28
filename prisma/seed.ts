/**
 * Prisma Seed Script - Phase 1
 * Seeds the database with:
 * - WC-2026 competition
 * - Sample teams (32 World Cup participants)
 * - Sample matches
 * - AI models registry
 *
 * Run: npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ─── Competition ───────────────────────────────────────────────────────────
  const wc2026 = await prisma.competition.upsert({
    where: { code: 'WC-2026' },
    update: {},
    create: {
      code: 'WC-2026',
      name: '2026 FIFA World Cup',
      type: 'WORLD_CUP',
      season: '2026',
      startDate: new Date('2026-06-11T00:00:00Z'),
      endDate: new Date('2026-07-19T00:00:00Z'),
    },
  });
  console.log(`  ✓ Competition: ${wc2026.name} (${wc2026.code})`);

  // ─── Teams ─────────────────────────────────────────────────────────────────
  const teamData = [
    { code: 'BRA', name: 'Brazil', shortName: '巴西', countryCode: 'BR' },
    { code: 'GER', name: 'Germany', shortName: '德国', countryCode: 'DE' },
    { code: 'ARG', name: 'Argentina', shortName: '阿根廷', countryCode: 'AR' },
    { code: 'FRA', name: 'France', shortName: '法国', countryCode: 'FR' },
    { code: 'ENG', name: 'England', shortName: '英格兰', countryCode: 'GB' },
    { code: 'ESP', name: 'Spain', shortName: '西班牙', countryCode: 'ES' },
    { code: 'POR', name: 'Portugal', shortName: '葡萄牙', countryCode: 'PT' },
    { code: 'NED', name: 'Netherlands', shortName: '荷兰', countryCode: 'NL' },
    { code: 'ITA', name: 'Italy', shortName: '意大利', countryCode: 'IT' },
    { code: 'JPN', name: 'Japan', shortName: '日本', countryCode: 'JP' },
    { code: 'KOR', name: 'South Korea', shortName: '韩国', countryCode: 'KR' },
    { code: 'USA', name: 'United States', shortName: '美国', countryCode: 'US' },
    { code: 'MEX', name: 'Mexico', shortName: '墨西哥', countryCode: 'MX' },
    { code: 'CAN', name: 'Canada', shortName: '加拿大', countryCode: 'CA' },
    { code: 'URU', name: 'Uruguay', shortName: '乌拉圭', countryCode: 'UY' },
    { code: 'COL', name: 'Colombia', shortName: '哥伦比亚', countryCode: 'CO' },
    { code: 'BEL', name: 'Belgium', shortName: '比利时', countryCode: 'BE' },
    { code: 'CRO', name: 'Croatia', shortName: '克罗地亚', countryCode: 'HR' },
    { code: 'SEN', name: 'Senegal', shortName: '塞内加尔', countryCode: 'SN' },
    { code: 'AUS', name: 'Australia', shortName: '澳大利亚', countryCode: 'AU' },
    { code: 'MAR', name: 'Morocco', shortName: '摩洛哥', countryCode: 'MA' },
    { code: 'SUI', name: 'Switzerland', shortName: '瑞士', countryCode: 'CH' },
    { code: 'DEN', name: 'Denmark', shortName: '丹麦', countryCode: 'DK' },
    { code: 'POL', name: 'Poland', shortName: '波兰', countryCode: 'PL' },
    { code: 'ECU', name: 'Ecuador', shortName: '厄瓜多尔', countryCode: 'EC' },
    { code: 'NGA', name: 'Nigeria', shortName: '尼日利亚', countryCode: 'NG' },
    { code: 'SAU', name: 'Saudi Arabia', shortName: '沙特', countryCode: 'SA' },
    { code: 'QAT', name: 'Qatar', shortName: '卡塔尔', countryCode: 'QA' },
    { code: 'IRN', name: 'Iran', shortName: '伊朗', countryCode: 'IR' },
    { code: 'SRB', name: 'Serbia', shortName: '塞尔维亚', countryCode: 'RS' },
    { code: 'GHA', name: 'Ghana', shortName: '加纳', countryCode: 'GH' },
    { code: 'CMR', name: 'Cameroon', shortName: '喀麦隆', countryCode: 'CM' },
  ];

  const teams: Record<string, string> = {};
  for (const t of teamData) {
    const team = await prisma.team.upsert({
      where: { code: t.code },
      update: {},
      create: t,
    });
    teams[t.code] = team.id;
  }
  console.log(`  ✓ Teams: ${Object.keys(teams).length} seeded`);

  // ─── Sample Matches ────────────────────────────────────────────────────────
  const matchData = [
    {
      homeTeamCode: 'USA',
      awayTeamCode: 'MEX',
      kickoffAt: new Date('2026-06-11T18:00:00Z'),
      matchday: '2026-06-11',
      stage: 'Group A',
    },
    {
      homeTeamCode: 'BRA',
      awayTeamCode: 'GER',
      kickoffAt: new Date('2026-06-12T15:00:00Z'),
      matchday: '2026-06-12',
      stage: 'Group B',
    },
    {
      homeTeamCode: 'ARG',
      awayTeamCode: 'ENG',
      kickoffAt: new Date('2026-06-12T18:00:00Z'),
      matchday: '2026-06-12',
      stage: 'Group C',
    },
    {
      homeTeamCode: 'JPN',
      awayTeamCode: 'ESP',
      kickoffAt: new Date('2026-06-13T12:00:00Z'),
      matchday: '2026-06-13',
      stage: 'Group D',
    },
    {
      homeTeamCode: 'FRA',
      awayTeamCode: 'POR',
      kickoffAt: new Date('2026-06-13T18:00:00Z'),
      matchday: '2026-06-13',
      stage: 'Group E',
    },
    {
      homeTeamCode: 'NED',
      awayTeamCode: 'ITA',
      kickoffAt: new Date('2026-06-14T15:00:00Z'),
      matchday: '2026-06-14',
      stage: 'Group F',
    },
  ];

  let matchCount = 0;
  for (const m of matchData) {
    const homeTeamId = teams[m.homeTeamCode];
    const awayTeamId = teams[m.awayTeamCode];
    if (!homeTeamId || !awayTeamId) continue;

    await prisma.match.upsert({
      where: {
        competitionId_homeTeamId_awayTeamId_kickoffAt: {
          competitionId: wc2026.id,
          homeTeamId,
          awayTeamId,
          kickoffAt: m.kickoffAt,
        },
      },
      update: {},
      create: {
        competitionId: wc2026.id,
        homeTeamId,
        awayTeamId,
        kickoffAt: m.kickoffAt,
        matchday: m.matchday,
        stage: m.stage,
        status: 'SCHEDULED',
      },
    });
    matchCount++;
  }
  console.log(`  ✓ Matches: ${matchCount} seeded`);

  // ─── AI Models ─────────────────────────────────────────────────────────────
  const modelData = [
    {
      modelId: 'gpt-4.1-mini',
      displayName: 'GPT-4.1 Mini',
      persona: 'STEADY' as const,
      provider: 'openai',
      description: '稳健型分析师，注重数据和历史规律',
      config: { temperature: 0.3, maxTokens: 4096 },
    },
    {
      modelId: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      persona: 'ATTACKING' as const,
      provider: 'google',
      description: '进攻型分析师，善于发现进球机会',
      config: { temperature: 0.5, maxTokens: 4096 },
    },
    {
      modelId: 'gpt-4.1-nano',
      displayName: 'GPT-4.1 Nano',
      persona: 'UPSET_HUNTER' as const,
      provider: 'openai',
      description: '冷门猎手，专注发现潜在爆冷',
      config: { temperature: 0.7, maxTokens: 4096 },
    },
    {
      modelId: 'claude-sonnet',
      displayName: 'Claude Sonnet',
      persona: 'DATA_DRIVEN' as const,
      provider: 'anthropic',
      description: '数据驱动型，严格基于统计和概率',
      config: { temperature: 0.2, maxTokens: 4096 },
    },
  ];

  for (const m of modelData) {
    await prisma.aiModel.upsert({
      where: { modelId: m.modelId },
      update: {},
      create: m,
    });
  }
  console.log(`  ✓ AI Models: ${modelData.length} seeded`);

  // ─── Sample PredictionTasks ────────────────────────────────────────────────
  // Create T-24h prediction tasks for the first 3 matches
  const matches = await prisma.match.findMany({
    take: 3,
    orderBy: { kickoffAt: 'asc' },
  });

  for (const match of matches) {
    await prisma.predictionTask.upsert({
      where: {
        matchId_version: {
          matchId: match.id,
          version: 'T_MINUS_24H',
        },
      },
      update: {},
      create: {
        matchId: match.id,
        version: 'T_MINUS_24H',
        status: 'PENDING',
        trigger: 'CRON',
        modelCount: 4,
      },
    });
  }
  console.log(`  ✓ PredictionTasks: ${matches.length} T-24h tasks created`);

  console.log('\n✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

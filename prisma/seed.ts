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
    { code: 'BRA', name: 'Brazil', nameZh: '巴西', shortName: '巴西', countryCode: 'BR', flagUrl: 'https://flagcdn.com/w80/br.png' },
    { code: 'GER', name: 'Germany', nameZh: '德国', shortName: '德国', countryCode: 'DE', flagUrl: 'https://flagcdn.com/w80/de.png' },
    { code: 'ARG', name: 'Argentina', nameZh: '阿根廷', shortName: '阿根廷', countryCode: 'AR', flagUrl: 'https://flagcdn.com/w80/ar.png' },
    { code: 'FRA', name: 'France', nameZh: '法国', shortName: '法国', countryCode: 'FR', flagUrl: 'https://flagcdn.com/w80/fr.png' },
    { code: 'ENG', name: 'England', nameZh: '英格兰', shortName: '英格兰', countryCode: 'GB', flagUrl: 'https://flagcdn.com/w80/gb-eng.png' },
    { code: 'ESP', name: 'Spain', nameZh: '西班牙', shortName: '西班牙', countryCode: 'ES', flagUrl: 'https://flagcdn.com/w80/es.png' },
    { code: 'POR', name: 'Portugal', nameZh: '葡萄牙', shortName: '葡萄牙', countryCode: 'PT', flagUrl: 'https://flagcdn.com/w80/pt.png' },
    { code: 'NED', name: 'Netherlands', nameZh: '荷兰', shortName: '荷兰', countryCode: 'NL', flagUrl: 'https://flagcdn.com/w80/nl.png' },
    { code: 'ITA', name: 'Italy', nameZh: '意大利', shortName: '意大利', countryCode: 'IT', flagUrl: 'https://flagcdn.com/w80/it.png' },
    { code: 'JPN', name: 'Japan', nameZh: '日本', shortName: '日本', countryCode: 'JP', flagUrl: 'https://flagcdn.com/w80/jp.png' },
    { code: 'KOR', name: 'South Korea', nameZh: '韩国', shortName: '韩国', countryCode: 'KR', flagUrl: 'https://flagcdn.com/w80/kr.png' },
    { code: 'USA', name: 'United States', nameZh: '美国', shortName: '美国', countryCode: 'US', flagUrl: 'https://flagcdn.com/w80/us.png' },
    { code: 'MEX', name: 'Mexico', nameZh: '墨西哥', shortName: '墨西哥', countryCode: 'MX', flagUrl: 'https://flagcdn.com/w80/mx.png' },
    { code: 'CAN', name: 'Canada', nameZh: '加拿大', shortName: '加拿大', countryCode: 'CA', flagUrl: 'https://flagcdn.com/w80/ca.png' },
    { code: 'URU', name: 'Uruguay', nameZh: '乌拉圭', shortName: '乌拉圭', countryCode: 'UY', flagUrl: 'https://flagcdn.com/w80/uy.png' },
    { code: 'COL', name: 'Colombia', nameZh: '哥伦比亚', shortName: '哥伦比亚', countryCode: 'CO', flagUrl: 'https://flagcdn.com/w80/co.png' },
    { code: 'BEL', name: 'Belgium', nameZh: '比利时', shortName: '比利时', countryCode: 'BE', flagUrl: 'https://flagcdn.com/w80/be.png' },
    { code: 'CRO', name: 'Croatia', nameZh: '克罗地亚', shortName: '克罗地亚', countryCode: 'HR', flagUrl: 'https://flagcdn.com/w80/hr.png' },
    { code: 'SEN', name: 'Senegal', nameZh: '塞内加尔', shortName: '塞内加尔', countryCode: 'SN', flagUrl: 'https://flagcdn.com/w80/sn.png' },
    { code: 'AUS', name: 'Australia', nameZh: '澳大利亚', shortName: '澳大利亚', countryCode: 'AU', flagUrl: 'https://flagcdn.com/w80/au.png' },
    { code: 'MAR', name: 'Morocco', nameZh: '摩洛哥', shortName: '摩洛哥', countryCode: 'MA', flagUrl: 'https://flagcdn.com/w80/ma.png' },
    { code: 'SUI', name: 'Switzerland', nameZh: '瑞士', shortName: '瑞士', countryCode: 'CH', flagUrl: 'https://flagcdn.com/w80/ch.png' },
    { code: 'DEN', name: 'Denmark', nameZh: '丹麦', shortName: '丹麦', countryCode: 'DK', flagUrl: 'https://flagcdn.com/w80/dk.png' },
    { code: 'POL', name: 'Poland', nameZh: '波兰', shortName: '波兰', countryCode: 'PL', flagUrl: 'https://flagcdn.com/w80/pl.png' },
    { code: 'ECU', name: 'Ecuador', nameZh: '厄瓜多尔', shortName: '厄瓜多尔', countryCode: 'EC', flagUrl: 'https://flagcdn.com/w80/ec.png' },
    { code: 'NGA', name: 'Nigeria', nameZh: '尼日利亚', shortName: '尼日利亚', countryCode: 'NG', flagUrl: 'https://flagcdn.com/w80/ng.png' },
    { code: 'SAU', name: 'Saudi Arabia', nameZh: '沙特', shortName: '沙特', countryCode: 'SA', flagUrl: 'https://flagcdn.com/w80/sa.png' },
    { code: 'QAT', name: 'Qatar', nameZh: '卡塔尔', shortName: '卡塔尔', countryCode: 'QA', flagUrl: 'https://flagcdn.com/w80/qa.png' },
    { code: 'IRN', name: 'Iran', nameZh: '伊朗', shortName: '伊朗', countryCode: 'IR', flagUrl: 'https://flagcdn.com/w80/ir.png' },
    { code: 'SRB', name: 'Serbia', nameZh: '塞尔维亚', shortName: '塞尔维亚', countryCode: 'RS', flagUrl: 'https://flagcdn.com/w80/rs.png' },
    { code: 'GHA', name: 'Ghana', nameZh: '加纳', shortName: '加纳', countryCode: 'GH', flagUrl: 'https://flagcdn.com/w80/gh.png' },
    { code: 'CMR', name: 'Cameroon', nameZh: '喀麦隆', shortName: '喀麦隆', countryCode: 'CM', flagUrl: 'https://flagcdn.com/w80/cm.png' },
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
  const gatewayBaseUrl = process.env.AI_GATEWAY_BASE_URL;
  const modelGatewayConfig = (temperature: number) => ({
    temperature,
    maxTokens: 4096,
    ...(gatewayBaseUrl ? { baseUrl: gatewayBaseUrl } : {}),
  });

  const modelData = [
    {
      modelId: process.env.AI_MODEL_GPT ?? 'gpt-4.1-mini',
      displayName: 'GPT',
      persona: 'STEADY' as const,
      provider: 'openai',
      sortOrder: 10,
      description: 'GPT 系列，稳健综合分析，支持通过 AI_GATEWAY_BASE_URL 或模型级 baseUrl 中转调用',
      config: modelGatewayConfig(0.3),
    },
    {
      modelId: process.env.AI_MODEL_CLAUDE ?? 'claude-3-5-sonnet-latest',
      displayName: 'Claude',
      persona: 'DATA_DRIVEN' as const,
      provider: 'anthropic',
      sortOrder: 20,
      description: 'Claude 系列，强调逻辑推演与风险拆解，可通过中转站 OpenAI 兼容接口调用',
      config: modelGatewayConfig(0.25),
    },
    {
      modelId: process.env.AI_MODEL_GEMINI ?? 'gemini-2.5-flash',
      displayName: 'Gemini',
      persona: 'ATTACKING' as const,
      provider: 'google',
      sortOrder: 30,
      description: 'Gemini 系列，关注比赛节奏、攻防转换和大球区间',
      config: modelGatewayConfig(0.45),
    },
    {
      modelId: process.env.AI_MODEL_KIMI ?? 'moonshot-v1-8k',
      displayName: 'Kimi',
      persona: 'STEADY' as const,
      provider: 'moonshot',
      sortOrder: 40,
      description: 'Kimi/月之暗面，作为中文语境足球分析补充，经中转站接入',
      config: modelGatewayConfig(0.35),
    },
    {
      modelId: process.env.AI_MODEL_XIAOMI ?? 'xiaoai-latest',
      displayName: 'Xiaomi',
      persona: 'UPSET_HUNTER' as const,
      provider: 'xiaomi',
      sortOrder: 50,
      description: '小米大模型，偏冷门变量和临场不确定性，经中转站接入',
      config: modelGatewayConfig(0.55),
    },
    {
      modelId: process.env.AI_MODEL_QWEN ?? 'qwen-plus',
      displayName: '千问',
      persona: 'DATA_DRIVEN' as const,
      provider: 'qwen',
      sortOrder: 60,
      description: '通义千问，强调结构化数据与概率校准，经中转站接入',
      config: modelGatewayConfig(0.3),
    },
    {
      modelId: process.env.AI_MODEL_MINIMAX ?? 'abab6.5s-chat',
      displayName: 'MiniMax',
      persona: 'ATTACKING' as const,
      provider: 'minimax',
      sortOrder: 70,
      description: 'MiniMax，补充进球、比分和半全场判断，经中转站接入',
      config: modelGatewayConfig(0.4),
    },
    {
      modelId: process.env.AI_MODEL_ZHIPU ?? 'glm-4-flash',
      displayName: '智谱',
      persona: 'STEADY' as const,
      provider: 'zhipu',
      sortOrder: 80,
      description: '智谱 GLM，补充中文赛事理解和稳健结论，经中转站接入',
      config: modelGatewayConfig(0.35),
    },
    // ─── Lindy AI 外部模型（通过 webhook 异步调用）──────────────────────────────
    {
      modelId: 'lindy-o3',
      displayName: 'Lindy O3',
      persona: 'DATA_DRIVEN' as const,
      provider: 'lindy',
      sortOrder: 90,
      description: 'OpenAI o3 深度推理，通过 Lindy webhook 异步调用',
      config: { type: 'lindy-webhook', model: 'o3' },
    },
    {
      modelId: 'lindy-gpt5_5',
      displayName: 'Lindy GPT-5.5',
      persona: 'ATTACKING' as const,
      provider: 'lindy',
      sortOrder: 91,
      description: 'GPT-5.5 分析，通过 Lindy webhook 异步调用',
      config: { type: 'lindy-webhook', model: 'gpt5_5' },
    },
    {
      modelId: 'lindy-claude',
      displayName: 'Lindy Claude',
      persona: 'STEADY' as const,
      provider: 'lindy',
      sortOrder: 92,
      description: 'Claude 4.7 Opus Thinking，通过 Lindy webhook 异步调用',
      config: { type: 'lindy-webhook', model: 'claude' },
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
          version: 'T_MINUS_7H',
        },
      },
      update: {},
      create: {
        matchId: match.id,
        version: 'T_MINUS_7H',
        status: 'PENDING',
        trigger: 'CRON',
        modelCount: modelData.length,
      },
    });
  }
  console.log(`  ✓ PredictionTasks: ${matches.length} T-24h tasks created`);

  // ─── T1-03: Guest / User / Invitation / Entitlement ─────────────────────────

  // Create a sample guest
  const guest = await prisma.guest.upsert({
    where: { fingerprint: 'demo-fingerprint-abc123' },
    update: {},
    create: {
      fingerprint: 'demo-fingerprint-abc123',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      ipAddress: '203.0.113.1',
      locale: 'en',
      freeUsedToday: 0,
      freeResetDate: '2026-06-11',
    },
  });
  console.log(`  ✓ Guest: ${guest.id} (fingerprint: ${guest.fingerprint})`);

  // Create a sample registered user (upgraded from guest)
  const user = await prisma.user.upsert({
    where: { wechatOpenId: 'demo-openid-001' },
    update: {
      inviteCode: 'INVITE-DEMO-001',
    },
    create: {
      wechatOpenId: 'demo-openid-001',
      unionId: 'demo-unionid-001',
      nickname: '球迷小王',
      avatarUrl: null,
      locale: 'zh_CN',
      timezone: 'Asia/Shanghai',
      isPassActive: false,
      guestId: guest.id,
      inviteCode: 'INVITE-DEMO-001',
    },
  });
  console.log(`  ✓ User: ${user.id} (${user.nickname})`);

  // Create a second user for invitation demo
  const user2 = await prisma.user.upsert({
    where: { wechatOpenId: 'demo-openid-002' },
    update: {
      inviteCode: 'INVITE-DEMO-002',
    },
    create: {
      wechatOpenId: 'demo-openid-002',
      nickname: 'Football Fan',
      locale: 'en',
      timezone: 'America/New_York',
      isPassActive: false,
      inviteCode: 'INVITE-DEMO-002',
    },
  });
  console.log(`  ✓ User: ${user2.id} (${user2.nickname})`);

  // Create an accepted invitation usage record from user1 to user2.
  // Fixed invite codes now live on User.inviteCode; Invitation.code is only a usage snapshot.
  const invitation = await prisma.invitation.upsert({
    where: { inviteeId: user2.id },
    update: {
      inviterId: user.id,
      code: 'INVITE-DEMO-001',
      status: 'ACCEPTED',
      acceptedAt: new Date('2026-06-10T10:00:00Z'),
      rewardGranted: true,
    },
    create: {
      inviterId: user.id,
      code: 'INVITE-DEMO-001',
      inviteeId: user2.id,
      status: 'ACCEPTED',
      acceptedAt: new Date('2026-06-10T10:00:00Z'),
      rewardGranted: true,
    },
  });
  console.log(`  ✓ Invitation usage: ${invitation.code} (${invitation.status})`);

  // Create free daily entitlements for demo identities. Entitlement has no natural unique key,
  // so demo rows are cleaned and recreated to keep the seed script idempotent.
  const today = new Date();
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);
  const rewardExpiry = new Date('2026-07-19T00:00:00Z');

  await prisma.entitlement.deleteMany({
    where: {
      OR: [
        { userId: user.id, description: { in: ['每日免费权益 - 查看3场AI预测', '邀请好友奖励 - 额外5次AI预测查看'] } },
        { userId: user2.id, description: '每日免费权益 - 查看3场AI预测' },
        { guestId: guest.id, description: '游客每日免费权益 - 查看1场AI预测' },
      ],
    },
  });

  await prisma.entitlement.createMany({
    data: [
      {
        userId: user.id,
        source: 'FREE_DAILY',
        status: 'ACTIVE',
        validFrom: today,
        validUntil: endOfDay,
        usedCount: 0,
        maxCount: 3,
        description: '每日免费权益 - 查看3场AI预测',
      },
      {
        userId: user2.id,
        source: 'FREE_DAILY',
        status: 'ACTIVE',
        validFrom: today,
        validUntil: endOfDay,
        usedCount: 0,
        maxCount: 3,
        description: '每日免费权益 - 查看3场AI预测',
      },
      {
        userId: user.id,
        source: 'INVITE_REWARD',
        status: 'ACTIVE',
        validFrom: new Date('2026-06-10T10:00:00Z'),
        validUntil: rewardExpiry,
        usedCount: 0,
        maxCount: 5,
        invitationId: invitation.id,
        description: '邀请好友奖励 - 额外5次AI预测查看',
      },
      {
        guestId: guest.id,
        source: 'FREE_DAILY',
        status: 'ACTIVE',
        validFrom: today,
        validUntil: endOfDay,
        usedCount: 0,
        maxCount: 1,
        description: '游客每日免费权益 - 查看1场AI预测',
      },
    ],
  });
  console.log('  ✓ Entitlements: 4 recreated (2 free daily + 1 invite reward + 1 guest)');

  // ─── F1 Personality Test Baseline ─────────────────────────────────────────────
  const personalityActivity = await prisma.personalityActivity.upsert({
    where: { code: 'worldcup-personality-v1' },
    update: {
      name: '世界杯球迷人格测试',
      configVersion: 1,
      isActive: true,
      settings: {
        resultSkins: ['CLASSIC_DARK', 'NEON_GREEN'],
        defaultLocale: 'zh_CN',
        shareScenes: ['result', 'friend_vote'],
        abFlags: { subtitlePool: 'v1', resultImage: 'v1' },
      },
    },
    create: {
      code: 'worldcup-personality-v1',
      name: '世界杯球迷人格测试',
      configVersion: 1,
      startsAt: new Date('2026-06-01T00:00:00Z'),
      endsAt: new Date('2026-07-20T00:00:00Z'),
      isActive: true,
      settings: {
        resultSkins: ['CLASSIC_DARK', 'NEON_GREEN'],
        defaultLocale: 'zh_CN',
        shareScenes: ['result', 'friend_vote'],
        abFlags: { subtitlePool: 'v1', resultImage: 'v1' },
      },
    },
  });

  const personalityTypes = [
    {
      code: 'TACTICIAN',
      name: '战术显微镜',
      shortName: '战术派',
      description: '你看球像拆解一台正在高速运转的机器。别人只看到谁进了球，你会倒回去看三次压迫触发、两次肋部换位和一次主教练终于开窍的换人。你不是不激动，只是你的快乐需要被画成战术板。',
      traits: {
        keywords: ['战术脑', '复盘狂', '影子主帅', '懂球嘴'],
        shareTone: '专业但不端着',
        personaBio: '你的球迷人格像一副随身战术板：表面淡定，内心一直在拉线、标点、画箭头。你很少被单个进球骗走注意力，因为你更在意那个进球为什么会发生。朋友说你太较真，但他们赛后又会偷偷问你「这场到底输在哪」。',
        truthHit: '你最容易在比赛第15分钟就判断出今天的节奏问题，然后在第75分钟用一种“我早说了但我不说”的表情喝水。',
        blindSpot: '你的弱点是偶尔把一场热血比赛讲成硕士答辩。建议保留一点不讲道理的尖叫，否则朋友会以为你在给球队做尽调。',
        socialLine: '朋友眼中的你：看台上的无证助教，群聊里的战术字幕组。',
        shareLine: '我不是在看球，我是在给主教练做绩效面谈。',
      },
      indices: { rational: 96, passion: 62, risk: 44, banter: 58 },
      defaultCta: { label: '保存我的战术人格图', action: 'SHARE' },
      rarity: 'RARE',
      themeColor: '#16F2A4',
      sortOrder: 10,
      subtitles: [
        '嘴上说随便看看，脑内已经画出三套阵型。',
        '别人看进球，你看进球前那三次跑位。',
        '你不是球迷，你是无证执教的影子主帅。',
        '阵型图比菜单更能让你兴奋。',
        '高位压迫和低位防守，你能聊三小时不重样。',
        '你看的不是比赛，你在做竞品分析。',
        '这个换人时机差两分钟，是你对世界最后的温柔提醒。',
        '如果足球有会议纪要，你已经写完三版。',
      ],
    },
    {
      code: 'BELIEF_STRIKER',
      name: '信仰前锋',
      shortName: '信仰派',
      description: '你对主队的爱不讲赔率、不讲状态、不讲伤停，讲的是一种“只要还没开场就一定能赢”的宇宙级信念。你可以承认对手很强，但绝不会承认自己先怂。',
      traits: {
        keywords: ['热血', '死忠', '护队', '精神股东'],
        shareTone: '燃且适合拉好友审判',
        personaBio: '你是那种会把一支球队爱成生活背景音的人。赢球时你像股东分红，输球时你像公关总监，连夜给球队找理由、修叙事、安抚群众。理性当然重要，但在你这里，理性必须先排队接受信仰审查。',
        truthHit: '你最擅长把“最近状态不好”翻译成“他们正在憋个大的”。',
        blindSpot: '你的弱点是容易把希望和预测混在一起。建议偶尔允许自己说一句“今天确实悬”，这不会背叛主队，只会保护血压。',
        socialLine: '朋友眼中的你：球队编外新闻发言人，逆风局情绪救生员。',
        shareLine: '数据可以输，气势必须赢。',
      },
      indices: { rational: 54, passion: 98, risk: 68, banter: 72 },
      defaultCta: { label: '保存我的信仰人格图', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#FACC15',
      sortOrder: 20,
      subtitles: [
        '你的主队还没进场，你的朋友圈已经开赛。',
        '落后两球？你叫它剧情需要。',
        '赢了是实力，输了是状态，这套话你早就背熟了。',
        '你爱的球队不需要理由，需要的是你。',
        '理性分析是别人的事，你的事是相信到终场哨响。',
        '你的主队永远值得一个“下次一定”。',
        '你不是在看球，你是在陪你的信仰上班。',
        '别人看积分榜，你看命运还欠我们什么。',
      ],
    },
    {
      code: 'UPSET_HUNTER',
      name: '冷门猎手',
      shortName: '冷门派',
      description: '你天生对“稳了”两个字过敏。越多人说热门必胜，你越能闻到空气里那一点不对劲。你的快乐不是预测对强队赢，而是在全网沉默时轻轻说一句：我早说这场有问题。',
      traits: {
        keywords: ['反套路', '冷门嗅觉', '冒险家', '预言截图党'],
        shareTone: '轻挑衅',
        personaBio: '你看球像在城市下水道里寻找剧情暗流。热门给别人安全感，冷门给你生命力。你并不是单纯想反着来，你只是对足球里那些小概率叛乱特别敏感：一次门将神扑、一次红牌、一次离谱折射，都可能让你精神抖擞。',
        truthHit: '你最喜欢的不是爆冷本身，而是爆冷之后翻出聊天记录的那一秒。',
        blindSpot: '你的弱点是有时会把“可能爆冷”和“我想看爆冷”混成同一种感觉。建议给自己的直觉配一个刹车，不然很容易把宇宙想象成你的编剧。',
        socialLine: '朋友眼中的你：赔率表边上的野生预言家，群聊里的剧情恐怖分子。',
        shareLine: '热门负责安全感，冷门负责让我封神。',
      },
      indices: { rational: 66, passion: 76, risk: 95, banter: 88 },
      defaultCta: { label: '保存我的冷门人格图', action: 'SHARE' },
      rarity: 'EPIC',
      themeColor: '#FB7185',
      sortOrder: 30,
      subtitles: [
        '你不是预测比赛，你是在给宇宙制造剧情。',
        '赔率越高，你的眼神越亮。',
        '热门队赢了你不高兴，冷门队赢了你截图存档。',
        '冷门是你的母语，热门是你的外语。',
        '你不是唱反调，你只是听见了命运的跑调。',
        '别人看强队，你盯弱队的眼神像发现宝藏。',
        '你的口头禅：我就说这场有问题。',
        '足球不爆冷，对你来说像电视剧没反转。',
      ],
    },
    {
      code: 'SOCIAL_CAPTAIN',
      name: '气氛队长',
      shortName: '社交派',
      description: '你也许不是最会背阵型的人，但一定是最会把比赛变成一场局的人。你的核心天赋不是看穿战术，而是让一群人因为一场球在同一个瞬间大笑、破防、尖叫和截图。',
      traits: {
        keywords: ['组局王', '气氛发动机', '朋友雷达', '看台PM'],
        shareTone: '轻松好转发',
        personaBio: '你看球自带扩音器和召集令。你知道谁适合坐一起，谁不能坐一起，谁一输球就需要安慰，谁一赢球就会膨胀到离谱。你把比赛变成共同记忆的能力，比很多球队的中场组织还稳定。',
        truthHit: '你最怕的不是输球，而是进球时群里没人回你。',
        blindSpot: '你的弱点是容易为了热闹错过一些比赛细节。建议关键时刻先看完回放再发梗，命中率会更高，杀伤力也更大。',
        socialLine: '朋友眼中的你：人形看球局发起器，群聊情绪运营总监。',
        shareLine: '没有我，群聊只是群；有了我，群聊才是看台。',
      },
      indices: { rational: 48, passion: 86, risk: 60, banter: 96 },
      defaultCta: { label: '保存我的气氛人格图', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#60A5FA',
      sortOrder: 40,
      subtitles: [
        '你负责看球，朋友负责被你喊来看球。',
        '你不懂越位，但你懂怎么让气氛不越位。',
        '进球了你第一个发梗图，输球了你第一个发安慰包。',
        '没有你的看球局，叫独自看球。',
        '你的核心能力：让不看球的人也想看球。',
        '你不是球迷，你是球迷群体的 PM。',
        '一场普通比赛，经你转发就有了社交意义。',
        '你的群聊控场能力，建议纳入国家队中场考察。',
      ],
    },
    {
      code: 'DATA_KEEPER',
      name: '数据门将',
      shortName: '数据派',
      description: '你相信概率、样本、赔率和风险控制。你不是没有情绪，只是情绪在你这里也要先经过表格、趋势线和置信区间的安检。你负责把大家从“我感觉”里救出来。',
      traits: {
        keywords: ['概率脑', '稳健派', '校准师', '风险雷达'],
        shareTone: '冷静反差感',
        personaBio: '你的球迷人格像一名站位极佳的门将：不轻易出击，但每次出击都有理由。你不喜欢被单场结果绑架，更在意长期判断是否稳定。别人激情开麦时，你默默看赔率变化；别人赛后破防时，你已经在复盘模型哪里偏了。',
        truthHit: '你最常说“不是不能买，是赔率没有价值”，听起来冷漠，其实是在救朋友钱包。',
        blindSpot: '你的弱点是偶尔错过足球最不讲理的部分。建议给小概率留一个浪漫窗口，毕竟足球不是 Excel 插件。',
        socialLine: '朋友眼中的你：群聊风控官，冲动下注急救员。',
        shareLine: '我的预测带误差棒，别人的预测带情绪。',
      },
      indices: { rational: 92, passion: 50, risk: 28, banter: 44 },
      defaultCta: { label: '保存我的数据人格图', action: 'SHARE' },
      rarity: 'RARE',
      themeColor: '#38BDF8',
      sortOrder: 50,
      subtitles: [
        '你不是保守，你是在等概率给你一个交代。',
        '别人看比分，你看置信区间。',
        '赔率变动比进球更能让你抬头。',
        '你不是冷漠，你是在做实时贝叶斯更新。',
        '你的看球笔记比大多数人的工作报告更严谨。',
        '你不是不兴奋，你是在等样本量够了再兴奋。',
        '你的口头禅：这个结论需要更多数据支撑。',
        '足球在别人眼里是热血，在你眼里是带噪声的概率分布。',
      ],
    },
    {
      code: 'FLAG_BEARER',
      name: '立旗大使',
      shortName: '立旗派',
      description: '你深知赛前不说点什么，比赛就少了一半仪式感。你享受公开表达判断的刺激，也接受赛后被截图清算的命运。对你来说，预测不是结论，是把自己押进剧情里。',
      traits: {
        keywords: ['宣言家', '赛前发言人', '截图体质', '嘴硬美学'],
        shareTone: '适合晒图立 Flag',
        personaBio: '你的人格里住着一面随时准备升起的旗。你需要观众，需要见证，需要那种“我现在就把话放这”的公开感。命中时你是预言家，翻车时你是节目效果贡献者，总之你不会让比赛平平无奇地过去。',
        truthHit: '你发赛前预测时的心理活动：如果中了就是神，如果没中也能解释。',
        blindSpot: '你的弱点是为了表达而过度自信。建议偶尔给旗杆加个避雷针，比如“如果首发正常的话”。',
        socialLine: '朋友眼中的你：朋友圈赛前发布会主持人，赛后截图重点保护对象。',
        shareLine: '赛前立旗，赛后截图，这是我的完整工作流。',
      },
      indices: { rational: 58, passion: 90, risk: 82, banter: 78 },
      defaultCta: { label: '保存我的立旗人格图', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#F97316',
      sortOrder: 60,
      subtitles: [
        '你的预测不一定全中，但一定全网可见。',
        '你不是嘴硬，你是在为剧情提前埋点。',
        '中了是眼光，没中是这场有问题。',
        '你不怕打脸，你怕没人看见你的脸。',
        '立旗是你的语言，打脸是你的流量密码。',
        '你的朋友圈是你的预测档案库。',
        '赛前不发言，你会觉得这场球少了你的参与感。',
        '你的每一句“我觉得”都自带截图风险。',
      ],
    },
    {
      code: 'COMEBACK_POET',
      name: '逆转诗人',
      shortName: '逆转派',
      description: '你相信补时里藏着命运的暗门。落后不是失败，而是故事进入第二幕；被压着打不是崩盘，而是反击铺垫。你看比赛不像看比分，更像等待一次足以让人起鸡皮疙瘩的转折。',
      traits: {
        keywords: ['奇迹信徒', '补时文学', '热血叙事', '耐心怪'],
        shareTone: '热血叙事',
        personaBio: '你是足球世界里的叙事动物。你会记住绝平前的沉默、逆转前的窒息、终场哨前最后一次长传。你知道概率不一定站在你这边，但你更知道，足球最迷人的地方恰恰是不肯完全服从概率。',
        truthHit: '你最爱说“还有时间”，哪怕屏幕上只剩四分钟，连裁判都想下班。',
        blindSpot: '你的弱点是对奇迹太宽容，容易把明显的战术问题也解释成铺垫。建议保留浪漫，但别让浪漫替主教练背锅。',
        socialLine: '朋友眼中的你：补时阶段情绪诗人，逆风局精神供氧机。',
        shareLine: '终场哨没响，我的剧本就没写完。',
      },
      indices: { rational: 56, passion: 94, risk: 70, banter: 52 },
      defaultCta: { label: '保存我的逆转人格图', action: 'SHARE' },
      rarity: 'RARE',
      themeColor: '#A78BFA',
      sortOrder: 70,
      subtitles: [
        '落后两球在你眼里叫剧情刚开始。',
        '补时进球是你的人生哲学。',
        '你不看结果，你看的是那个转折点。',
        '你相信的不是球队，是故事本身。',
        '你看的是比赛，心里跑的是电影预告片。',
        '每一场逆转都在给你的世界观续命。',
        '别人说没了，你说等等，镜头还没给够。',
        '你的心率曲线专门为补时而生。',
      ],
    },
    {
      code: 'DERBY_FIRE',
      name: '德比火药桶',
      shortName: '对线派',
      description: '你不是喜欢吵架，你只是对强对抗叙事特别有天赋。越是德比、恩怨、争议和宿敌，你越能进入状态。你的观点不一定要被所有人认同，但必须有人回应。',
      traits: {
        keywords: ['对线王', '火药味', '名场面体质', '观点锋利'],
        shareTone: '毒舌但可控',
        personaBio: '你的球迷人格像一根擦燃的火柴，专门负责让比赛从“有点意思”升级成“今晚别睡”。你擅长抓住矛盾点，把一句普通评价加工成群聊辩题。你并非只想挑衅，你真正享受的是观点碰撞的高温。',
        truthHit: '群聊安静超过三分钟，你会本能地觉得自己有义务添一把火。',
        blindSpot: '你的弱点是有时把表达欲误认为判断力。建议在开火前先确认目标，不然容易把友军也卷进禁区。',
        socialLine: '朋友眼中的你：德比日气氛升温器，群聊争议 KPI 负责人。',
        shareLine: '没有争议的比赛，在我眼里叫无聊。',
      },
      indices: { rational: 52, passion: 88, risk: 76, banter: 98 },
      defaultCta: { label: '保存我的对线人格图', action: 'SHARE' },
      rarity: 'EPIC',
      themeColor: '#EF4444',
      sortOrder: 80,
      subtitles: [
        '你不怕打脸，你怕比赛太平淡。',
        '群聊沉默三分钟，你负责把火药味续上。',
        '你不是在吵架，你是在制造名场面。',
        '德比日是你的节日，普通比赛是你的热身。',
        '你的观点不需要被认同，需要被回应。',
        '你不是挑衅，你是在给对话加热。',
        '你的存在让每场比赛都有了对抗感。',
        '如果足球没有火药味，你会亲自带打火机。',
      ],
    },
    {
      code: 'VAR_JUDGE',
      name: 'VAR 审判官',
      shortName: '审判派',
      description: '你对判罚、尺度和细节有天然雷达。别人还在喊黑哨，你已经开始找慢镜头、规则条款和接触点。你看球不只是看热闹，你在维护足球宇宙的程序正义。',
      traits: {
        keywords: ['规则控', '慢镜头猎人', '公平洁癖', '人形VAR'],
        shareTone: '适合好友投票',
        personaBio: '你的人格里住着一间临时裁判室。只要出现争议，你会瞬间从球迷切换成审查员：有没有越位，手臂位置自然不自然，接触是否足以改变动作。朋友嫌你较真，但关键判罚一来，他们第一时间还是会等你发言。',
        truthHit: '你最不能忍的不是误判，而是有人不看回放就开始输出。',
        blindSpot: '你的弱点是容易把比赛情绪拆得太干净。建议偶尔允许自己先喊一句，再进入审判流程。',
        socialLine: '朋友眼中的你：群聊临时裁判长，争议判罚终审大法官。',
        shareLine: '别人吵情绪，我调取慢镜头。',
      },
      indices: { rational: 86, passion: 66, risk: 38, banter: 74 },
      defaultCta: { label: '保存我的审判人格图', action: 'SHARE' },
      rarity: 'RARE',
      themeColor: '#22C55E',
      sortOrder: 90,
      subtitles: [
        '你不是较真，你是在维护足球宇宙的秩序。',
        '别人吵情绪，你开始调取慢镜头。',
        '你的朋友叫你人形 VAR。',
        '细节是你的战场，情绪是别人的战场。',
        '你看球的同时在做实时规则审计。',
        '你不是吹毛求疵，你是在维护比赛的尊严。',
        '争议判罚出现时，你的眼神比裁判还坚定。',
        '如果群聊有上诉机制，你就是终审。',
      ],
    },
    {
      code: 'NOSTALGIA_ULTRA',
      name: '怀旧死忠',
      shortName: '回忆派',
      description: '你看世界杯时，不只是在看当下，也在和过去的自己重逢。老球星、老镜头、老球衣和老解说词都能把你一下拉回某个夏天。你爱的不是怀旧本身，而是足球替你保存了时间。',
      traits: {
        keywords: ['情怀库', '老球迷', '记忆收藏家', '青春回放'],
        shareTone: '情怀共鸣',
        personaBio: '你的球迷人格像一本会自己翻页的世界杯相册。你总能把一场普通比赛聊到某届经典之夜，也能从一件球衣颜色里想起当年那支队。你不是抗拒新故事，只是你知道，足球最珍贵的地方，是它会把人生某一段悄悄存档。',
        truthHit: '你最容易在年轻球员登场时说出“他让我想起当年的某某”。',
        blindSpot: '你的弱点是偶尔用回忆压住现在。建议给新球员一点时间，也许他们正在制造你十年后会怀念的镜头。',
        socialLine: '朋友眼中的你：世界杯活档案，青春滤镜合法持有者。',
        shareLine: '我的世界杯不是四年一次，是青春定期返场。',
      },
      indices: { rational: 62, passion: 96, risk: 42, banter: 50 },
      defaultCta: { label: '保存我的回忆人格图', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#F59E0B',
      sortOrder: 100,
      subtitles: [
        '你的世界杯不是四年一次，是青春定期返场。',
        '别人追热点，你在给旧时光续杯。',
        '你能把任何一场比赛聊到 2002 年。',
        '你的世界杯记忆比你的手机相册更清晰。',
        '老球星退役了，但在你心里他们还在踢。',
        '你爱的不只是足球，是那个看球时的自己。',
        '你不是念旧，你只是记得太认真。',
        '每届世界杯，都像有人按下你青春的播放键。',
      ],
    },
    {
      code: 'LIVE_WIRE',
      name: '实时电台',
      shortName: '解说派',
      description: '你看球时自带第二声道。一次传球、一次失误、一次门将出击，都能被你即时加工成解说、吐槽、梗和朋友圈素材。沉默不是你的风格，你负责让比赛有声音。',
      traits: {
        keywords: ['弹幕嘴', '即时反应', '梗制造机', '第二声道'],
        shareTone: '高频互动',
        personaBio: '你的球迷人格像一个永不断线的现场电台。你反应快、表达密、情绪有节奏，能把一场平淡比赛讲出综艺感。你不是单纯话多，而是脑内弹幕太拥挤，不及时播报会堵车。',
        truthHit: '你最常在进球前半秒已经组织好三条文案，进球后只需要选择发哪条。',
        blindSpot: '你的弱点是容易边说边错过关键信息。建议偶尔给自己设置五秒静音，下一条梗可能更准。',
        socialLine: '朋友眼中的你：人形弹幕机，关键球音量增强器。',
        shareLine: '我不只是看比赛，我是比赛的第二声道。',
      },
      indices: { rational: 50, passion: 84, risk: 58, banter: 92 },
      defaultCta: { label: '保存我的解说人格图', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#EC4899',
      sortOrder: 110,
      subtitles: [
        '没有你，关键球少一半音量。',
        '你的实时解说比官方解说更有梗。',
        '进球前你已经开始组织语言了。',
        '你的群聊消息数量等于比赛精彩程度。',
        '你不是话多，你是信息密度高。',
        '沉默对你来说是一种体力消耗。',
        '你看球不是开麦，是默认麦克风常亮。',
        '比赛一有风吹草动，你的嘴已经完成热身。',
      ],
    },
    {
      code: 'LUCKY_MASCOT',
      name: '玄学吉祥物',
      shortName: '玄学派',
      description: '你坚信球衣、座位、奶茶口味、开赛姿势和转发顺序都会影响比赛走向。科学负责解释世界，你负责给世界一点不讲道理但特别好用的气场。',
      traits: {
        keywords: ['仪式感', '量子球迷', '好运担当', '反奶法师'],
        shareTone: '轻松好玩',
        personaBio: '你的球迷人格像一个移动幸运物。你不一定能说清楚为什么这件球衣不能洗、为什么这个位置不能换、为什么开场前必须先点那杯饮料，但你有完整证据链：上次照做，真的赢了。逻辑可以晚点来，气场必须先到位。',
        truthHit: '你最擅长把“巧合”升级成“以后都按这个来”。',
        blindSpot: '你的弱点是容易把所有结果都纳入玄学体系。建议偶尔承认一下对方确实踢得好，这不会削弱你的法力。',
        socialLine: '朋友眼中的你：球队气运外包商，主场能量场管理员。',
        shareLine: '我的仪式感不是迷信，是第十二人战术。',
      },
      indices: { rational: 34, passion: 88, risk: 72, banter: 86 },
      defaultCta: { label: '保存我的玄学人格图', action: 'SHARE' },
      rarity: 'LEGENDARY',
      themeColor: '#C084FC',
      sortOrder: 120,
      subtitles: [
        '科学负责解释世界，你负责改变比分气场。',
        '你换了座位，主队进球了，这是因果关系。',
        '你的球衣洗了之后主队输了，这是数据。',
        '你不是在看球，你是在进行一场量子实验。',
        '你的玄学体系比大多数战术体系更自洽。',
        '奶茶口味和比赛结果之间，你已经建立了完整相关性模型。',
        '你是球场气场的守护者，AI 无法解释你。',
        '别人带战术板，你带幸运袜，效果都很难复现。',
      ],
    },
  ];

  for (const type of personalityTypes) {
    const personality = await prisma.personalityType.upsert({
      where: { activityId_code: { activityId: personalityActivity.id, code: type.code } },
      update: {
        name: type.name,
        shortName: type.shortName,
        description: type.description,
        traits: type.traits,
        indices: type.indices,
        defaultCta: type.defaultCta,
        rarity: type.rarity,
        themeColor: type.themeColor,
        sortOrder: type.sortOrder,
        isActive: true,
      },
      create: {
        activityId: personalityActivity.id,
        code: type.code,
        name: type.name,
        shortName: type.shortName,
        description: type.description,
        traits: type.traits,
        indices: type.indices,
        defaultCta: type.defaultCta,
        rarity: type.rarity,
        themeColor: type.themeColor,
        sortOrder: type.sortOrder,
        isActive: true,
      },
    });

    await prisma.personalitySubtitle.deleteMany({ where: { personalityId: personality.id } });
    // 8条副标题：前4条用于结果卡（权重递减），后4条用于分享图（权重递减）
    const SCENES = ['RESULT_CARD', 'RESULT_CARD', 'RESULT_CARD', 'RESULT_CARD', 'SHARE_IMAGE', 'SHARE_IMAGE', 'SHARE_IMAGE', 'SHARE_IMAGE'];
    const WEIGHTS = [4, 3, 2, 1, 4, 3, 2, 1];
    await prisma.personalitySubtitle.createMany({
      data: type.subtitles.map((content, index) => ({
        personalityId: personality.id,
        content,
        scene: SCENES[index] ?? 'RESULT_CARD',
        safetyLevel: 'SAFE',
        weight: WEIGHTS[index] ?? 1,
        isActive: true,
      })),
    });
  }

  const questions = [
    {
      code: 'q1_watch_style',
      title: '比赛刚开场十分钟，你最先盯什么？',
      subtitle: '别装，第一反应最诚实。',
      sortOrder: 10,
      options: [
        { key: 'a', label: '阵型站位和压迫触发点', weights: { TACTICIAN: 4, DATA_KEEPER: 2 } },
        { key: 'b', label: '主队今天气势对不对', weights: { BELIEF_STRIKER: 4, NOSTALGIA_ULTRA: 1 } },
        { key: 'c', label: '有没有爆冷苗头', weights: { UPSET_HUNTER: 4, LUCKY_MASCOT: 2 } },
        { key: 'd', label: '群里谁已经开始嘴硬', weights: { SOCIAL_CAPTAIN: 4, LIVE_WIRE: 2 } },
      ],
    },
    {
      code: 'q2_prediction_style',
      title: '赛前预测和 AI 不一致时，你会？',
      subtitle: '这是人格分水岭。',
      sortOrder: 20,
      options: [
        { key: 'a', label: '先看 AI 的依据再决定', weights: { TACTICIAN: 3, DATA_KEEPER: 4 } },
        { key: 'b', label: '坚持主队，AI 懂什么信仰', weights: { BELIEF_STRIKER: 4, FLAG_BEARER: 2 } },
        { key: 'c', label: '更兴奋了，反着来才刺激', weights: { UPSET_HUNTER: 4, DERBY_FIRE: 2 } },
        { key: 'd', label: '截图发群，让大家投票审判', weights: { SOCIAL_CAPTAIN: 4, VAR_JUDGE: 3 } },
      ],
    },
    {
      code: 'q3_after_match',
      title: '比赛结束后你最可能做什么？',
      subtitle: '赛后行为暴露真实属性。',
      sortOrder: 30,
      options: [
        { key: 'a', label: '复盘关键节点和换人', weights: { TACTICIAN: 4, VAR_JUDGE: 2 } },
        { key: 'b', label: '继续维护我的赛前立场', weights: { BELIEF_STRIKER: 4, FLAG_BEARER: 3 } },
        { key: 'c', label: '翻出“我早说了”的证据', weights: { UPSET_HUNTER: 4, DERBY_FIRE: 2 } },
        { key: 'd', label: '做梗图，今天谁也别睡', weights: { SOCIAL_CAPTAIN: 4, LIVE_WIRE: 3 } },
      ],
    },
    {
      code: 'q4_close_game',
      title: '比赛 80 分钟仍然平局，你心里在想？',
      subtitle: '关键时刻最能看出你是哪种球迷。',
      sortOrder: 40,
      options: [
        { key: 'a', label: '看谁的体能和替补更能改变局面', weights: { TACTICIAN: 4, DATA_KEEPER: 2 } },
        { key: 'b', label: '主队一定还有绝杀剧本', weights: { COMEBACK_POET: 4, BELIEF_STRIKER: 2 } },
        { key: 'c', label: '冷门味越来越浓了', weights: { UPSET_HUNTER: 4, LUCKY_MASCOT: 2 } },
        { key: 'd', label: '开始准备赛后第一条朋友圈', weights: { FLAG_BEARER: 4, LIVE_WIRE: 2 } },
      ],
    },
    {
      code: 'q5_group_chat',
      title: '群聊因为一次判罚吵起来，你通常？',
      subtitle: '你的社交球迷属性藏不住了。',
      sortOrder: 50,
      options: [
        { key: 'a', label: '找规则和慢镜头逐帧分析', weights: { VAR_JUDGE: 4, DATA_KEEPER: 2 } },
        { key: 'b', label: '先保护我方球迷情绪', weights: { BELIEF_STRIKER: 3, NOSTALGIA_ULTRA: 2 } },
        { key: 'c', label: '一句话把火药味点满', weights: { DERBY_FIRE: 4, LIVE_WIRE: 2 } },
        { key: 'd', label: '组织大家投票，别光吵', weights: { SOCIAL_CAPTAIN: 4, VAR_JUDGE: 2 } },
      ],
    },
    {
      code: 'q6_memory_trigger',
      title: '世界杯最容易戳中你的是什么？',
      subtitle: '不是每个人都只看结果。',
      sortOrder: 60,
      options: [
        { key: 'a', label: '强队体系和技术演进', weights: { TACTICIAN: 3, DATA_KEEPER: 3 } },
        { key: 'b', label: '老球星、老镜头和老故事', weights: { NOSTALGIA_ULTRA: 4, COMEBACK_POET: 2 } },
        { key: 'c', label: '弱队掀翻热门的瞬间', weights: { UPSET_HUNTER: 4, COMEBACK_POET: 2 } },
        { key: 'd', label: '全网一起玩梗的氛围', weights: { SOCIAL_CAPTAIN: 3, LIVE_WIRE: 4 } },
      ],
    },
    {
      code: 'q7_ai_pk_reason',
      title: '和 AI PK 时，你最想赢在哪一点？',
      subtitle: '选择你真正想证明的东西。',
      sortOrder: 70,
      options: [
        { key: 'a', label: '我对战术走势判断更准', weights: { TACTICIAN: 4, DATA_KEEPER: 3 } },
        { key: 'b', label: '我的信仰比模型更硬', weights: { BELIEF_STRIKER: 4, FLAG_BEARER: 3 } },
        { key: 'c', label: '我能看见 AI 忽略的冷门', weights: { UPSET_HUNTER: 4 } },
        { key: 'd', label: '我能把输赢都变成梗', weights: { LIVE_WIRE: 4, DERBY_FIRE: 3 } },
      ],
    },
    {
      code: 'q8_ritual',
      title: '重要比赛开赛前，你最可能做什么？',
      subtitle: '仪式感也是一种足球语言。',
      sortOrder: 80,
      options: [
        { key: 'a', label: '再看一遍双方首发和历史交锋', weights: { DATA_KEEPER: 4, TACTICIAN: 2 } },
        { key: 'b', label: '穿固定球衣或坐固定位置', weights: { LUCKY_MASCOT: 4, NOSTALGIA_ULTRA: 2 } },
        { key: 'c', label: '先发一条赛前宣言', weights: { FLAG_BEARER: 4, BELIEF_STRIKER: 2 } },
        { key: 'd', label: '把朋友都喊进同一个群', weights: { SOCIAL_CAPTAIN: 4, LIVE_WIRE: 2 } },
      ],
    },
    {
      code: 'q9_comeback_belief',
      title: '主队落后两球时，你会？',
      subtitle: '逆风时刻最见真章。',
      sortOrder: 90,
      options: [
        { key: 'a', label: '计算还有哪些调整能救回来', weights: { TACTICIAN: 3, DATA_KEEPER: 3 } },
        { key: 'b', label: '继续相信奇迹，直到终场', weights: { COMEBACK_POET: 4, BELIEF_STRIKER: 3 } },
        { key: 'c', label: '准备接受被打脸但嘴不能软', weights: { FLAG_BEARER: 3, DERBY_FIRE: 3 } },
        { key: 'd', label: '先把节目效果做起来', weights: { LIVE_WIRE: 4, SOCIAL_CAPTAIN: 2 } },
      ],
    },
    {
      code: 'q10_controversy',
      title: '你最受不了哪种看球发言？',
      subtitle: '厌恶点也会暴露人格。',
      sortOrder: 100,
      options: [
        { key: 'a', label: '不看过程，只会赛后诸葛亮', weights: { TACTICIAN: 3, DATA_KEEPER: 3 } },
        { key: 'b', label: '赢了就爱，输了就骂', weights: { BELIEF_STRIKER: 4, NOSTALGIA_ULTRA: 2 } },
        { key: 'c', label: '热门必胜，完全没有想象力', weights: { UPSET_HUNTER: 4, LUCKY_MASCOT: 2 } },
        { key: 'd', label: '梗都接不住，还把天聊死', weights: { SOCIAL_CAPTAIN: 3, LIVE_WIRE: 3 } },
      ],
    },
    {
      code: 'q11_share_card',
      title: '如果生成一张结果图，你希望它突出什么？',
      subtitle: '分享欲就是增长入口。',
      sortOrder: 110,
      options: [
        { key: 'a', label: '我的分析指数和人格标签', weights: { DATA_KEEPER: 4, TACTICIAN: 3 } },
        { key: 'b', label: '我支持球队的热血宣言', weights: { BELIEF_STRIKER: 4, FLAG_BEARER: 3 } },
        { key: 'c', label: '一句能让朋友来反驳的毒舌文案', weights: { DERBY_FIRE: 4, UPSET_HUNTER: 2 } },
        { key: 'd', label: '让朋友一眼就想跟测的轻松梗', weights: { SOCIAL_CAPTAIN: 4, LUCKY_MASCOT: 2 } },
      ],
    },
    {
      code: 'q12_final_pick',
      title: '最后一题：你会如何形容自己的世界杯模式？',
      subtitle: '给算法一个收口答案。',
      sortOrder: 120,
      options: [
        { key: 'a', label: '理性拆局，等待证据', weights: { TACTICIAN: 3, DATA_KEEPER: 4, VAR_JUDGE: 2 } },
        { key: 'b', label: '热爱至上，信到终场', weights: { BELIEF_STRIKER: 4, COMEBACK_POET: 3, NOSTALGIA_ULTRA: 2 } },
        { key: 'c', label: '反常识越多，我越兴奋', weights: { UPSET_HUNTER: 4, LUCKY_MASCOT: 3, FLAG_BEARER: 2 } },
        { key: 'd', label: '比赛是社交现场，梗和观点都要赢', weights: { SOCIAL_CAPTAIN: 4, LIVE_WIRE: 3, DERBY_FIRE: 3 } },
      ],
    },
  ];

  for (const question of questions) {
    await prisma.personalityQuestion.upsert({
      where: { activityId_code: { activityId: personalityActivity.id, code: question.code } },
      update: {
        title: question.title,
        subtitle: question.subtitle,
        type: 'SINGLE_CHOICE',
        options: question.options,
        sortOrder: question.sortOrder,
        isActive: true,
      },
      create: {
        activityId: personalityActivity.id,
        code: question.code,
        title: question.title,
        subtitle: question.subtitle,
        type: 'SINGLE_CHOICE',
        options: question.options,
        sortOrder: question.sortOrder,
        isActive: true,
      },
    });
  }
  console.log(`  ✓ F1 Personality baseline: ${personalityTypes.length} types, ${questions.length} questions`);

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

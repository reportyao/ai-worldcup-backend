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
      description: '你看球像拆解棋局，阵型、压迫和换人是你的快乐源泉。',
      traits: { keywords: ['理性', '控场', '复盘'], shareTone: '专业但不端着' },
      indices: { rational: 96, passion: 62, risk: 44, banter: 58 },
      defaultCta: { label: '拿我的战术人格去 PK AI', action: 'AI_PK' },
      rarity: 'RARE',
      themeColor: '#16F2A4',
      sortOrder: 10,
      subtitles: ['嘴上说随便看看，脑内已经画出三套阵型。', '你不是在看球，你是在给主教练做绩效面谈。'],
    },
    {
      code: 'BELIEF_STRIKER',
      name: '信仰前锋',
      shortName: '信仰派',
      description: '你愿意为热爱的球队提前开香槟，也愿意为逆风局坚持到最后一分钟。',
      traits: { keywords: ['热血', '站队', '忠诚'], shareTone: '燃且适合拉好友审判' },
      indices: { rational: 54, passion: 98, risk: 68, banter: 72 },
      defaultCta: { label: '让 AI 见识我的信仰', action: 'AI_PK' },
      rarity: 'COMMON',
      themeColor: '#FACC15',
      sortOrder: 20,
      subtitles: ['数据可以输，气势必须赢。', '你的主队还没进场，你的朋友圈已经开赛。'],
    },
    {
      code: 'UPSET_HUNTER',
      name: '冷门猎手',
      shortName: '冷门派',
      description: '越是不被看好，你越想下注情绪价值；你的快乐来自“我早说了”。',
      traits: { keywords: ['冒险', '反套路', '毒舌'], shareTone: '轻挑衅' },
      indices: { rational: 66, passion: 76, risk: 95, banter: 88 },
      defaultCta: { label: '和 AI 赌一把冷门', action: 'AI_PK' },
      rarity: 'EPIC',
      themeColor: '#FB7185',
      sortOrder: 30,
      subtitles: ['热门负责安全感，冷门负责让你封神。', '你不是预测比赛，你是在给宇宙制造剧情。'],
    },
    {
      code: 'SOCIAL_CAPTAIN',
      name: '气氛队长',
      shortName: '社交派',
      description: '你可能不是最懂战术的人，但你一定是最会把比赛变成局的人。',
      traits: { keywords: ['社交', '整活', '带节奏'], shareTone: '轻松好转发' },
      indices: { rational: 48, passion: 86, risk: 60, banter: 96 },
      defaultCta: { label: '喊朋友一起审判我', action: 'FRIEND_VOTE' },
      rarity: 'COMMON',
      themeColor: '#60A5FA',
      sortOrder: 40,
      subtitles: ['你负责看球，朋友负责被你喊来看球。', '没有你，群聊只是群；有了你，群聊才是看台。'],
    },
    {
      code: 'DATA_KEEPER',
      name: '数据门将',
      shortName: '数据派',
      description: '你相信样本、赔率和概率，情绪可以上头，但结论必须有依据。',
      traits: { keywords: ['数据', '谨慎', '校准'], shareTone: '冷静反差感' },
      indices: { rational: 92, passion: 50, risk: 28, banter: 44 },
      defaultCta: { label: '用数据挑战 AI', action: 'AI_PK' },
      rarity: 'RARE',
      themeColor: '#38BDF8',
      sortOrder: 50,
      subtitles: ['你不是保守，你是在等概率给你一个交代。', '别人看比分，你看置信区间。'],
    },
    {
      code: 'FLAG_BEARER',
      name: '立旗大使',
      shortName: '立旗派',
      description: '你享受把赛前判断说出来的刺激，输赢都要留下证据。',
      traits: { keywords: ['宣言', '挑战', '传播'], shareTone: '适合晒图立 Flag' },
      indices: { rational: 58, passion: 90, risk: 82, banter: 78 },
      defaultCta: { label: '生成我的赛前 Flag', action: 'AI_PK' },
      rarity: 'COMMON',
      themeColor: '#F97316',
      sortOrder: 60,
      subtitles: ['你的预测不一定全中，但一定全网可见。', '你不是嘴硬，你是在为剧情提前埋点。'],
    },
    {
      code: 'COMEBACK_POET',
      name: '逆转诗人',
      shortName: '逆转派',
      description: '你总相信补时还有故事，落后只是反转叙事的开场白。',
      traits: { keywords: ['浪漫', '逆转', '耐心'], shareTone: '热血叙事' },
      indices: { rational: 56, passion: 94, risk: 70, banter: 52 },
      defaultCta: { label: '让 AI 也信一次奇迹', action: 'AI_PK' },
      rarity: 'RARE',
      themeColor: '#A78BFA',
      sortOrder: 70,
      subtitles: ['终场哨没响，你的剧本就没写完。', '你看的是比赛，心里跑的是电影预告片。'],
    },
    {
      code: 'DERBY_FIRE',
      name: '德比火药桶',
      shortName: '对线派',
      description: '你天然适合强对抗话题，越是针锋相对，越能激发你的表达欲。',
      traits: { keywords: ['对线', '冲突', '名场面'], shareTone: '毒舌但可控' },
      indices: { rational: 52, passion: 88, risk: 76, banter: 98 },
      defaultCta: { label: '把我的观点发去对线', action: 'SHARE' },
      rarity: 'EPIC',
      themeColor: '#EF4444',
      sortOrder: 80,
      subtitles: ['你不怕打脸，你怕比赛太平淡。', '群聊沉默三分钟，你负责把火药味续上。'],
    },
    {
      code: 'VAR_JUDGE',
      name: 'VAR 审判官',
      shortName: '审判派',
      description: '你对争议判罚、尺度和细节极其敏感，天生适合做好友裁判。',
      traits: { keywords: ['规则', '审判', '细节'], shareTone: '适合好友投票' },
      indices: { rational: 86, passion: 66, risk: 38, banter: 74 },
      defaultCta: { label: '让朋友审判我的人格', action: 'FRIEND_VOTE' },
      rarity: 'RARE',
      themeColor: '#22C55E',
      sortOrder: 90,
      subtitles: ['你不是较真，你是在维护足球宇宙的秩序。', '别人吵情绪，你开始调取慢镜头。'],
    },
    {
      code: 'NOSTALGIA_ULTRA',
      name: '怀旧死忠',
      shortName: '回忆派',
      description: '你总能把一场比赛看成青春回放，老球星、老阵容和老梗都在你心里有座位。',
      traits: { keywords: ['怀旧', '死忠', '记忆'], shareTone: '情怀共鸣' },
      indices: { rational: 62, passion: 96, risk: 42, banter: 50 },
      defaultCta: { label: '晒出我的世界杯回忆人格', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#F59E0B',
      sortOrder: 100,
      subtitles: ['你的世界杯不是四年一次，是青春定期返场。', '别人追热点，你在给旧时光续杯。'],
    },
    {
      code: 'LIVE_WIRE',
      name: '实时电台',
      shortName: '解说派',
      description: '你看球时嘴比弹幕还快，任何转折都能被你加工成现场解说。',
      traits: { keywords: ['表达', '即时', '梗感'], shareTone: '高频互动' },
      indices: { rational: 50, passion: 84, risk: 58, banter: 92 },
      defaultCta: { label: '把我的解说人格发给朋友', action: 'SHARE' },
      rarity: 'COMMON',
      themeColor: '#EC4899',
      sortOrder: 110,
      subtitles: ['你不只是看比赛，你是比赛的第二声道。', '没有你，关键球少一半音量。'],
    },
    {
      code: 'LUCKY_MASCOT',
      name: '玄学吉祥物',
      shortName: '玄学派',
      description: '你相信球衣、座位、奶茶口味和开赛姿势都会影响比赛走向。',
      traits: { keywords: ['玄学', '仪式感', '好运'], shareTone: '轻松好玩' },
      indices: { rational: 34, passion: 88, risk: 72, banter: 86 },
      defaultCta: { label: '让 AI 解释不了我的玄学', action: 'AI_PK' },
      rarity: 'LEGENDARY',
      themeColor: '#C084FC',
      sortOrder: 120,
      subtitles: ['科学负责解释世界，你负责改变比分气场。', '你的仪式感不是迷信，是第十二人战术。'],
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
    await prisma.personalitySubtitle.createMany({
      data: type.subtitles.map((content, index) => ({
        personalityId: personality.id,
        content,
        scene: index === 0 ? 'RESULT_CARD' : 'SHARE_IMAGE',
        safetyLevel: 'SAFE',
        weight: index === 0 ? 2 : 1,
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

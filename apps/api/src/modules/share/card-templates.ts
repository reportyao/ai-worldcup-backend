/**
 * T6-03: 毒舌卡与复盘卡模板集合
 *
 * 提供三类分享卡模板：
 * 1. 专业预测卡（已在 share-image.renderer.ts 实现）
 * 2. 毒舌/甩锅卡（ROAST）- 幽默尖锐，提升分享率
 * 3. 复盘卡（REVIEW）- 封神榜/打脸榜，赛后传播
 *
 * 所有模板必须：
 * - 显示免责声明
 * - 文案安全（不攻击身份群体）
 * - 支持中英文
 * - 动态字号防溢出
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createCanvas } from 'canvas';

// Canvas context type alias for convenience
type Ctx2D = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RoastCardData {
  /** 主队名 */
  homeTeam: { name: string; shortName: string | null; countryCode: string | null };
  /** 客队名 */
  awayTeam: { name: string; shortName: string | null; countryCode: string | null };
  /** 开球时间 */
  kickoffAt: string;
  /** 赛事名 */
  competitionName: string;
  /** 毒舌文案（主标题） */
  roastTitle: string;
  /** 毒舌正文 */
  roastBody: string;
  /** AI 模型名称 */
  modelName: string;
  /** 模型人格标签 */
  modelPersona: string;
  /** 共识方向 */
  consensusDirection?: string | null;
  /** 邀请码 */
  inviteCode?: string | null;
  /** 语言 */
  locale?: 'zh_CN' | 'en';
}

export interface ReviewCardData {
  /** 主队名 */
  homeTeam: { name: string; shortName: string | null; countryCode: string | null };
  /** 客队名 */
  awayTeam: { name: string; shortName: string | null; countryCode: string | null };
  /** 比赛结果 */
  actualScore: { home: number; away: number };
  /** 赛事名 */
  competitionName: string;
  /** 复盘类型：GLORY（封神）或 SHAME（打脸） */
  reviewType: 'GLORY' | 'SHAME';
  /** 模型名称 */
  modelName: string;
  /** 模型人格 */
  modelPersona: string;
  /** 预测结果 */
  predictedResult: string;
  /** 命中项 */
  hitItems: string[];
  /** 错误项 */
  missItems: string[];
  /** 复盘标题 */
  reviewTitle: string;
  /** 复盘摘要 */
  reviewSummary: string;
  /** 准确率 */
  accuracy?: string | null;
  /** 邀请码 */
  inviteCode?: string | null;
  /** 语言 */
  locale?: 'zh_CN' | 'en';
}

// ─── 毒舌文案模板库 ─────────────────────────────────────────────────────────────

export const ROAST_TEMPLATES = {
  zh_CN: {
    home_win_confident: [
      '这场球要是{away}能赢，我直播倒立洗头',
      '{home}赢球比太阳从东边升起还确定',
      'AI 说了：{away}今天是来旅游的',
      '不是我说，{away}来了也是白来',
      '{home}：今天的对手？什么对手？',
    ],
    away_upset: [
      '冷门预警！{away}今天要搞事情',
      '{home}的球迷先别急着开香槟',
      'AI 闻到了爆冷的味道，{away}有戏',
      '今天可能是{home}球迷最难受的一天',
      '赔率说{home}稳？AI 说不一定哦',
    ],
    draw_likely: [
      '这场球谁赢都不奇怪，但最可能谁都赢不了',
      '菜鸡互啄预定，0-0 或 1-1 安排上',
      'AI 模型吵了半天，结论是：平',
      '两队实力接近到 AI 都选择摆烂',
      '今天的主题是：互相伤害',
    ],
    divergence: [
      'AI 们打起来了！有的看好{home}，有的看好{away}',
      '模型分歧严重，这场球连 AI 都看不懂',
      '当 AI 都无法达成共识，你就知道这场有多刺激',
      '7 个模型 7 个答案，今天注定是悬念之夜',
      'AI 内战了，{home} vs {away} 的结果比 AI 的争论还难猜',
    ],
  },
  en: {
    home_win_confident: [
      "If {away} wins this, I'll eat my keyboard",
      '{home} winning is more certain than gravity',
      "AI says: {away} is here for sightseeing",
      "Not gonna lie, {away} doesn't stand a chance",
      '{home}: Wait, there\'s an opponent today?',
    ],
    away_upset: [
      'Upset alert! {away} is about to cause chaos',
      "{home} fans, don't pop the champagne yet",
      'AI smells an upset brewing for {away}',
      "Today might be {home} fans' worst nightmare",
      'Odds say {home} is safe? AI disagrees',
    ],
    draw_likely: [
      "Nobody wins today, that's the AI consensus",
      'Stalemate incoming: 0-0 or 1-1 vibes',
      'AI models argued all day, conclusion: draw',
      'Both teams are so evenly matched, even AI gave up',
      "Today's theme: mutual destruction",
    ],
    divergence: [
      "AI models are fighting! Some back {home}, others back {away}",
      "Strong divergence - even AI can't figure this one out",
      "When AI can't agree, you know it's gonna be wild",
      '7 models, 7 answers - tonight is pure suspense',
      "AI civil war: the {home} vs {away} result is harder to predict than AI's own debate",
    ],
  },
};

// ─── 复盘标题模板 ─────────────────────────────────────────────────────────────

export const REVIEW_TEMPLATES = {
  zh_CN: {
    glory: [
      '封神！{model} 精准预测 {score}',
      '{model} 又赢了！准确率逆天',
      '预言家 {model}：说中就是中',
      '{model} 的预测比赛果还先到',
      '全中！{model} 今天是神',
    ],
    shame: [
      '打脸！{model} 这次翻车了',
      '{model} 的预测和现实差了十万八千里',
      '翻车现场：{model} 完美避开正确答案',
      '{model}：我不是针对谁，我是真的不准',
      '今天 {model} 的脸肿了',
    ],
  },
  en: {
    glory: [
      'GOAT! {model} nailed it: {score}',
      '{model} wins again! Insane accuracy',
      'Prophet {model}: Called it perfectly',
      "{model}'s prediction arrived before the result",
      'Perfect hit! {model} is divine today',
    ],
    shame: [
      'OOPS! {model} got this one wrong',
      "{model}'s prediction was in another universe",
      'Crash scene: {model} perfectly avoided the right answer',
      "{model}: I'm not targeting anyone, I'm just wrong",
      "Today {model}'s face is swollen",
    ],
  },
};

// ─── 渲染常量 ─────────────────────────────────────────────────────────────────

const CARD_W = 1080;
const CARD_H = 1350; // 4:3 比例，适合朋友圈

const PALETTE = {
  // 毒舌卡配色
  roastBg: '#1a0a2e',
  roastAccent: '#ff6b35',
  roastGlow: '#ff4081',
  // 复盘卡配色
  gloryBg: '#0a1628',
  gloryAccent: '#ffd700',
  gloryGlow: '#00e676',
  shameBg: '#1a0a0a',
  shameAccent: '#ff1744',
  shameGlow: '#ff6d00',
  // 通用
  white: '#ffffff',
  textPrimary: '#f5f5f5',
  textSecondary: '#b0bec5',
  textMuted: 'rgba(255,255,255,0.5)',
  disclaimer: 'rgba(255,255,255,0.3)',
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function roundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split('');
  const lines: string[] = [];
  let currentLine = '';

  for (const char of words) {
    const testLine = currentLine + char;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
      if (lines.length >= maxLines) {
        lines[lines.length - 1] += '...';
        return lines;
      }
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function dynamicFontSize(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
): number {
  let size = maxSize;
  while (size > minSize) {
    ctx.font = `bold ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

// ─── 毒舌卡渲染 ─────────────────────────────────────────────────────────────

export async function renderRoastCard(data: RoastCardData): Promise<Buffer> {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext('2d');

  // 背景渐变
  const bgGrad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bgGrad.addColorStop(0, PALETTE.roastBg);
  bgGrad.addColorStop(0.5, '#2d1b4e');
  bgGrad.addColorStop(1, '#1a0a2e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 装饰光晕
  ctx.save();
  ctx.globalAlpha = 0.15;
  const glowGrad = ctx.createRadialGradient(CARD_W / 2, 200, 0, CARD_W / 2, 200, 400);
  glowGrad.addColorStop(0, PALETTE.roastGlow);
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  const margin = 80;
  const contentW = CARD_W - margin * 2;

  // 顶部标签
  ctx.save();
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = PALETTE.roastAccent;
  const tagText = data.locale === 'en' ? '🔥 AI ROAST CARD' : '🔥 AI 毒舌卡';
  ctx.fillText(tagText, margin, 80);
  ctx.restore();

  // 赛事信息
  ctx.save();
  ctx.font = '26px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText(data.competitionName, margin, 130);
  ctx.restore();

  // 对阵信息
  ctx.save();
  const homeShort = data.homeTeam.shortName ?? data.homeTeam.name;
  const awayShort = data.awayTeam.shortName ?? data.awayTeam.name;
  const vsText = `${homeShort}  vs  ${awayShort}`;
  const vsSize = dynamicFontSize(ctx, vsText, contentW, 56, 36);
  ctx.font = `bold ${vsSize}px sans-serif`;
  ctx.fillStyle = PALETTE.white;
  ctx.fillText(vsText, margin, 200);
  ctx.restore();

  // 毒舌主标题
  ctx.save();
  const titleSize = dynamicFontSize(ctx, data.roastTitle, contentW, 52, 32);
  ctx.font = `bold ${titleSize}px sans-serif`;
  ctx.fillStyle = PALETTE.roastAccent;
  const titleLines = wrapText(ctx, data.roastTitle, contentW, 3);
  let titleY = 300;
  for (const line of titleLines) {
    ctx.fillText(line, margin, titleY);
    titleY += titleSize + 16;
  }
  ctx.restore();

  // 毒舌正文
  ctx.save();
  ctx.font = '32px sans-serif';
  ctx.fillStyle = PALETTE.textPrimary;
  const bodyLines = wrapText(ctx, data.roastBody, contentW, 6);
  let bodyY = titleY + 40;
  for (const line of bodyLines) {
    ctx.fillText(line, margin, bodyY);
    bodyY += 48;
  }
  ctx.restore();

  // 模型信息
  ctx.save();
  const modelY = Math.max(bodyY + 60, 700);
  roundRect(ctx, margin, modelY, contentW, 100, 20);
  ctx.fillStyle = 'rgba(255,107,53,0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,107,53,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = PALETTE.roastAccent;
  ctx.fillText(`🤖 ${data.modelName}`, margin + 24, modelY + 42);
  ctx.font = '24px sans-serif';
  ctx.fillStyle = PALETTE.textSecondary;
  ctx.fillText(data.modelPersona, margin + 24, modelY + 78);
  ctx.restore();

  // 共识方向
  if (data.consensusDirection) {
    ctx.save();
    ctx.font = '28px sans-serif';
    ctx.fillStyle = PALETTE.textSecondary;
    const consensusLabel = data.locale === 'en' ? 'AI Consensus: ' : 'AI 共识：';
    ctx.fillText(`${consensusLabel}${data.consensusDirection}`, margin, modelY + 160);
    ctx.restore();
  }

  // 邀请码
  if (data.inviteCode) {
    const invY = CARD_H - 280;
    ctx.save();
    roundRect(ctx, margin, invY, contentW, 100, 16);
    ctx.fillStyle = 'rgba(255,215,0,0.08)';
    ctx.fill();
    ctx.font = '24px sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.textAlign = 'center';
    const invLabel = data.locale === 'en' ? 'Invite Code: ' : '邀请码：';
    ctx.fillText(`${invLabel}${data.inviteCode}`, CARD_W / 2, invY + 58);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // 底部免责声明
  ctx.save();
  ctx.font = '22px sans-serif';
  ctx.fillStyle = PALETTE.disclaimer;
  ctx.textAlign = 'center';
  const disclaimer =
    data.locale === 'en'
      ? 'For entertainment only. Not betting advice.'
      : '仅用于娱乐分析与球迷讨论，不构成投注建议。';
  ctx.fillText(disclaimer, CARD_W / 2, CARD_H - 100);
  ctx.font = '24px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText('AI World Cup Predictor', CARD_W / 2, CARD_H - 60);
  ctx.textAlign = 'left';
  ctx.restore();

  return canvas.toBuffer('image/png');
}

// ─── 复盘卡渲染 ─────────────────────────────────────────────────────────────

export async function renderReviewCard(data: ReviewCardData): Promise<Buffer> {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext('2d');

  const isGlory = data.reviewType === 'GLORY';
  const bgColor = isGlory ? PALETTE.gloryBg : PALETTE.shameBg;
  const accentColor = isGlory ? PALETTE.gloryAccent : PALETTE.shameAccent;
  const glowColor = isGlory ? PALETTE.gloryGlow : PALETTE.shameGlow;

  // 背景
  const bgGrad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bgGrad.addColorStop(0, bgColor);
  bgGrad.addColorStop(1, isGlory ? '#0d2137' : '#2a0a0a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 光晕
  ctx.save();
  ctx.globalAlpha = 0.12;
  const gGrad = ctx.createRadialGradient(CARD_W / 2, 300, 0, CARD_W / 2, 300, 500);
  gGrad.addColorStop(0, glowColor);
  gGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = gGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  const margin = 80;
  const contentW = CARD_W - margin * 2;

  // 顶部标签
  ctx.save();
  ctx.font = 'bold 30px sans-serif';
  ctx.fillStyle = accentColor;
  const tagEmoji = isGlory ? '👑' : '💀';
  const tagLabel =
    data.locale === 'en'
      ? isGlory
        ? 'AI GLORY CARD'
        : 'AI SHAME CARD'
      : isGlory
        ? 'AI 封神榜'
        : 'AI 打脸榜';
  ctx.fillText(`${tagEmoji} ${tagLabel}`, margin, 80);
  ctx.restore();

  // 赛事 + 比分
  ctx.save();
  ctx.font = '26px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText(data.competitionName, margin, 130);

  const homeShort = data.homeTeam.shortName ?? data.homeTeam.name;
  const awayShort = data.awayTeam.shortName ?? data.awayTeam.name;
  const scoreText = `${homeShort} ${data.actualScore.home} - ${data.actualScore.away} ${awayShort}`;
  const scoreSize = dynamicFontSize(ctx, scoreText, contentW, 52, 34);
  ctx.font = `bold ${scoreSize}px sans-serif`;
  ctx.fillStyle = PALETTE.white;
  ctx.fillText(scoreText, margin, 200);
  ctx.restore();

  // 复盘标题
  ctx.save();
  const rtSize = dynamicFontSize(ctx, data.reviewTitle, contentW, 48, 30);
  ctx.font = `bold ${rtSize}px sans-serif`;
  ctx.fillStyle = accentColor;
  const rtLines = wrapText(ctx, data.reviewTitle, contentW, 2);
  let rtY = 290;
  for (const line of rtLines) {
    ctx.fillText(line, margin, rtY);
    rtY += rtSize + 14;
  }
  ctx.restore();

  // 模型信息
  ctx.save();
  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = PALETTE.textPrimary;
  ctx.fillText(`🤖 ${data.modelName}`, margin, rtY + 30);
  ctx.font = '24px sans-serif';
  ctx.fillStyle = PALETTE.textSecondary;
  ctx.fillText(data.modelPersona, margin + 200, rtY + 30);
  ctx.restore();

  // 命中项
  let listY = rtY + 90;
  if (data.hitItems.length > 0) {
    ctx.save();
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = isGlory ? '#00e676' : PALETTE.textSecondary;
    const hitLabel = data.locale === 'en' ? '✓ Hits:' : '✓ 命中：';
    ctx.fillText(hitLabel, margin, listY);
    listY += 40;
    ctx.font = '26px sans-serif';
    ctx.fillStyle = PALETTE.textPrimary;
    for (const item of data.hitItems.slice(0, 4)) {
      ctx.fillText(`  • ${item}`, margin, listY);
      listY += 38;
    }
    ctx.restore();
  }

  // 错误项
  if (data.missItems.length > 0) {
    listY += 20;
    ctx.save();
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#ff1744';
    const missLabel = data.locale === 'en' ? '✗ Misses:' : '✗ 翻车：';
    ctx.fillText(missLabel, margin, listY);
    listY += 40;
    ctx.font = '26px sans-serif';
    ctx.fillStyle = PALETTE.textPrimary;
    for (const item of data.missItems.slice(0, 4)) {
      ctx.fillText(`  • ${item}`, margin, listY);
      listY += 38;
    }
    ctx.restore();
  }

  // 复盘摘要
  ctx.save();
  const summaryY = Math.max(listY + 40, 800);
  ctx.font = '28px sans-serif';
  ctx.fillStyle = PALETTE.textSecondary;
  const summaryLines = wrapText(ctx, data.reviewSummary, contentW, 4);
  let sY = summaryY;
  for (const line of summaryLines) {
    ctx.fillText(line, margin, sY);
    sY += 42;
  }
  ctx.restore();

  // 准确率徽章
  if (data.accuracy) {
    ctx.save();
    const badgeY = sY + 30;
    roundRect(ctx, margin, badgeY, 240, 60, 30);
    ctx.fillStyle = `${accentColor}22`;
    ctx.fill();
    ctx.strokeStyle = `${accentColor}66`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = accentColor;
    ctx.textAlign = 'center';
    ctx.fillText(data.accuracy, margin + 120, badgeY + 40);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // 邀请码
  if (data.inviteCode) {
    const invY = CARD_H - 260;
    ctx.save();
    roundRect(ctx, margin, invY, contentW, 90, 16);
    ctx.fillStyle = 'rgba(255,215,0,0.06)';
    ctx.fill();
    ctx.font = '24px sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.textAlign = 'center';
    const invLabel = data.locale === 'en' ? 'Invite Code: ' : '邀请码：';
    ctx.fillText(`${invLabel}${data.inviteCode}`, CARD_W / 2, invY + 54);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // 底部免责声明
  ctx.save();
  ctx.font = '22px sans-serif';
  ctx.fillStyle = PALETTE.disclaimer;
  ctx.textAlign = 'center';
  const disclaimer =
    data.locale === 'en'
      ? 'For entertainment only. Not betting advice.'
      : '仅用于娱乐分析与球迷讨论，不构成投注建议。';
  ctx.fillText(disclaimer, CARD_W / 2, CARD_H - 90);
  ctx.font = '24px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText('AI World Cup Predictor', CARD_W / 2, CARD_H - 50);
  ctx.textAlign = 'left';
  ctx.restore();

  return canvas.toBuffer('image/png');
}

// ─── 文案生成工具 ─────────────────────────────────────────────────────────────

/**
 * 根据比赛数据和 AI 预测结果，选择合适的毒舌文案
 */
export function selectRoastTemplate(params: {
  consensusLevel: string | null;
  majorityResult: string | null;
  homeTeamName: string;
  awayTeamName: string;
  locale: 'zh_CN' | 'en';
}): { title: string; category: string } {
  const { consensusLevel, majorityResult, homeTeamName, awayTeamName, locale } = params;
  const templates = ROAST_TEMPLATES[locale];

  let category: keyof typeof templates;
  if (consensusLevel === 'STRONG_DIVERGENCE' || consensusLevel === 'MIXED') {
    category = 'divergence';
  } else if (majorityResult === 'HOME_WIN') {
    category = 'home_win_confident';
  } else if (majorityResult === 'AWAY_WIN') {
    category = 'away_upset';
  } else {
    category = 'draw_likely';
  }

  const pool = templates[category];
  const idx = Math.floor(Math.random() * pool.length);
  const template = pool[idx];
  const title = template
    .replace(/{home}/g, homeTeamName)
    .replace(/{away}/g, awayTeamName);

  return { title, category };
}

/**
 * 根据复盘结果选择标题
 */
export function selectReviewTemplate(params: {
  reviewType: 'GLORY' | 'SHAME';
  modelName: string;
  score?: string;
  locale: 'zh_CN' | 'en';
}): string {
  const { reviewType, modelName, score, locale } = params;
  const templates = REVIEW_TEMPLATES[locale];
  const pool = reviewType === 'GLORY' ? templates.glory : templates.shame;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]
    .replace(/{model}/g, modelName)
    .replace(/{score}/g, score ?? '');
}

// ─── 缓存 ─────────────────────────────────────────────────────────────────────

const CACHE_DIR = join(process.cwd(), '.share-cache');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function buildCardCacheKey(type: string, data: unknown): string {
  const payload = JSON.stringify(data);
  return `${type}_${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

export function readCardFromCache(key: string): Buffer | null {
  ensureCacheDir();
  const path = join(CACHE_DIR, `${key}.png`);
  if (existsSync(path)) {
    return readFileSync(path);
  }
  return null;
}

export function writeCardToCache(key: string, buffer: Buffer): void {
  ensureCacheDir();
  const path = join(CACHE_DIR, `${key}.png`);
  writeFileSync(path, buffer);
}

// ─── 内容安全过滤 ─────────────────────────────────────────────────────────────

const BANNED_TERMS_ZH = [
  '赌', '下注', '投注', '盘口', '赔率稳赚', '套利', '带单',
  '死', '杀', '废物', '垃圾', '滚', '傻逼', '操',
  '种族', '民族', '地域歧视', '政治',
];

const BANNED_TERMS_EN = [
  'bet', 'gamble', 'wager', 'odds guaranteed', 'arbitrage',
  'kill', 'die', 'trash', 'garbage', 'racist', 'political',
];

/**
 * 检查文案是否安全
 */
export function isContentSafe(text: string, locale: 'zh_CN' | 'en'): boolean {
  const terms = locale === 'zh_CN' ? BANNED_TERMS_ZH : BANNED_TERMS_EN;
  const lower = text.toLowerCase();
  return !terms.some((term) => lower.includes(term.toLowerCase()));
}

/**
 * 过滤不安全内容，替换为安全版本
 */
export function sanitizeContent(text: string, locale: 'zh_CN' | 'en'): string {
  const terms = locale === 'zh_CN' ? BANNED_TERMS_ZH : BANNED_TERMS_EN;
  let result = text;
  for (const term of terms) {
    const regex = new RegExp(term, 'gi');
    result = result.replace(regex, '***');
  }
  return result;
}

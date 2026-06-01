import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CanvasRenderingContext2D, Image } from 'canvas';
import { createCanvas, loadImage } from 'canvas';

/**
 * 预测卡渲染数据
 */
export interface PredictionCardData {
  /** 主队信息 */
  homeTeam: {
    name: string;
    shortName: string;
    countryCode: string | null;
    crestUrl: string | null;
  };
  /** 客队信息 */
  awayTeam: {
    name: string;
    shortName: string;
    countryCode: string | null;
    crestUrl: string | null;
  };
  /** 比赛时间（ISO 字符串） */
  kickoffAt: string;
  /** 赛事名称 */
  competitionName: string;
  /** 比赛阶段 */
  stage: string | null;
  /** 用户预测结果 */
  userPrediction: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
  /** 用户预测比分 */
  predictedScore: { home: number; away: number };
  /** AI 共识结果 */
  aiConsensus: string | null;
  /** AI 共识等级 */
  consensusLevel: string | null;
  /** 用户昵称 */
  userNickname: string | null;
  /** 实际比分（赛后） */
  actualScore: { home: number | null; away: number | null } | null;
  /** 邀请码（可选，用于引流） */
  inviteCode: string | null;
}

/** 卡片尺寸：1080×1920 竖版（适合微信朋友圈/微博） */
const CARD_W = 1080;
const CARD_H = 1920;

/** 调色板 */
const PALETTE = {
  bg: '#0a0e1a',
  surface: '#111827',
  surfaceAlt: '#1a2235',
  border: 'rgba(255,255,255,0.08)',
  highlight: '#f0c040',
  highlightDim: 'rgba(240,192,64,0.15)',
  homeWin: '#22c55e',
  draw: '#94a3b8',
  awayWin: '#f97316',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255,255,255,0.65)',
  textMuted: 'rgba(255,255,255,0.35)',
  gradientTop: '#0d1526',
  gradientBottom: '#060a12',
  gold: '#f0c040',
  silver: '#94a3b8',
  bronze: '#cd7f32',
};

/** 国旗 emoji 到 Unicode 区域标志的转换 */
function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return '🏳';
  const codePoints = [...code.toUpperCase()].map(
    (c) => 0x1f1e6 + c.charCodeAt(0) - 65,
  );
  return String.fromCodePoint(...codePoints);
}

/** 预测结果标签 */
function predictionLabel(
  result: string,
  homeShort: string,
  awayShort: string,
): { text: string; color: string } {
  switch (result) {
    case 'HOME_WIN':
      return { text: `${homeShort} 胜`, color: PALETTE.homeWin };
    case 'DRAW':
      return { text: '平局', color: PALETTE.draw };
    case 'AWAY_WIN':
      return { text: `${awayShort} 胜`, color: PALETTE.awayWin };
    default:
      return { text: result, color: PALETTE.textSecondary };
  }
}

/** 共识等级颜色 */
function consensusLevelColor(level: string | null): string {
  switch (level) {
    case 'STRONG':
      return PALETTE.homeWin;
    case 'MODERATE':
      return PALETTE.highlight;
    case 'WEAK':
      return PALETTE.awayWin;
    default:
      return PALETTE.textMuted;
  }
}

/** 共识等级标签 */
function consensusLevelLabel(level: string | null): string {
  switch (level) {
    case 'STRONG':
      return '强共识';
    case 'MODERATE':
      return '中等共识';
    case 'WEAK':
      return '弱共识';
    default:
      return '分析中';
  }
}

/**
 * 圆角矩形路径
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
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

/**
 * 截断文字
 */
function truncateText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

/**
 * 绘制文字（带自动截断）
 */
function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth?: number,
) {
  const t = maxWidth ? truncateText(ctx, text, maxWidth) : text;
  ctx.fillText(t, x, y);
}

/**
 * 尝试加载远程图片，失败时返回 null
 */
async function tryLoadImage(url: string | null): Promise<Image | null> {
  if (!url) return null;
  try {
    const img = await loadImage(url);
    return img;
  } catch {
    return null;
  }
}

/**
 * 主渲染函数：生成预测卡 PNG Buffer
 */
export async function renderPredictionCard(data: PredictionCardData): Promise<Buffer> {
  const canvas = createCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext('2d');

  // ─── 背景渐变 ────────────────────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bgGrad.addColorStop(0, PALETTE.gradientTop);
  bgGrad.addColorStop(1, PALETTE.gradientBottom);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ─── 顶部装饰网格线 ───────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let y = 0; y < CARD_H; y += 80) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CARD_W, y); ctx.stroke();
  }
  for (let x = 0; x < CARD_W; x += 80) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CARD_H); ctx.stroke();
  }

  // ─── 顶部光晕 ────────────────────────────────────────────────────────────────
  const glowGrad = ctx.createRadialGradient(CARD_W / 2, 0, 0, CARD_W / 2, 0, 600);
  glowGrad.addColorStop(0, 'rgba(240,192,64,0.12)');
  glowGrad.addColorStop(1, 'rgba(240,192,64,0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, CARD_W, 600);

  // ─── 品牌 Logo 区 ────────────────────────────────────────────────────────────
  const logoY = 100;
  ctx.font = 'bold 52px sans-serif';
  ctx.fillStyle = PALETTE.gold;
  ctx.textAlign = 'center';
  ctx.fillText('⚽ AI World Cup', CARD_W / 2, logoY);

  ctx.font = '32px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText('AI 预测 · 智能分析', CARD_W / 2, logoY + 52);

  // ─── 赛事信息 ────────────────────────────────────────────────────────────────
  const kickoff = new Date(data.kickoffAt);
  const kickoffStr = kickoff.toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  });

  ctx.font = '28px sans-serif';
  ctx.fillStyle = PALETTE.textSecondary;
  ctx.textAlign = 'center';
  const compText = data.stage
    ? `${data.competitionName} · ${data.stage}`
    : data.competitionName;
  ctx.fillText(compText, CARD_W / 2, logoY + 110);
  ctx.fillText(kickoffStr, CARD_W / 2, logoY + 148);

  // ─── 主卡片容器 ──────────────────────────────────────────────────────────────
  const cardX = 60;
  const cardY = 340;
  const cardW = CARD_W - 120;
  const cardH = 580;

  // 卡片背景
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fillStyle = PALETTE.surface;
  ctx.fill();
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // 卡片顶部高亮线
  ctx.save();
  const topLineGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  topLineGrad.addColorStop(0, 'rgba(240,192,64,0)');
  topLineGrad.addColorStop(0.5, PALETTE.gold);
  topLineGrad.addColorStop(1, 'rgba(240,192,64,0)');
  ctx.strokeStyle = topLineGrad;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cardX + 40, cardY);
  ctx.lineTo(cardX + cardW - 40, cardY);
  ctx.stroke();
  ctx.restore();

  // ─── 球队对阵 ────────────────────────────────────────────────────────────────
  const teamY = cardY + 80;
  const teamAreaW = cardW / 2 - 80;
  const homeX = cardX + 60;
  const awayX = cardX + cardW - 60;
  const centerX = cardX + cardW / 2;

  // 加载队徽
  const [homeCrest, awayCrest] = await Promise.all([
    tryLoadImage(data.homeTeam.crestUrl),
    tryLoadImage(data.awayTeam.crestUrl),
  ]);

  // 主队区域
  ctx.save();
  ctx.textAlign = 'left';

  // 主队队徽
  const crestSize = 120;
  if (homeCrest) {
    ctx.save();
    roundRect(ctx, homeX, teamY, crestSize, crestSize, 16);
    ctx.clip();
    ctx.drawImage(homeCrest, homeX, teamY, crestSize, crestSize);
    ctx.restore();
  } else {
    // 无队徽时显示国旗 emoji
    ctx.font = '80px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(
      countryCodeToFlag(data.homeTeam.countryCode ?? ''),
      homeX + 20,
      teamY + 90,
    );
  }

  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = PALETTE.textPrimary;
  ctx.textAlign = 'left';
  drawText(ctx, data.homeTeam.shortName || data.homeTeam.name, homeX, teamY + 170, teamAreaW);

  ctx.font = '28px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  drawText(ctx, data.homeTeam.name, homeX, teamY + 210, teamAreaW);
  ctx.restore();

  // 客队区域（右对齐）
  ctx.save();
  ctx.textAlign = 'right';

  if (awayCrest) {
    ctx.save();
    roundRect(ctx, awayX - crestSize, teamY, crestSize, crestSize, 16);
    ctx.clip();
    ctx.drawImage(awayCrest, awayX - crestSize, teamY, crestSize, crestSize);
    ctx.restore();
  } else {
    ctx.font = '80px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(
      countryCodeToFlag(data.awayTeam.countryCode ?? ''),
      awayX - 20,
      teamY + 90,
    );
  }

  ctx.font = 'bold 44px sans-serif';
  ctx.fillStyle = PALETTE.textPrimary;
  ctx.textAlign = 'right';
  drawText(ctx, data.awayTeam.shortName || data.awayTeam.name, awayX, teamY + 170, teamAreaW);

  ctx.font = '28px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  drawText(ctx, data.awayTeam.name, awayX, teamY + 210, teamAreaW);
  ctx.restore();

  // VS 或实际比分
  ctx.save();
  ctx.textAlign = 'center';
  if (data.actualScore && data.actualScore.home !== null && data.actualScore.away !== null) {
    ctx.font = 'bold 72px sans-serif';
    ctx.fillStyle = PALETTE.textPrimary;
    ctx.fillText(`${data.actualScore.home} - ${data.actualScore.away}`, centerX, teamY + 100);
    ctx.font = '26px sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText('最终比分', centerX, teamY + 140);
  } else {
    ctx.font = 'bold 56px sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText('VS', centerX, teamY + 90);
  }
  ctx.restore();

  // ─── 分割线 ──────────────────────────────────────────────────────────────────
  const divY = cardY + 260;
  ctx.save();
  ctx.strokeStyle = PALETTE.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + 40, divY);
  ctx.lineTo(cardX + cardW - 40, divY);
  ctx.stroke();
  ctx.restore();

  // ─── 用户预测结果 ─────────────────────────────────────────────────────────────
  const predY = divY + 60;
  const pred = predictionLabel(
    data.userPrediction,
    data.homeTeam.shortName || data.homeTeam.name,
    data.awayTeam.shortName || data.awayTeam.name,
  );

  ctx.save();
  ctx.textAlign = 'center';

  // 预测标签背景
  const predBadgeW = 280;
  const predBadgeH = 64;
  const predBadgeX = centerX - predBadgeW / 2;
  const predBadgeY = predY - predBadgeH + 10;
  ctx.fillStyle = `${pred.color}22`;
  roundRect(ctx, predBadgeX, predBadgeY, predBadgeW, predBadgeH, 32);
  ctx.fill();
  ctx.strokeStyle = `${pred.color}66`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = 'bold 36px sans-serif';
  ctx.fillStyle = pred.color;
  ctx.fillText(`我预测：${pred.text}`, centerX, predY);

  // 预测比分
  ctx.font = 'bold 52px sans-serif';
  ctx.fillStyle = PALETTE.textPrimary;
  ctx.fillText(
    `${data.predictedScore.home} - ${data.predictedScore.away}`,
    centerX,
    predY + 70,
  );

  ctx.font = '26px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText('预测比分', centerX, predY + 108);
  ctx.restore();

  // ─── AI 共识区 ────────────────────────────────────────────────────────────────
  const aiY = cardY + cardH - 140;

  ctx.save();
  // AI 共识背景
  roundRect(ctx, cardX + 40, aiY - 20, cardW - 80, 120, 20);
  ctx.fillStyle = PALETTE.surfaceAlt;
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.font = '26px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText('🤖 AI 共识', cardX + 70, aiY + 22);

  if (data.aiConsensus) {
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = consensusLevelColor(data.consensusLevel);
    drawText(ctx, data.aiConsensus, cardX + 70, aiY + 66, cardW - 200);
  } else {
    ctx.font = '28px sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText('分析生成中...', cardX + 70, aiY + 66);
  }

  // 共识等级徽章
  if (data.consensusLevel) {
    const badgeText = consensusLevelLabel(data.consensusLevel);
    const badgeColor = consensusLevelColor(data.consensusLevel);
    ctx.font = 'bold 22px sans-serif';
    const badgeW = ctx.measureText(badgeText).width + 24;
    ctx.fillStyle = `${badgeColor}22`;
    roundRect(ctx, cardX + cardW - 60 - badgeW, aiY + 46, badgeW, 34, 17);
    ctx.fill();
    ctx.fillStyle = badgeColor;
    ctx.textAlign = 'right';
    ctx.fillText(badgeText, cardX + cardW - 60 - 12, aiY + 70);
  }
  ctx.restore();

  // ─── 用户信息区 ──────────────────────────────────────────────────────────────
  const userY = cardY + cardH + 60;

  ctx.save();
  ctx.textAlign = 'center';

  if (data.userNickname) {
    ctx.font = '30px sans-serif';
    ctx.fillStyle = PALETTE.textSecondary;
    ctx.fillText(`${data.userNickname} 的预测`, CARD_W / 2, userY);
  }

  // ─── 邀请码区 ────────────────────────────────────────────────────────────────
  if (data.inviteCode) {
    const invY = userY + 80;

    // 邀请码卡片
    roundRect(ctx, cardX, invY, cardW, 160, 24);
    const invGrad = ctx.createLinearGradient(cardX, invY, cardX + cardW, invY);
    invGrad.addColorStop(0, 'rgba(240,192,64,0.12)');
    invGrad.addColorStop(1, 'rgba(240,192,64,0.04)');
    ctx.fillStyle = invGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,192,64,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = '28px sans-serif';
    ctx.fillStyle = PALETTE.textSecondary;
    ctx.textAlign = 'center';
    ctx.fillText('扫码或使用邀请码加入，每日免费看 3 次 AI 分析', CARD_W / 2, invY + 48);

    ctx.font = 'bold 52px sans-serif';
    ctx.fillStyle = PALETTE.gold;
    // 字间距通过手动间隔模拟
    const codeChars = data.inviteCode.split('');
    const charW = 52;
    const totalW = codeChars.length * charW;
    let cx = CARD_W / 2 - totalW / 2 + charW / 2;
    for (const ch of codeChars) {
      ctx.fillText(ch, cx, invY + 112);
      cx += charW;
    }
  }
  ctx.restore();

  // ─── 底部品牌信息 ─────────────────────────────────────────────────────────────
  const footerY = CARD_H - 120;

  ctx.save();
  // 底部分割线
  const footerLineGrad = ctx.createLinearGradient(60, 0, CARD_W - 60, 0);
  footerLineGrad.addColorStop(0, 'rgba(255,255,255,0)');
  footerLineGrad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  footerLineGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = footerLineGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, footerY - 20);
  ctx.lineTo(CARD_W - 60, footerY - 20);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = '28px sans-serif';
  ctx.fillStyle = PALETTE.textMuted;
  ctx.fillText('AI World Cup · 多模型预测 · 智能分析', CARD_W / 2, footerY + 20);

  ctx.font = '24px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillText('数据仅供参考，理性看球', CARD_W / 2, footerY + 56);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

/**
 * 缓存目录
 */
const CACHE_DIR = join(process.cwd(), '.share-cache');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * 生成缓存 key
 */
export function buildCacheKey(data: PredictionCardData): string {
  const payload = JSON.stringify({
    home: data.homeTeam.name,
    away: data.awayTeam.name,
    kickoff: data.kickoffAt,
    prediction: data.userPrediction,
    score: data.predictedScore,
    actual: data.actualScore,
    invite: data.inviteCode,
    nick: data.userNickname,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * 从缓存读取图片
 */
export function readFromCache(key: string): Buffer | null {
  ensureCacheDir();
  const path = join(CACHE_DIR, `${key}.png`);
  if (existsSync(path)) {
    return readFileSync(path);
  }
  return null;
}

/**
 * 写入缓存
 */
export function writeToCache(key: string, buffer: Buffer): void {
  ensureCacheDir();
  const path = join(CACHE_DIR, `${key}.png`);
  writeFileSync(path, buffer);
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { AiPkPick, AiPkSettlementStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

import type { AiPkCreateSessionDto } from './ai-pk.schemas.js';

type PickedSide = 'HOME' | 'DRAW' | 'AWAY';
type PersonaCode = 'BALANCED' | 'TACTICIAN' | 'HYPE_FAN' | 'DATA_ANALYST' | 'ROASTER';

interface ExtractedPrediction {
  side: PickedSide;
  confidence: number;
  reason: string;
  modelName: string;
}

const PERSONA_LABELS: Record<PersonaCode, string> = {
  BALANCED: '均衡分析官',
  TACTICIAN: '战术拆解官',
  HYPE_FAN: '热血球迷',
  DATA_ANALYST: '数据派分析师',
  ROASTER: '犀利吐槽官',
};

@Injectable()
export class AiPkService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(dto: AiPkCreateSessionDto, viewer: { userId?: string; guestId?: string }) {
    const match = await this.prisma.match.findUnique({
      where: { id: dto.matchId },
      include: {
        competition: true,
        homeTeam: true,
        awayTeam: true,
        predictionTasks: {
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          include: {
            predictions: {
              where: { isSuccess: true },
              include: { aiModel: true },
              orderBy: { generatedAt: 'desc' },
            },
          },
        },
      },
    });

    if (!match) throw new NotFoundException('比赛不存在');

    const task = match.predictionTasks[0];
    const predictions = task?.predictions.map((prediction) => this.extractPrediction(
      prediction.structuredOutput,
      prediction.aiModel.displayName,
    )) ?? [];

    const aiSide = this.resolveAiSide(predictions);
    const resultJson = this.buildPkResult({
      pickedSide: dto.pickedSide,
      aiSide,
      personaCode: dto.personaCode,
      predictions,
      matchLabel: `${match.homeTeam.shortName ?? match.homeTeam.name} vs ${match.awayTeam.shortName ?? match.awayTeam.name}`,
      homeName: match.homeTeam.shortName ?? match.homeTeam.name,
      awayName: match.awayTeam.shortName ?? match.awayTeam.name,
      consensusSummary: task?.consensusSummary ?? null,
    });

    const where = viewer.userId
      ? { matchId: match.id, userId: viewer.userId }
      : viewer.guestId
        ? { matchId: match.id, guestId: viewer.guestId }
        : undefined;

    const existing = where ? await this.prisma.aiPkRecord.findFirst({ where }) : null;
    const data = {
      matchId: match.id,
      userId: viewer.userId,
      guestId: viewer.userId ? undefined : viewer.guestId,
      userPick: this.toAiPkPick(dto.pickedSide),
      aiPick: this.toAiPkPick(aiSide),
      aiConfidence: this.averageConfidence(predictions),
      predictionTaskId: task?.id,
      aiSummarySnapshot: resultJson as Prisma.InputJsonValue,
      reasonText: resultJson.verdict,
      reasonTemplateCode: dto.personaCode,
      settlementStatus: AiPkSettlementStatus.PENDING,
      ipAddress: undefined,
      userAgent: undefined,
    };

    const record = existing
      ? await this.prisma.aiPkRecord.update({ where: { id: existing.id }, data })
      : await this.prisma.aiPkRecord.create({ data });

    return this.toSessionPayload(record, {
      competitionName: match.competition.name,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoffAt: match.kickoffAt.toISOString(),
    });
  }

  async getSession(id: string) {
    const record = await this.prisma.aiPkRecord.findUnique({
      where: { id },
      include: {
        match: {
          include: { competition: true, homeTeam: true, awayTeam: true },
        },
      },
    });
    if (!record) throw new NotFoundException('AI PK 会话不存在');
    return this.toSessionPayload(record, {
      competitionName: record.match.competition.name,
      homeTeam: record.match.homeTeam.name,
      awayTeam: record.match.awayTeam.name,
      kickoffAt: record.match.kickoffAt.toISOString(),
    });
  }

  async getMine(viewer: { userId?: string; guestId?: string }, take = 20) {
    if (!viewer.userId && !viewer.guestId) {
      return [];
    }

    const records = await this.prisma.aiPkRecord.findMany({
      where: viewer.userId ? { userId: viewer.userId } : { guestId: viewer.guestId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 50),
      include: {
        match: {
          include: { competition: true, homeTeam: true, awayTeam: true },
        },
      },
    });

    return records.map((record) => this.toSessionPayload(record, {
      competitionName: record.match.competition.name,
      homeTeam: record.match.homeTeam.name,
      awayTeam: record.match.awayTeam.name,
      kickoffAt: record.match.kickoffAt.toISOString(),
    }));
  }

  private extractPrediction(value: Prisma.JsonValue, modelName: string): ExtractedPrediction {
    const object = this.asObject(value);
    const side = this.normalizeSide(
      object.prediction ?? object.winner ?? object.winnerSide ?? object.pick ?? object.result,
    );
    const confidence = this.toConfidence(object.confidence ?? object.probability ?? object.winProbability);
    const reason = this.firstText(
      object.reason,
      object.summary,
      object.analysis,
      object.keyReason,
      '模型认为双方存在可 PK 的核心分歧。',
    );
    return { side, confidence, reason, modelName };
  }

  private resolveAiSide(predictions: ExtractedPrediction[]): PickedSide {
    if (predictions.length === 0) return 'DRAW';
    const weighted = predictions.reduce<Record<PickedSide, number>>(
      (acc, prediction) => {
        acc[prediction.side] += prediction.confidence;
        return acc;
      },
      { HOME: 0, DRAW: 0, AWAY: 0 },
    );
    return Object.entries(weighted).sort((a, b) => b[1] - a[1])[0]?.[0] as PickedSide;
  }

  private buildPkResult(params: {
    pickedSide: PickedSide;
    aiSide: PickedSide;
    personaCode: PersonaCode;
    predictions: ExtractedPrediction[];
    matchLabel: string;
    homeName: string;
    awayName: string;
    consensusSummary: Prisma.JsonValue | null;
  }) {
    const userLabel = this.sideLabel(params.pickedSide, params.homeName, params.awayName);
    const aiLabel = this.sideLabel(params.aiSide, params.homeName, params.awayName);
    const agreement = params.pickedSide === params.aiSide;
    const personaLabel = PERSONA_LABELS[params.personaCode];
    const confidenceAvg = this.averageConfidence(params.predictions) ?? 50;

    const userScore = agreement ? Math.min(95, confidenceAvg + 8) : Math.max(45, 100 - confidenceAvg + 10);
    const aiScore = 100 - userScore;
    const topReasons = params.predictions.slice(0, 3).map((prediction) => ({
      modelName: prediction.modelName,
      side: prediction.side,
      confidence: prediction.confidence,
      reason: prediction.reason,
    }));

    return {
      matchLabel: params.matchLabel,
      personaCode: params.personaCode,
      personaLabel,
      userPick: params.pickedSide,
      userPickLabel: userLabel,
      aiPick: params.aiSide,
      aiPickLabel: aiLabel,
      agreement,
      headline: agreement
        ? `${personaLabel}判定：你和 AI 都站 ${userLabel}`
        : `${personaLabel}发起反驳：你站 ${userLabel}，AI 更看好 ${aiLabel}`,
      verdict: agreement
        ? '你的判断与当前 AI 共识同向，适合分享为“稳健同盟”观点。'
        : '你的判断正在挑战 AI 共识，适合分享为“人类直觉 PK 机器共识”观点。',
      scoreBoard: {
        userScore,
        aiScore,
        confidenceAvg,
      },
      arguments: this.buildArguments(params.personaCode, agreement, userLabel, aiLabel),
      modelReasons: topReasons,
      consensusSummary: params.consensusSummary,
    };
  }

  private buildArguments(personaCode: PersonaCode, agreement: boolean, userLabel: string, aiLabel: string): string[] {
    if (agreement) {
      return [
        `${userLabel} 得到人类直觉与 AI 信号的双重支持。`,
        '分享时可以突出“我们不是盲猜，而是和模型站在同一边”。',
      ];
    }

    if (personaCode === 'ROASTER') {
      return [
        `AI 站 ${aiLabel}，但足球从来不是电子表格。`,
        `${userLabel} 的爆点在于反共识，一旦打出就是朋友圈名场面。`,
      ];
    }

    if (personaCode === 'DATA_ANALYST') {
      return [
        `AI 侧重 ${aiLabel} 的概率优势。`,
        `${userLabel} 需要用临场阵容、节奏或定位球变量来完成反击。`,
      ];
    }

    return [
      `AI 更看好 ${aiLabel}，但你的选择 ${userLabel} 形成了清晰对抗。`,
      '这类分歧最适合做轻分享：观点明确、互动门槛低、容易引发好友站队。',
    ];
  }

  private normalizeSide(value: unknown): PickedSide {
    const text = String(value ?? '').toUpperCase();
    if (['HOME', 'HOME_WIN', 'HOST', 'H'].includes(text)) return 'HOME';
    if (['AWAY', 'AWAY_WIN', 'GUEST', 'A'].includes(text)) return 'AWAY';
    if (['DRAW', 'TIE', 'D'].includes(text)) return 'DRAW';
    if (text.includes('HOME')) return 'HOME';
    if (text.includes('AWAY')) return 'AWAY';
    if (text.includes('DRAW')) return 'DRAW';
    return 'DRAW';
  }

  private sideLabel(side: PickedSide, homeName: string, awayName: string): string {
    if (side === 'HOME') return homeName;
    if (side === 'AWAY') return awayName;
    return '平局';
  }

  private toAiPkPick(side: PickedSide): AiPkPick {
    if (side === 'HOME') return AiPkPick.HOME_WIN;
    if (side === 'AWAY') return AiPkPick.AWAY_WIN;
    return AiPkPick.DRAW;
  }

  private fromAiPkPick(side: AiPkPick): PickedSide {
    if (side === AiPkPick.HOME_WIN) return 'HOME';
    if (side === AiPkPick.AWAY_WIN) return 'AWAY';
    return 'DRAW';
  }

  private asObject(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private toConfidence(value: unknown): number {
    const raw = Number(value ?? 60);
    if (!Number.isFinite(raw)) return 60;
    const normalized = raw <= 1 ? raw * 100 : raw;
    return Math.min(95, Math.max(5, Math.round(normalized)));
  }

  private averageConfidence(predictions: ExtractedPrediction[]): number | null {
    return predictions.length > 0
      ? Math.round(predictions.reduce((sum, item) => sum + item.confidence, 0) / predictions.length)
      : null;
  }

  private firstText(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '模型观点暂未给出详细理由。';
  }

  private toSessionPayload(record: {
    id: string;
    matchId: string;
    userPick: AiPkPick;
    aiPick: AiPkPick;
    aiSummarySnapshot: Prisma.JsonValue | null;
    reasonTemplateCode: string | null;
    settlementStatus: AiPkSettlementStatus;
    createdAt: Date;
    updatedAt: Date;
  }, match: { competitionName: string; homeTeam: string; awayTeam: string; kickoffAt: string }) {
    const baseUrl = process.env.H5_BASE_URL ?? 'https://h5.example.com';
    const userPick = this.fromAiPkPick(record.userPick);
    const aiPick = this.fromAiPkPick(record.aiPick);
    const result = this.asObject(record.aiSummarySnapshot);
    return {
      id: record.id,
      matchId: record.matchId,
      match,
      pickedSide: userPick,
      aiPick,
      personaCode: record.reasonTemplateCode ?? 'BALANCED',
      status: record.settlementStatus,
      result,
      shareImageUrl: null,
      shareUrl: `${baseUrl}/share/ai-pk/${record.id}`,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

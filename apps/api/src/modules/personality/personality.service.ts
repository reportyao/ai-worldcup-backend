import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

import type { PersonalityQuestionUpsertDto, PersonalitySubmitDto } from './personality.schemas.js';

type PersonalityCode = string;

export interface PersonalityOption {
  id: string;
  label: string;
  description?: string;
  weights: Record<PersonalityCode, number>;
}

export interface PersonalityQuestionPayload {
  id: string;
  activityKey: string;
  sortOrder: number;
  question: string;
  description?: string | null;
  options: PersonalityOption[];
  isActive: boolean;
}

const DEFAULT_ACTIVITY_KEY = 'worldcup-personality-v1';
const LEGACY_ACTIVITY_KEY = 'worldcup_personality_2026';

@Injectable()
export class PersonalityService {
  constructor(private readonly prisma: PrismaService) {}

  async getQuestions(activityKey = DEFAULT_ACTIVITY_KEY): Promise<PersonalityQuestionPayload[]> {
    const activity = await this.getActivity(activityKey);
    if (!activity) return [];

    const questions = await this.prisma.personalityQuestion.findMany({
      where: { activityId: activity.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    return questions.map((question) => this.toQuestionPayload(question, activity.code));
  }

  async listAdminQuestions(activityKey = DEFAULT_ACTIVITY_KEY): Promise<PersonalityQuestionPayload[]> {
    const activity = await this.getActivity(activityKey);
    if (!activity) return [];

    const questions = await this.prisma.personalityQuestion.findMany({
      where: { activityId: activity.id },
      orderBy: { sortOrder: 'asc' },
    });

    return questions.map((question) => this.toQuestionPayload(question, activity.code));
  }

  async upsertQuestion(dto: PersonalityQuestionUpsertDto) {
    const activity = await this.getActivityOrThrow(dto.activityKey);
    const existing = await this.prisma.personalityQuestion.findFirst({
      where: { activityId: activity.id, sortOrder: dto.sortOrder },
    });
    const options = dto.options.map((option) => ({
      key: option.id,
      label: option.label,
      description: option.description,
      weights: option.weights,
    }));

    const saved = existing
      ? await this.prisma.personalityQuestion.update({
        where: { id: existing.id },
        data: {
          title: dto.question,
          subtitle: dto.description,
          options: options as Prisma.InputJsonValue,
          isActive: dto.isActive,
        },
      })
      : await this.prisma.personalityQuestion.create({
        data: {
          activityId: activity.id,
          code: `admin_${dto.sortOrder}`,
          title: dto.question,
          subtitle: dto.description,
          options: options as Prisma.InputJsonValue,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
        },
      });

    return {
      ...this.toQuestionPayload(saved, activity.code),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async submit(dto: PersonalitySubmitDto, viewer: { userId?: string; guestId?: string }) {
    const activity = await this.getActivityOrThrow(dto.activityKey);
    const questions = await this.prisma.personalityQuestion.findMany({
      where: { activityId: activity.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (questions.length === 0) {
      throw new BadRequestException('人格测试题目尚未配置');
    }

    const answerMap = new Map(dto.answers.map((answer) => [answer.questionId, answer.optionId]));
    const scores: Record<string, number> = {};
    const normalizedAnswers: Array<{ questionId: string; questionCode: string; optionId: string; optionLabel: string }> = [];

    for (const question of questions) {
      const optionId = answerMap.get(question.id) ?? answerMap.get(question.code);
      if (!optionId) continue;
      const option = this.normalizeOptions(question.options).find((item) => item.id === optionId);
      if (!option) {
        throw new BadRequestException(`题目 ${question.id} 的选项 ${optionId} 不存在`);
      }
      normalizedAnswers.push({
        questionId: question.id,
        questionCode: question.code,
        optionId,
        optionLabel: option.label,
      });
      for (const [key, value] of Object.entries(option.weights)) {
        scores[key] = (scores[key] ?? 0) + Number(value ?? 0);
      }
    }

    if (normalizedAnswers.length === 0) {
      throw new BadRequestException('请至少提交一项有效答案');
    }

    const personalityCode = this.pickPersonalityCode(scores);
    const personality = await this.prisma.personalityType.findUnique({
      where: { activityId_code: { activityId: activity.id, code: personalityCode } },
      include: {
        subtitles: {
          where: { isActive: true },
          orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
          take: 1,
        },
      },
    });

    if (!personality) {
      throw new BadRequestException('人格类型配置不完整，请先初始化活动配置');
    }

    const [sameCount, totalCount] = await Promise.all([
      this.prisma.personalityTestResult.count({ where: { activityId: activity.id, personalityId: personality.id } }),
      this.prisma.personalityTestResult.count({ where: { activityId: activity.id } }),
    ]);

    const resultSummary = this.buildResultSummary(personality, personality.subtitles[0]?.content);
    const result = await this.prisma.personalityTestResult.create({
      data: {
        userId: viewer.userId,
        guestId: viewer.userId ? undefined : viewer.guestId,
        activityId: activity.id,
        activityVersion: activity.configVersion,
        personalityId: personality.id,
        answers: normalizedAnswers as Prisma.InputJsonValue,
        scoreBreakdown: scores as Prisma.InputJsonValue,
        selectedSubtitleId: personality.subtitles[0]?.id,
        selectedSkin: 'CLASSIC_DARK',
        sameCountSnapshot: sameCount + 1,
        totalCountSnapshot: totalCount + 1,
        rarityLabelSnapshot: personality.rarity,
        resultSummary: resultSummary as Prisma.InputJsonValue,
      },
      include: {
        activity: true,
        personality: true,
      },
    });

    return this.toResultPayload(result);
  }

  async getResult(id: string) {
    const result = await this.prisma.personalityTestResult.findUnique({
      where: { id },
      include: { activity: true, personality: true },
    });
    if (!result) throw new NotFoundException('人格测试结果不存在');
    return this.toResultPayload(result);
  }

  async getMine(viewer: { userId?: string; guestId?: string }) {
    if (!viewer.userId && !viewer.guestId) return null;
    const result = await this.prisma.personalityTestResult.findFirst({
      where: viewer.userId ? { userId: viewer.userId } : { guestId: viewer.guestId },
      orderBy: { createdAt: 'desc' },
      include: { activity: true, personality: true },
    });
    return result ? this.toResultPayload(result) : null;
  }

  async getArchetypes() {
    const activity = await this.getActivity(DEFAULT_ACTIVITY_KEY);
    if (!activity) return [];
    const types = await this.prisma.personalityType.findMany({
      where: { activityId: activity.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return types.map((type) => ({
      archetype: type.code,
      title: type.name,
      summary: type.description,
      strengths: this.extractKeywords(type.traits),
      recommendedTeams: [],
      shortName: type.shortName,
      rarity: type.rarity,
      themeColor: type.themeColor,
      defaultCta: type.defaultCta,
    }));
  }

  private async getActivity(activityKey: string) {
    const code = this.normalizeActivityKey(activityKey);
    return this.prisma.personalityActivity.findUnique({ where: { code } });
  }

  private async getActivityOrThrow(activityKey: string) {
    const activity = await this.getActivity(activityKey);
    if (!activity) throw new BadRequestException('人格测试活动尚未初始化');
    return activity;
  }

  private normalizeActivityKey(activityKey: string): string {
    return activityKey === LEGACY_ACTIVITY_KEY ? DEFAULT_ACTIVITY_KEY : activityKey;
  }

  private toQuestionPayload(question: {
    id: string;
    sortOrder: number;
    title: string;
    subtitle: string | null;
    options: Prisma.JsonValue;
    isActive: boolean;
  }, activityKey: string): PersonalityQuestionPayload {
    return {
      id: question.id,
      activityKey,
      sortOrder: question.sortOrder,
      question: question.title,
      description: question.subtitle,
      options: this.normalizeOptions(question.options),
      isActive: question.isActive,
    };
  }

  private normalizeOptions(value: Prisma.JsonValue): PersonalityOption[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((rawItem) => this.toRecord(rawItem))
      .filter((item): item is Record<string, unknown> => item !== null)
      .map((item) => ({
        id: String(item.id ?? item.key ?? ''),
        label: String(item.label ?? ''),
        description: typeof item.description === 'string' ? item.description : undefined,
        weights: this.normalizeWeights(item.weights),
      }))
      .filter((item) => item.id && item.label);
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private normalizeWeights(value: unknown): Record<PersonalityCode, number> {
    if (!value || typeof value !== 'object') return {};
    const weights: Record<PersonalityCode, number> = {};
    for (const [key, score] of Object.entries(value)) {
      const numeric = Number(score ?? 0);
      if (key && Number.isFinite(numeric)) weights[key] = numeric;
    }
    return weights;
  }

  private pickPersonalityCode(scores: Record<string, number>): string {
    const entries = Object.entries(scores);
    if (entries.length === 0) return 'SOCIAL_CAPTAIN';
    return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'SOCIAL_CAPTAIN';
  }

  private buildResultSummary(personality: {
    code: string;
    name: string;
    shortName: string | null;
    description: string;
    traits: Prisma.JsonValue;
    indices: Prisma.JsonValue;
    defaultCta: Prisma.JsonValue;
    rarity: string | null;
    themeColor: string | null;
  }, subtitle?: string) {
    return {
      code: personality.code,
      title: personality.name,
      shortName: personality.shortName,
      summary: personality.description,
      subtitle,
      strengths: this.extractKeywords(personality.traits),
      profile: this.extractProfile(personality.traits),
      indices: personality.indices,
      defaultCta: personality.defaultCta,
      rarity: personality.rarity,
      themeColor: personality.themeColor,
    };
  }

  private extractKeywords(value: Prisma.JsonValue): string[] {
    const object = this.toRecord(value);
    const keywords = object?.keywords;
    return Array.isArray(keywords) ? keywords.map((item) => String(item)).filter(Boolean) : [];
  }

  private extractProfile(value: Prisma.JsonValue): Record<string, string> {
    const object = this.toRecord(value);
    if (!object) return {};
    const keys = ['shareTone', 'personaBio', 'truthHit', 'blindSpot', 'socialLine', 'shareLine'];
    return keys.reduce<Record<string, string>>((profile, key) => {
      const item = object[key];
      if (typeof item === 'string' && item.trim()) profile[key] = item;
      return profile;
    }, {});
  }

  private toResultPayload(result: {
    id: string;
    answers: Prisma.JsonValue;
    scoreBreakdown: Prisma.JsonValue;
    resultSummary: Prisma.JsonValue;
    sameCountSnapshot: number;
    totalCountSnapshot: number;
    rarityLabelSnapshot: string | null;
    selectedSkin: string;
    createdAt: Date;
    activity: { code: string };
    personality: {
      code: string;
      name: string;
      description: string;
      traits: Prisma.JsonValue;
      defaultCta: Prisma.JsonValue;
      themeColor: string | null;
    };
  }) {
    const baseUrl = process.env.H5_BASE_URL ?? 'https://h5.example.com';
    const summary = this.toRecord(result.resultSummary) ?? {};
    const strengths = Array.isArray(summary.strengths) ? summary.strengths : this.extractKeywords(result.personality.traits);
    const profile = this.toRecord(summary.profile) ?? this.extractProfile(result.personality.traits);
    return {
      id: result.id,
      activityKey: result.activity.code,
      archetype: result.personality.code,
      title: typeof summary.title === 'string' ? summary.title : result.personality.name,
      shortName: typeof summary.shortName === 'string' ? summary.shortName : undefined,
      summary: typeof summary.summary === 'string' ? summary.summary : result.personality.description,
      subtitle: typeof summary.subtitle === 'string' ? summary.subtitle : undefined,
      strengths,
      profile,
      recommendedTeams: [],
      scores: result.scoreBreakdown,
      answers: result.answers,
      shareImageUrl: null,
      shareUrl: `${baseUrl}/share/personality/${result.id}`,
      sameCount: result.sameCountSnapshot,
      totalCount: result.totalCountSnapshot,
      rarity: result.rarityLabelSnapshot,
      selectedSkin: result.selectedSkin,
      defaultCta: this.toRecord(summary.defaultCta) ?? result.personality.defaultCta,
      themeColor: typeof summary.themeColor === 'string' ? summary.themeColor : result.personality.themeColor,
      indices: this.toRecord(summary.indices),
      createdAt: result.createdAt.toISOString(),
    };
  }
}

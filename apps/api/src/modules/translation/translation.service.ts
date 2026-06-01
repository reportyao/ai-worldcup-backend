import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

import type { PrismaService } from '../../prisma/prisma.service.js';

/**
 * T6-05: AI 内容翻译服务
 *
 * 职责：
 * 1. 将中文结构化预测内容翻译为英文
 * 2. 支持批量翻译任务
 * 3. 翻译结果结构化保存
 * 4. 支持人工审核和修正
 * 5. 翻译失败时回退到原语言
 *
 * 翻译策略：
 * - 使用 AI 模型进行结构化翻译
 * - 保持 JSON 结构不变，只翻译文本值
 * - 保留专有名词（球队名、模型名等）
 * - 翻译后自动发布，后台可修改
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 创建翻译任务
   */
  async createTranslationJob(params: {
    sourceType: string;
    sourceId: string;
    locale: string;
    priority?: number;
  }): Promise<{ id: string; status: string }> {
    const { sourceType, sourceId, locale } = params;

    // 检查是否已存在
    const existing = await this.prisma.contentTranslation.findUnique({
      where: {
        sourceType_sourceId_locale: { sourceType, sourceId, locale },
      },
    });

    if (existing && existing.status === 'COMPLETED') {
      return { id: existing.id, status: 'ALREADY_COMPLETED' };
    }

    if (existing) {
      // 重新触发翻译
      await this.prisma.contentTranslation.update({
        where: { id: existing.id },
        data: { status: 'PENDING', errorMessage: null },
      });
      return { id: existing.id, status: 'RETRYING' };
    }

    const translation = await this.prisma.contentTranslation.create({
      data: {
        sourceType,
        sourceId,
        locale,
        status: 'PENDING',
      },
    });

    return { id: translation.id, status: 'CREATED' };
  }

  /**
   * 执行翻译（由 Worker 调用）
   */
  async executeTranslation(translationId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    const translation = await this.prisma.contentTranslation.findUnique({
      where: { id: translationId },
    });

    if (!translation) {
      throw new NotFoundException(`Translation ${translationId} not found`);
    }

    // 更新状态为翻译中
    await this.prisma.contentTranslation.update({
      where: { id: translationId },
      data: { status: 'TRANSLATING' },
    });

    try {
      // 获取源内容
      const sourceContent = await this.getSourceContent(
        translation.sourceType,
        translation.sourceId,
      );

      if (!sourceContent) {
        throw new Error(`Source content not found: ${translation.sourceType}/${translation.sourceId}`);
      }

      // 调用 AI 翻译
      const translatedContent = await this.translateWithAI(
        sourceContent,
        translation.locale,
        translation.sourceType,
      );

      // 保存翻译结果
      await this.prisma.contentTranslation.update({
        where: { id: translationId },
        data: {
          structuredJson: translatedContent as Prisma.InputJsonValue,
          status: 'COMPLETED',
          provider: 'ai-gateway',
          publishedAt: new Date(),
          reviewStatus: 'AUTO',
        },
      });

      this.logger.log(
        `Translation completed: ${translationId} (${translation.sourceType}/${translation.sourceId} -> ${translation.locale})`,
      );

      return { success: true };
    } catch (err) {
      const errorMessage = (err as Error).message;
      await this.prisma.contentTranslation.update({
        where: { id: translationId },
        data: {
          status: 'FAILED',
          errorMessage,
        },
      });

      this.logger.error(
        `Translation failed: ${translationId} - ${errorMessage}`,
      );

      return { success: false, error: errorMessage };
    }
  }

  /**
   * 批量创建翻译任务（发布预测后自动触发）
   */
  async batchCreateTranslations(params: {
    sourceType: string;
    sourceIds: string[];
    locale: string;
  }): Promise<{ created: number; skipped: number }> {
    const { sourceType, sourceIds, locale } = params;
    let created = 0;
    let skipped = 0;

    for (const sourceId of sourceIds) {
      const result = await this.createTranslationJob({
        sourceType,
        sourceId,
        locale,
      });

      if (result.status === 'CREATED' || result.status === 'RETRYING') {
        created++;
      } else {
        skipped++;
      }
    }

    this.logger.log(
      `Batch translation: ${created} created, ${skipped} skipped for ${sourceType} -> ${locale}`,
    );

    return { created, skipped };
  }

  /**
   * 获取翻译内容（前端展示用）
   */
  async getTranslation(params: {
    sourceType: string;
    sourceId: string;
    locale: string;
  }): Promise<{
    available: boolean;
    status: string;
    content: unknown | null;
    locale: string;
  }> {
    const { sourceType, sourceId, locale } = params;

    const translation = await this.prisma.contentTranslation.findUnique({
      where: {
        sourceType_sourceId_locale: { sourceType, sourceId, locale },
      },
    });

    if (!translation || translation.status !== 'COMPLETED') {
      return {
        available: false,
        status: translation?.status ?? 'NOT_FOUND',
        content: null,
        locale,
      };
    }

    return {
      available: true,
      status: 'COMPLETED',
      content: translation.structuredJson,
      locale,
    };
  }

  /**
   * 获取待翻译任务列表（Worker 轮询用）
   */
  async getPendingTranslations(limit: number = 10): Promise<
    Array<{
      id: string;
      sourceType: string;
      sourceId: string;
      locale: string;
    }>
  > {
    const pending = await this.prisma.contentTranslation.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        locale: true,
      },
    });

    return pending;
  }

  /**
   * 人工审核翻译
   */
  async reviewTranslation(
    translationId: string,
    params: {
      reviewStatus: 'HUMAN_REVIEWED' | 'REJECTED';
      correctedJson?: unknown;
    },
  ): Promise<{ success: boolean }> {
    const update: Record<string, unknown> = {
      reviewStatus: params.reviewStatus,
    };

    if (params.correctedJson) {
      update.structuredJson = params.correctedJson;
    }

    if (params.reviewStatus === 'REJECTED') {
      update.publishedAt = null;
    }

    await this.prisma.contentTranslation.update({
      where: { id: translationId },
      data: update as Parameters<typeof this.prisma.contentTranslation.update>[0]['data'],
    });

    return { success: true };
  }

  /**
   * 获取翻译统计
   */
  async getTranslationStats(): Promise<{
    total: number;
    pending: number;
    translating: number;
    completed: number;
    failed: number;
  }> {
    const [total, pending, translating, completed, failed] = await Promise.all([
      this.prisma.contentTranslation.count(),
      this.prisma.contentTranslation.count({ where: { status: 'PENDING' } }),
      this.prisma.contentTranslation.count({ where: { status: 'TRANSLATING' } }),
      this.prisma.contentTranslation.count({ where: { status: 'COMPLETED' } }),
      this.prisma.contentTranslation.count({ where: { status: 'FAILED' } }),
    ]);

    return { total, pending, translating, completed, failed };
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * 获取源内容
   */
  private async getSourceContent(
    sourceType: string,
    sourceId: string,
  ): Promise<unknown | null> {
    switch (sourceType) {
      case 'PREDICTION_TASK': {
        const task = await this.prisma.predictionTask.findUnique({
          where: { id: sourceId },
          select: { consensusSummary: true },
        });
        return task?.consensusSummary ?? null;
      }
      case 'MODEL_PREDICTION': {
        const prediction = await this.prisma.modelPrediction.findUnique({
          where: { id: sourceId },
          select: { structuredOutput: true },
        });
        return prediction?.structuredOutput ?? null;
      }
      case 'MODEL_REVIEW': {
        const review = await this.prisma.modelReview.findUnique({
          where: { id: sourceId },
          select: { structuredOutput: true },
        });
        return review?.structuredOutput ?? null;
      }
      default:
        return null;
    }
  }

  /**
   * 调用 AI 进行结构化翻译
   */
  private async translateWithAI(
    content: unknown,
    targetLocale: string,
    sourceType: string,
  ): Promise<unknown> {
    // 优先使用 ConfigService，回退到环境变量
    const apiKey = this.configService.get<string>('AI_OPENAI_API_KEY')
      ?? process.env.AI_OPENAI_API_KEY
      ?? process.env.OPENAI_API_KEY;
    const baseUrl = this.configService.get<string>('AI_OPENAI_BASE_URL')
      ?? process.env.AI_OPENAI_BASE_URL
      ?? process.env.OPENAI_BASE_URL
      ?? 'https://api.openai.com/v1';

    if (!apiKey) {
      // Mock 翻译（开发环境）
      this.logger.warn('No AI API key configured, using mock translation');
      return this.mockTranslate(content, targetLocale);
    }

    const systemPrompt = this.buildTranslationSystemPrompt(targetLocale, sourceType);
    const userPrompt = `Please translate the following JSON content. Keep the JSON structure exactly the same, only translate the text values from Chinese to ${targetLocale === 'en' ? 'English' : targetLocale}. Keep proper nouns (team names, model names, competition names) in their original form or use their standard English names. Keep numbers, percentages, and scores unchanged.\n\nJSON to translate:\n${JSON.stringify(content, null, 2)}`;

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API error: ${response.status} - ${errText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const translatedText = data.choices[0]?.message?.content;
      if (!translatedText) {
        throw new Error('Empty response from AI');
      }

      const translated = JSON.parse(translatedText);
      return translated;
    } catch (err) {
      this.logger.error(`AI translation error: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * 构建翻译系统提示
   */
  private buildTranslationSystemPrompt(targetLocale: string, sourceType: string): string {
    const targetLang = targetLocale === 'en' ? 'English' : targetLocale;

    return `You are a professional sports content translator specializing in football/soccer predictions and analysis.

Your task is to translate structured JSON content from Chinese to ${targetLang}.

Rules:
1. Keep the JSON structure EXACTLY the same - same keys, same nesting
2. Only translate text values (strings)
3. Keep proper nouns in their standard ${targetLang} form:
   - Team names: use official English names (e.g., 巴西 -> Brazil, 德国 -> Germany)
   - Competition names: use official English names (e.g., 世界杯 -> World Cup)
   - Model names: keep as-is (e.g., GPT-4.1, Gemini)
4. Keep numbers, percentages, scores, and dates unchanged
5. Translate football terminology accurately:
   - 胜平负 -> Win/Draw/Loss
   - 主胜 -> Home Win
   - 客胜 -> Away Win
   - 进球区间 -> Goal Range
   - 角球区间 -> Corner Range
   - 爆冷风险 -> Upset Risk
   - 共识 -> Consensus
   - 分歧 -> Divergence
6. Maintain the professional yet accessible tone
7. The content type is: ${sourceType}
8. Always include the disclaimer in English: "For entertainment only. Not betting advice."
9. Return valid JSON only, no markdown formatting

Respond with the translated JSON object only.`;
  }

  /**
   * Mock 翻译（开发环境用）
   */
  private mockTranslate(content: unknown, targetLocale: string): unknown {
    if (typeof content === 'string') {
      return `[${targetLocale}] ${content}`;
    }
    if (Array.isArray(content)) {
      return content.map((item) => this.mockTranslate(item, targetLocale));
    }
    if (typeof content === 'object' && content !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(content)) {
        result[key] = this.mockTranslate(value, targetLocale);
      }
      return result;
    }
    return content;
  }
}

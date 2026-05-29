/**
 * T6-05: AI 内容翻译 Worker Job
 *
 * 负责：
 * 1. 定期轮询待翻译任务
 * 2. 调用 AI 进行结构化翻译
 * 3. 翻译结果保存到数据库
 * 4. 支持重试和失败处理
 *
 * 幂等键：translate:{sourceType}:{sourceId}:{locale}
 */

import { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { logger } from '../logger.js';

const prisma = new PrismaClient();

// ─── Payload Schema ─────────────────────────────────────────────────────────

const TranslationPayloadSchema = z.object({
  translationId: z.string().optional(),
  /** 批量模式：处理所有 PENDING 状态的翻译 */
  mode: z.enum(['SINGLE', 'BATCH_PENDING']).default('SINGLE'),
  /** 批量模式下的处理数量限制 */
  batchLimit: z.coerce.number().int().min(1).max(50).default(10),
});

type TranslationPayload = z.infer<typeof TranslationPayloadSchema>;

// ─── Main Processor ─────────────────────────────────────────────────────────

export async function processTranslation(job: Job): Promise<unknown> {
  const parsed = TranslationPayloadSchema.safeParse(job.data);
  if (!parsed.success) {
    logger.error({ jobId: job.id, errors: parsed.error.flatten() }, 'Invalid translation job payload');
    throw new Error('Invalid translation job payload');
  }

  const payload = parsed.data;

  if (payload.mode === 'BATCH_PENDING') {
    return processBatchPending(payload.batchLimit);
  }

  if (!payload.translationId) {
    throw new Error('translationId is required for SINGLE mode');
  }

  return processSingleTranslation(payload.translationId);
}

// ─── Single Translation ─────────────────────────────────────────────────────

async function processSingleTranslation(translationId: string): Promise<{
  success: boolean;
  translationId: string;
}> {
  const translation = await prisma.contentTranslation.findUnique({
    where: { id: translationId },
  });

  if (!translation) {
    logger.warn({ translationId }, 'Translation not found');
    return { success: false, translationId };
  }

  if (translation.status === 'COMPLETED') {
    logger.info({ translationId }, 'Translation already completed, skipping');
    return { success: true, translationId };
  }

  // 更新状态为翻译中
  await prisma.contentTranslation.update({
    where: { id: translationId },
    data: { status: 'TRANSLATING' },
  });

  try {
    // 获取源内容
    const sourceContent = await getSourceContent(translation.sourceType, translation.sourceId);
    if (!sourceContent) {
      throw new Error(`Source content not found: ${translation.sourceType}/${translation.sourceId}`);
    }

    // 执行翻译
    const translated = await translateContent(sourceContent, translation.locale, translation.sourceType);

    // 保存结果
    await prisma.contentTranslation.update({
      where: { id: translationId },
      data: {
        structuredJson: translated as object,
        status: 'COMPLETED',
        provider: 'ai-gateway',
        publishedAt: new Date(),
        reviewStatus: 'AUTO',
        errorMessage: null,
      },
    });

    logger.info(
      { translationId, sourceType: translation.sourceType, locale: translation.locale },
      'Translation completed successfully',
    );

    return { success: true, translationId };
  } catch (err) {
    const errorMessage = (err as Error).message;

    await prisma.contentTranslation.update({
      where: { id: translationId },
      data: {
        status: 'FAILED',
        errorMessage,
      },
    });

    logger.error(
      { translationId, error: errorMessage },
      'Translation failed',
    );

    return { success: false, translationId };
  }
}

// ─── Batch Processing ───────────────────────────────────────────────────────

async function processBatchPending(limit: number): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const pending = await prisma.contentTranslation.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  logger.info({ count: pending.length }, 'Processing batch translations');

  let succeeded = 0;
  let failed = 0;

  for (const { id } of pending) {
    const result = await processSingleTranslation(id);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
    // 添加小延迟避免 API 限流
    await sleep(1000);
  }

  return { processed: pending.length, succeeded, failed };
}

// ─── Helper Functions ───────────────────────────────────────────────────────

async function getSourceContent(sourceType: string, sourceId: string): Promise<unknown | null> {
  switch (sourceType) {
    case 'PREDICTION_TASK': {
      const task = await prisma.predictionTask.findUnique({
        where: { id: sourceId },
        select: { consensusSummary: true },
      });
      return task?.consensusSummary ?? null;
    }
    case 'MODEL_PREDICTION': {
      const prediction = await prisma.modelPrediction.findUnique({
        where: { id: sourceId },
        select: { structuredOutput: true },
      });
      return prediction?.structuredOutput ?? null;
    }
    case 'MODEL_REVIEW': {
      const review = await prisma.modelReview.findUnique({
        where: { id: sourceId },
        select: { structuredOutput: true },
      });
      return review?.structuredOutput ?? null;
    }
    default:
      return null;
  }
}

async function translateContent(
  content: unknown,
  targetLocale: string,
  sourceType: string,
): Promise<unknown> {
  const apiKey = process.env.AI_OPENAI_API_KEY
    ?? process.env.OPENAI_API_KEY;
  const baseUrl = process.env.AI_OPENAI_BASE_URL
    ?? process.env.OPENAI_BASE_URL
    ?? 'https://api.openai.com/v1';

  if (!apiKey) {
    logger.warn('No AI API key configured, using mock translation');
    return mockTranslate(content, targetLocale);
  }

  const targetLang = targetLocale === 'en' ? 'English' : targetLocale;

  const systemPrompt = `You are a professional sports content translator specializing in football/soccer predictions and analysis.

Translate the following JSON content from Chinese to ${targetLang}.

Rules:
1. Keep JSON structure EXACTLY the same - same keys, same nesting
2. Only translate text string values
3. Use standard English names for teams and competitions
4. Keep numbers, percentages, scores unchanged
5. Football terminology: 胜平负->Win/Draw/Loss, 主胜->Home Win, 客胜->Away Win, 进球区间->Goal Range, 角球区间->Corner Range, 爆冷风险->Upset Risk
6. Maintain professional yet accessible tone
7. Content type: ${sourceType}
8. Return valid JSON only`;

  const userPrompt = `Translate this JSON:\n${JSON.stringify(content, null, 2)}`;

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

  return JSON.parse(translatedText);
}

function mockTranslate(content: unknown, locale: string): unknown {
  if (typeof content === 'string') {
    return `[${locale}] ${content}`;
  }
  if (Array.isArray(content)) {
    return content.map((item) => mockTranslate(item, locale));
  }
  if (typeof content === 'object' && content !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(content)) {
      result[key] = mockTranslate(value, locale);
    }
    return result;
  }
  return content;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

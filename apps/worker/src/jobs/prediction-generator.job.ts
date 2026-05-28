import { PredictionVersion } from '@ai-worldcup/shared';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

export const PredictionGeneratorPayloadSchema = z.object({
  matchId: z.string(),
  version: z.nativeEnum(PredictionVersion),
  /** 触发原因：cron 调度还是人工补偿 */
  trigger: z.enum(['CRON', 'MANUAL']).default('CRON'),
});

export type PredictionGeneratorPayload = z.infer<
  typeof PredictionGeneratorPayloadSchema
>;

/**
 * 阶段 0 占位 processor：仅记录日志，不真正调用 AI。
 * 阶段 1 接入 AI 网关、Prisma、Prompt 模板、原始输出快照存储。
 */
export async function processPredictionGenerator(
  job: Job<unknown>,
): Promise<{ ok: true }> {
  const payload = PredictionGeneratorPayloadSchema.parse(job.data);
  logger.info(
    { jobId: job.id, payload },
    'prediction-generator placeholder running',
  );
  return { ok: true };
}

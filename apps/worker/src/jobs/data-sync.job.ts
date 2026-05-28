import type { Job } from 'bullmq';
import { z } from 'zod';

import { logger } from '../logger.js';

export const DataSyncPayloadSchema = z.object({
  scope: z.enum(['FIXTURES', 'LIVE_SCORES', 'STANDINGS']).default('FIXTURES'),
});

export type DataSyncPayload = z.infer<typeof DataSyncPayloadSchema>;

export async function processDataSync(job: Job<unknown>): Promise<{ ok: true }> {
  const payload = DataSyncPayloadSchema.parse(job.data);
  logger.info({ jobId: job.id, payload }, 'data-sync placeholder running');
  return { ok: true };
}

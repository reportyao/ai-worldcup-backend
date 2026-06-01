import { z } from 'zod';

export const ActivityConfigUpsertSchema = z.object({
  key: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).default('ACTIVE'),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  config: z.record(z.unknown()).optional(),
});

export type ActivityConfigUpsertDto = z.infer<typeof ActivityConfigUpsertSchema>;

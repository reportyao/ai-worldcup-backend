import { MatchStatus, UserPredictionResult } from '@prisma/client';
import { z } from 'zod';

export const MatchListQuerySchema = z.object({
  competitionId: z.string().optional(),
  matchday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.nativeEnum(MatchStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type MatchListQueryDto = z.infer<typeof MatchListQuerySchema>;

export const UserPredictionSubmitSchema = z.object({
  prediction: z.nativeEnum(UserPredictionResult),
  homeScore: z.coerce.number().int().min(0).max(30),
  awayScore: z.coerce.number().int().min(0).max(30),
  goalsMin: z.coerce.number().int().min(0).max(30).optional(),
  goalsMax: z.coerce.number().int().min(0).max(30).optional(),
  clientRequestId: z.string().trim().min(8).max(128).optional(),
}).superRefine((value, ctx) => {
  if (value.goalsMin != null && value.goalsMax != null && value.goalsMin > value.goalsMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'goalsMin must be less than or equal to goalsMax', path: ['goalsMin'] });
  }
});
export type UserPredictionSubmitDto = z.infer<typeof UserPredictionSubmitSchema>;

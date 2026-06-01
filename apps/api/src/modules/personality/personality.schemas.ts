import { z } from 'zod';

export const PersonalityQuestionUpsertSchema = z.object({
  activityKey: z.string().min(1).default('worldcup-personality-v1'),
  sortOrder: z.coerce.number().int().min(1),
  question: z.string().min(1),
  description: z.string().optional(),
  options: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional(),
      weights: z.record(z.coerce.number()).default({}),
    }),
  ).min(2),
  isActive: z.boolean().default(true),
});

export const PersonalitySubmitSchema = z.object({
  activityKey: z.string().min(1).default('worldcup-personality-v1'),
  answers: z.array(
    z.object({
      questionId: z.string().min(1),
      optionId: z.string().min(1),
    }),
  ).min(1),
});

export type PersonalityQuestionUpsertDto = z.infer<typeof PersonalityQuestionUpsertSchema>;
export type PersonalitySubmitDto = z.infer<typeof PersonalitySubmitSchema>;

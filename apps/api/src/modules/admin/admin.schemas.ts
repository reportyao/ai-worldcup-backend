import { z } from 'zod';

const nullableDateInput = z
  .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value === '' ? null : value));

const optionalTrimmedString = z
  .union([z.string().trim(), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value === '' ? null : value));

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const AdminCompetitionListQuerySchema = PaginationQuerySchema.extend({
  keyword: z.string().trim().optional(),
  type: z.enum(['WORLD_CUP', 'CONTINENTAL_CUP', 'CITY_LEAGUE', 'OTHER']).optional(),
  status: z.string().trim().optional(),
});
export type AdminCompetitionListQuery = z.infer<
  typeof AdminCompetitionListQuerySchema
>;

export const AdminCompetitionCreateSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['WORLD_CUP', 'CONTINENTAL_CUP', 'CITY_LEAGUE', 'OTHER']).default('WORLD_CUP'),
  season: z.string().trim().min(1).max(40),
  country: optionalTrimmedString,
  cityTag: optionalTrimmedString,
  status: z.string().trim().min(1).max(30).default('ACTIVE'),
  startDate: nullableDateInput,
  endDate: nullableDateInput,
  externalId: optionalTrimmedString,
});
export type AdminCompetitionCreateDto = z.infer<
  typeof AdminCompetitionCreateSchema
>;

export const AdminCompetitionUpdateSchema = AdminCompetitionCreateSchema.partial();
export type AdminCompetitionUpdateDto = z.infer<
  typeof AdminCompetitionUpdateSchema
>;

const ScoreSchema = z
  .union([z.coerce.number().int().min(0).max(99), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value === '' ? null : value));

export const AdminTeamListQuerySchema = PaginationQuerySchema.extend({
  keyword: z.string().trim().optional(),
});

export const AdminMatchListQuerySchema = PaginationQuerySchema.extend({
  competitionId: z.string().optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELED']).optional(),
  keyword: z.string().trim().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AdminMatchListQuery = z.infer<typeof AdminMatchListQuerySchema>;

const AdminMatchBaseSchema = z.object({
  competitionId: z.string().min(1),
  homeTeamId: z.string().optional(),
  awayTeamId: z.string().optional(),
  homeTeamCode: z.string().trim().min(2).max(30).optional(),
  homeTeamName: z.string().trim().min(1).max(120).optional(),
  awayTeamCode: z.string().trim().min(2).max(30).optional(),
  awayTeamName: z.string().trim().min(1).max(120).optional(),
  kickoffAt: z.string().datetime(),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELED']).default('SCHEDULED'),
  matchday: optionalTrimmedString,
  stage: optionalTrimmedString,
  homeScore: ScoreSchema,
  awayScore: ScoreSchema,
  externalId: optionalTrimmedString,
});

export const AdminMatchCreateSchema = AdminMatchBaseSchema.superRefine(
  (value, ctx) => {
    if (!value.homeTeamId && (!value.homeTeamCode || !value.homeTeamName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['homeTeamCode'],
        message: 'homeTeamId or homeTeamCode/homeTeamName is required',
      });
    }
    if (!value.awayTeamId && (!value.awayTeamCode || !value.awayTeamName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['awayTeamCode'],
        message: 'awayTeamId or awayTeamCode/awayTeamName is required',
      });
    }
  },
);
export type AdminMatchCreateDto = z.infer<typeof AdminMatchCreateSchema>;

export const AdminMatchUpdateSchema = AdminMatchBaseSchema.partial().superRefine(
  (value, ctx) => {
    if ((value.homeTeamCode && !value.homeTeamName) || (!value.homeTeamCode && value.homeTeamName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['homeTeamCode'],
        message: 'homeTeamCode and homeTeamName must be supplied together',
      });
    }
    if ((value.awayTeamCode && !value.awayTeamName) || (!value.awayTeamCode && value.awayTeamName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['awayTeamCode'],
        message: 'awayTeamCode and awayTeamName must be supplied together',
      });
    }
  },
);
export type AdminMatchUpdateDto = z.infer<typeof AdminMatchUpdateSchema>;

export const AdminMatchImportSchema = z.object({
  competitionId: z.string().min(1),
  fileName: z.string().min(1),
  contentBase64: z.string().min(1),
  dryRun: z.coerce.boolean().default(false),
});
export type AdminMatchImportDto = z.infer<typeof AdminMatchImportSchema>;

export const AdminAuditLogListQuerySchema = PaginationQuerySchema.extend({
  action: z.string().trim().optional(),
  targetType: z.string().trim().optional(),
  targetId: z.string().trim().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AdminAuditLogListQuery = z.infer<
  typeof AdminAuditLogListQuerySchema
>;

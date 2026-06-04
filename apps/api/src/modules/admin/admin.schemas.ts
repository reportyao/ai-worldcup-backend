import { StructuredPredictionSchema } from '@ai-worldcup/shared';
import { MANUAL_TRIGGER_PREDICTION_VERSIONS, ALL_PREDICTION_VERSIONS } from '@ai-worldcup/shared';
import { z } from 'zod';

const nullableDateInput = z
  .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value === '' ? null : value));

const optionalTrimmedString = z
  .union([z.string().trim(), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value === '' ? null : value));


export const AdminLoginSchema = z.object({
  email: z.string().trim().email().optional(),
  password: z.string().min(1).max(256),
});
export type AdminLoginDto = z.infer<typeof AdminLoginSchema>;

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

export const AdminFootballDataSyncSchema = z.object({
  provider: z.enum(['api-football', 'sporttery']).default('api-football'),
  scope: z.enum(['LEAGUES', 'TEAMS', 'FIXTURES', 'LIVE_SCORES', 'STANDINGS', 'SPORTTERY_JC']).default('FIXTURES'),
  leagueIds: z.array(z.coerce.number().int().positive()).optional(),
  season: optionalTrimmedString,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dryRun: z.coerce.boolean().default(false),
  enqueuePredictions: z.coerce.boolean().default(false),
});
export type AdminFootballDataSyncDto = z.infer<typeof AdminFootballDataSyncSchema>;

export const AdminFootballDataSyncLogQuerySchema = PaginationQuerySchema.extend({
  scope: z.enum(['LEAGUES', 'TEAMS', 'FIXTURES', 'LIVE_SCORES', 'STANDINGS', 'SPORTTERY_JC']).optional(),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED']).optional(),
});
export type AdminFootballDataSyncLogQuery = z.infer<typeof AdminFootballDataSyncLogQuerySchema>;

export const AdminCustomAiPredictionSettingsUpdateSchema = z.object({
  apiUrl: optionalTrimmedString,
  apiKey: optionalTrimmedString,
});
export type AdminCustomAiPredictionSettingsUpdateDto = z.infer<typeof AdminCustomAiPredictionSettingsUpdateSchema>;

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

export const AdminAiModelListQuerySchema = PaginationQuerySchema.extend({
  keyword: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  isActive: z.coerce.boolean().optional(),
});
export type AdminAiModelListQuery = z.infer<typeof AdminAiModelListQuerySchema>;

const AiModelConfigSchema = z.record(z.unknown()).optional().nullable();

export const AdminAiModelCreateSchema = z.object({
  modelId: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(1).max(120),
  provider: z.enum(['openai', 'google', 'anthropic', 'mock']).or(z.string().trim().min(2).max(40)),
  persona: z.enum(['STEADY', 'ATTACKING', 'UPSET_HUNTER', 'DATA_DRIVEN']).default('STEADY'),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(10_000).default(100),
  description: optionalTrimmedString,
  config: AiModelConfigSchema,
});
export type AdminAiModelCreateDto = z.infer<typeof AdminAiModelCreateSchema>;

export const AdminAiModelUpdateSchema = AdminAiModelCreateSchema.partial();
export type AdminAiModelUpdateDto = z.infer<typeof AdminAiModelUpdateSchema>;

export const AdminAiModelReorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.coerce.number().int().min(0).max(10_000),
      }),
    )
    .min(1),
});
export type AdminAiModelReorderDto = z.infer<typeof AdminAiModelReorderSchema>;

export const AdminPredictionTaskQuerySchema = PaginationQuerySchema.extend({
  matchId: z.string().trim().optional(),
  keyword: z.string().trim().optional(),
  version: z.enum(ALL_PREDICTION_VERSIONS as [string, ...string[]]).optional(),
  status: z
    .enum(['PENDING', 'RUNNING', 'PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'REVIEWED', 'PUBLISHED'])
    .optional(),
  trigger: z.enum(['CRON', 'MANUAL']).optional(),
});
export type AdminPredictionTaskQuery = z.infer<typeof AdminPredictionTaskQuerySchema>;

export const AdminPredictionTriggerSchema = z.object({
  matchId: z.string().min(1),
  version: z.enum(MANUAL_TRIGGER_PREDICTION_VERSIONS as [string, ...string[]]),
  rerun: z.coerce.boolean().default(false),
});
export type AdminPredictionTriggerDto = z.infer<typeof AdminPredictionTriggerSchema>;

export const AdminPredictionRerunSchema = z.object({
  reason: optionalTrimmedString,
});
export type AdminPredictionRerunDto = z.infer<typeof AdminPredictionRerunSchema>;

export const AdminScorecardTriggerSchema = z.object({
  matchId: z.string().trim().min(1).optional(),
  mode: z.enum(['MATCH', 'SCAN_FINISHED']).default('SCAN_FINISHED'),
}).refine((value) => value.mode === 'SCAN_FINISHED' || Boolean(value.matchId), {
  message: 'matchId is required when mode is MATCH',
  path: ['matchId'],
});
export type AdminScorecardTriggerDto = z.infer<typeof AdminScorecardTriggerSchema>;


export const AdminPromptTemplateListQuerySchema = PaginationQuerySchema.extend({
  scene: z.string().trim().default('MATCH_PREDICTION'),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type AdminPromptTemplateListQuery = z.infer<typeof AdminPromptTemplateListQuerySchema>;

export const AdminPromptTemplateCreateSchema = z.object({
  scene: z.string().trim().min(1).max(80).default('MATCH_PREDICTION'),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(80),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  systemPrompt: z.string().trim().min(20),
  userPrompt: z.string().trim().min(20),
  description: optionalTrimmedString,
  metadata: z.record(z.unknown()).optional().nullable(),
});
export type AdminPromptTemplateCreateDto = z.infer<typeof AdminPromptTemplateCreateSchema>;

export const AdminPromptTemplateUpdateSchema = AdminPromptTemplateCreateSchema.partial();
export type AdminPromptTemplateUpdateDto = z.infer<typeof AdminPromptTemplateUpdateSchema>;

export const AdminModelPredictionUpdateSchema = z.object({
  structuredOutput: StructuredPredictionSchema.optional().nullable(),
  rawOutput: optionalTrimmedString,
  promptVersion: optionalTrimmedString,
  promptSnapshot: optionalTrimmedString,
  isSuccess: z.coerce.boolean().default(true),
  errorMessage: optionalTrimmedString,
});
export type AdminModelPredictionUpdateDto = z.infer<typeof AdminModelPredictionUpdateSchema>;


// ============================================================================
// Manual AI Prediction Upload (人工上传AI分析结果)
// ============================================================================

export const AdminManualPredictionUploadSchema = z.object({
  matchId: z.string().min(1),
  version: z.enum(MANUAL_TRIGGER_PREDICTION_VERSIONS as [string, ...string[]]).default('T_MINUS_7H'),
  /** 每个模型对应一份 Markdown 内容 */
  predictions: z.array(z.object({
    aiModelId: z.string().min(1),
    markdownContent: z.string().min(10),
  })).min(1),
});
export type AdminManualPredictionUploadDto = z.infer<typeof AdminManualPredictionUploadSchema>;

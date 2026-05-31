import { z } from 'zod';

/**
 * 启动期环境变量校验：缺少强制变量时直接 fail-fast，避免运行时再爆。
 * 阶段 0 仅校验最基础的几项，第三方密钥保持可选，待对接时再收紧。
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379/0'),

  JWT_SECRET: z.string().min(8).default('dev_jwt_secret_change_me_in_prod'),
  JWT_ACCESS_TTL: z.string().default('2h'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  AI_GATEWAY_BASE_URL: z.string().url().optional(),
  AI_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_OPENAI_API_KEY: z.string().min(1).optional(),
  AI_OPENAI_BASE_URL: z.string().url().optional(),
  AI_GOOGLE_API_KEY: z.string().min(1).optional(),
  AI_GOOGLE_BASE_URL: z.string().url().optional(),
  AI_ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_ANTHROPIC_BASE_URL: z.string().url().optional(),
  AI_ALLOW_MOCK: z.coerce.boolean().default(false),

  API_FOOTBALL_KEY: z.string().min(1).optional(),
  API_FOOTBALL_BASE_URL: z.string().url().default('https://apiv3.apifootball.com/'),
  API_FOOTBALL_LEAGUE_IDS: z.string().min(1).optional(),
  DATA_REFRESH_CRON_FIXTURES: z.string().default('0 */6 * * *'),
  DATA_REFRESH_CRON_LIVE: z.string().default('*/2 * * * *'),
  PREDICTION_SCHEDULER_WINDOW_MINUTES: z.coerce.number().int().min(1).max(120).default(10),

  // T6: Share & i18n
  H5_BASE_URL: z.string().default('http://localhost:5173'),
  WECHAT_APP_ID: z.string().min(1).optional(),
  WECHAT_APP_SECRET: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[config] invalid environment variables', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

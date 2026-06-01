import { z } from 'zod';

const ENV_ALIASES: Array<[canonical: string, legacy: string]> = [
  ['WECHAT_MP_APPID', 'WECHAT_APP_ID'],
  ['WECHAT_MP_SECRET', 'WECHAT_APP_SECRET'],
  ['WECHAT_PAY_MCHID', 'WECHAT_PAY_MCH_ID'],
  ['WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_CERT_SERIAL_NO'],
  ['AI_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  ['AI_OPENAI_BASE_URL', 'OPENAI_BASE_URL'],
  ['AI_OPENAI_BASE_URL', 'AI_PROVIDER_BASE_URL'],
  ['AI_GATEWAY_BASE_URL', 'AI_PROVIDER_BASE_URL'],
];

/**
 * 启动期环境变量校验：缺少强制变量时直接 fail-fast，避免运行时再爆。
 * 第三方密钥保持可选；生产环境会强制基础数据库、认证和管理端密钥。
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
  CORS_ALLOWED_ORIGINS: z.string().min(1).optional(),

  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379/0'),

  JWT_SECRET: z.string().min(8).default('dev_jwt_secret_change_me_in_prod'),
  JWT_ACCESS_TTL: z.string().default('2h'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  ADMIN_EMAIL: z.string().email().default('admin@ai-worldcup.local'),
  ADMIN_NAME: z.string().min(1).default('AI WorldCup Admin'),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_PASSWORD_SHA256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  ADMIN_SESSION_SECRET: z.string().min(16).optional(),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(86_400),

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
  WECHAT_MP_APPID: z.string().min(1).optional(),
  WECHAT_MP_SECRET: z.string().min(1).optional(),
  WECHAT_MP_TOKEN: z.string().min(1).optional(),
  WECHAT_MP_AES_KEY: z.string().min(1).optional(),
  WECHAT_PAY_MCHID: z.string().min(1).optional(),
  WECHAT_PAY_API_V3_KEY: z.string().min(1).optional(),
  WECHAT_PAY_SERIAL_NO: z.string().min(1).optional(),
  WECHAT_PAY_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_NOTIFY_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema>;

function normalizeEnvironment(env: NodeJS.ProcessEnv): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === '') delete env[key];
  }

  for (const [canonical, legacy] of ENV_ALIASES) {
    const canonicalValue = env[canonical];
    const legacyValue = env[legacy];
    if (!canonicalValue && legacyValue) env[canonical] = legacyValue;
    if (!legacyValue && env[canonical]) env[legacy] = env[canonical];
  }

  // Prisma schema uses `directUrl = env("DIRECT_URL")` for migration/direct
  // connection support. Existing production deployments may only have
  // DATABASE_URL in their persisted .env file; falling back keeps the API
  // process from failing during Prisma Client initialization after upgrades.
  if (!env.DIRECT_URL && env.DATABASE_URL) {
    env.DIRECT_URL = env.DATABASE_URL;
  }
}

function validateProductionConfig(config: AppConfig): void {
  if (config.NODE_ENV !== 'production') return;

  const errors: string[] = [];
  if (!config.DATABASE_URL) errors.push('DATABASE_URL is required in production');
  if (config.JWT_SECRET === 'dev_jwt_secret_change_me_in_prod') {
    errors.push('JWT_SECRET must be overridden in production');
  }
  if (!config.ADMIN_SESSION_SECRET) errors.push('ADMIN_SESSION_SECRET is required in production');
  if (!config.ADMIN_PASSWORD && !config.ADMIN_PASSWORD_SHA256) {
    errors.push('ADMIN_PASSWORD or ADMIN_PASSWORD_SHA256 is required in production');
  }
  if (config.AI_ALLOW_MOCK) {
    errors.push('AI_ALLOW_MOCK must be false in production');
  }

  if (errors.length) {
    // eslint-disable-next-line no-console
    console.error('[config] invalid production environment', errors);
    throw new Error(`Invalid production environment configuration: ${errors.join('; ')}`);
  }
}

export function loadConfig(): AppConfig {
  normalizeEnvironment(process.env);
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('[config] invalid environment variables', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  validateProductionConfig(parsed.data);
  return parsed.data;
}

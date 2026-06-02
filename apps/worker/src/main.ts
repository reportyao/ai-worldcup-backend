import 'dotenv/config';

import { Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { processConsensusCalculator } from './jobs/consensus-calculator.job.js';
import { processDataSync } from './jobs/data-sync.job.js';
import { processFeatureCompute } from './jobs/feature-compute.job.js';
import { processPredictionGenerator } from './jobs/prediction-generator.job.js';
import { processReviewGenerator } from './jobs/review-generator.job.js';
import { processScorecardUpdate } from './jobs/scorecard-update.job.js';
import { processTranslation } from './jobs/translation.job.js';
import { logger } from './logger.js';
import { QueueName } from './queues.js';

function normalizeEnvironment(env: NodeJS.ProcessEnv): void {
  const aliases: Array<[canonical: string, legacy: string]> = [
    ['WECHAT_MP_APPID', 'WECHAT_APP_ID'],
    ['WECHAT_MP_SECRET', 'WECHAT_APP_SECRET'],
    ['WECHAT_PAY_MCHID', 'WECHAT_PAY_MCH_ID'],
    ['WECHAT_PAY_SERIAL_NO', 'WECHAT_PAY_CERT_SERIAL_NO'],
    ['AI_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    ['AI_OPENAI_BASE_URL', 'OPENAI_BASE_URL'],
    ['AI_OPENAI_BASE_URL', 'AI_PROVIDER_BASE_URL'],
    ['AI_GATEWAY_BASE_URL', 'AI_PROVIDER_BASE_URL'],
  ];

  for (const [canonical, legacy] of aliases) {
    const canonicalValue = env[canonical];
    const legacyValue = env[legacy];
    if (!canonicalValue && legacyValue) env[canonical] = legacyValue;
    if (!legacyValue && env[canonical]) env[legacy] = env[canonical];
  }
}

normalizeEnvironment(process.env);

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/0';

/**
 * BullMQ 要求 connection 设置 maxRetriesPerRequest=null，否则关停时会抛错。
 */
function createConnection(): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

const workers: Worker[] = [];
const queues: Queue[] = [];

async function registerPredictionScheduler(): Promise<void> {
  const queue = new Queue(QueueName.PredictionGenerator, { connection: createConnection() });
  queues.push(queue);
  await queue.add(
    'schedule-due-predictions',
    {
      mode: 'SCHEDULE_DUE',
      windowMinutes: Number(process.env.PREDICTION_SCHEDULER_WINDOW_MINUTES ?? 10),
    },
    {
      repeat: { pattern: process.env.PREDICTION_SCHEDULER_CRON ?? '*/5 * * * *' },
      jobId: 'prediction-scheduler-repeat',
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info({ queue: QueueName.PredictionGenerator }, 'prediction scheduler registered');
}

async function registerFeatureComputeScheduler(): Promise<void> {
  const queue = new Queue(QueueName.FeatureCompute, { connection: createConnection() });
  queues.push(queue);
  await queue.add(
    'batch-feature-compute',
    { mode: 'BATCH', daysAhead: 7 },
    {
      repeat: { pattern: process.env.FEATURE_COMPUTE_CRON ?? '0 3 * * *' },
      jobId: 'feature-compute-batch-repeat',
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info({ queue: QueueName.FeatureCompute }, 'feature-compute scheduler registered');
}

async function registerScorecardScheduler(): Promise<void> {
  const queue = new Queue(QueueName.ScorecardUpdate, { connection: createConnection() });
  queues.push(queue);
  await queue.add(
    'scan-finished-scorecards',
    {
      mode: 'SCAN_FINISHED',
      trigger: 'CRON',
      lookbackDays: Number(process.env.SCORECARD_SCAN_LOOKBACK_DAYS ?? 7),
      limit: Number(process.env.SCORECARD_SCAN_LIMIT ?? 50),
    },
    {
      repeat: { pattern: process.env.SCORECARD_SCAN_CRON ?? '*/15 * * * *' },
      jobId: 'scorecard-scan-repeat',
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info({ queue: QueueName.ScorecardUpdate }, 'scorecard scheduler registered');
}

async function registerDataSyncSchedulers(): Promise<void> {
  if (!process.env.API_FOOTBALL_KEY) {
    logger.warn('API_FOOTBALL_KEY is not configured; data-sync schedulers will not be registered');
    return;
  }

  const queue = new Queue(QueueName.DataSync, { connection: createConnection() });
  queues.push(queue);
  await queue.add(
    'sync-football-fixtures',
    { scope: 'FIXTURES', enqueuePredictions: true },
    {
      repeat: { pattern: process.env.DATA_REFRESH_CRON_FIXTURES ?? '0 */6 * * *' },
      jobId: 'data-sync-fixtures-repeat',
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  await queue.add(
    'sync-football-live-scores',
    { scope: 'LIVE_SCORES', enqueuePredictions: false },
    {
      repeat: { pattern: process.env.DATA_REFRESH_CRON_LIVE ?? '*/2 * * * *' },
      jobId: 'data-sync-live-repeat',
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );
  logger.info({ queue: QueueName.DataSync }, 'data-sync schedulers registered');
}

function registerWorker(
  name: QueueName,
  processor: (job: Job) => Promise<unknown>,
): void {
  const w = new Worker(name, processor, {
    connection: createConnection(),
    concurrency: 2,
  });
  w.on('ready', () => logger.info({ queue: name }, 'worker ready'));
  w.on('failed', (job, err) =>
    logger.error(
      { queue: name, jobId: job?.id, err: err.message },
      'job failed',
    ),
  );
  w.on('completed', (job) =>
    logger.info({ queue: name, jobId: job.id }, 'job completed'),
  );
  workers.push(w);
}

async function main(): Promise<void> {
  logger.info({ redisUrl }, 'starting AI Worldcup worker');

  await registerPredictionScheduler();
  await registerDataSyncSchedulers();
  await registerFeatureComputeScheduler();
  await registerScorecardScheduler();
  registerWorker(QueueName.PredictionGenerator, processPredictionGenerator);
  registerWorker(QueueName.DataSync, processDataSync);
  registerWorker(QueueName.PostMatchReview, processReviewGenerator);
  registerWorker(QueueName.ConsensusCalculator, processConsensusCalculator);
  registerWorker(QueueName.ScorecardUpdate, processScorecardUpdate);
  registerWorker(QueueName.Translation, processTranslation);
  registerWorker(QueueName.FeatureCompute, processFeatureCompute);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutting down workers');
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'worker bootstrap failed');
  process.exit(1);
});

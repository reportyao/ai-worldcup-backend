import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { processConsensusCalculator } from './jobs/consensus-calculator.job.js';
import { processDataSync } from './jobs/data-sync.job.js';
import { processPredictionGenerator } from './jobs/prediction-generator.job.js';
import { processReviewGenerator } from './jobs/review-generator.job.js';
import { processScorecardUpdate } from './jobs/scorecard-update.job.js';
import { processTranslation } from './jobs/translation.job.js';
import { logger } from './logger.js';
import { QueueName } from './queues.js';

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

function registerWorker(
  name: QueueName,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: (job: any) => Promise<unknown>,
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
  registerWorker(QueueName.PredictionGenerator, processPredictionGenerator);
  registerWorker(QueueName.DataSync, processDataSync);
  registerWorker(QueueName.PostMatchReview, processReviewGenerator);
  registerWorker(QueueName.ConsensusCalculator, processConsensusCalculator);
  registerWorker(QueueName.ScorecardUpdate, processScorecardUpdate);
  registerWorker(QueueName.Translation, processTranslation);

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

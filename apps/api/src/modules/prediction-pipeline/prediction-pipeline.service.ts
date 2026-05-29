import { BadRequestException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PredictionTaskStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { ErrorCode } from '@ai-worldcup/shared';
import type { PredictionTrigger, PredictionVersion } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueName } from '../../queues.js';

export interface EnqueuePredictionOptions {
  matchId: string;
  version: PredictionVersion;
  trigger: PredictionTrigger;
  rerun?: boolean;
}

@Injectable()
export class PredictionPipelineService implements OnModuleDestroy {
  private readonly predictionQueue: Queue;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    this.predictionQueue = new Queue(QueueName.PredictionGenerator, {
      connection: { url: this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379/0' },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.predictionQueue.close();
  }

  async enqueuePrediction(options: EnqueuePredictionOptions) {
    const match = await this.prisma.match.findUnique({ where: { id: options.matchId } });
    if (!match) throw new BadRequestException('Match not found');

    const existing = await this.prisma.predictionTask.findUnique({
      where: { matchId_version: { matchId: options.matchId, version: options.version } },
    });
    if (existing?.status === PredictionTaskStatus.RUNNING && !options.rerun) {
      throw new BadRequestException({ code: ErrorCode.AI_TASK_ALREADY_RUNNING, message: 'Prediction task is already running' });
    }

    const task = await this.prisma.predictionTask.upsert({
      where: { matchId_version: { matchId: options.matchId, version: options.version } },
      create: {
        matchId: options.matchId,
        version: options.version,
        trigger: options.trigger,
        status: PredictionTaskStatus.PENDING,
      },
      update: {
        trigger: options.trigger,
        status: PredictionTaskStatus.PENDING,
        errorMessage: null,
        ...(options.rerun ? { publishedAt: null } : {}),
      },
    });

    const job = await this.predictionQueue.add(
      'generate-prediction',
      {
        matchId: options.matchId,
        version: options.version,
        trigger: options.trigger,
        rerun: options.rerun ?? false,
      },
      {
        attempts: 1,
        removeOnComplete: 200,
        removeOnFail: 500,
        jobId: `prediction_${options.matchId}_${options.version}_${Date.now()}`,
      },
    );

    return { task, jobId: job.id };
  }

  async enqueueSchedulerScan(windowMinutes?: number) {
    const job = await this.predictionQueue.add(
      'schedule-due-predictions',
      {
        mode: 'SCHEDULE_DUE',
        windowMinutes: windowMinutes ?? this.config.get<number>('PREDICTION_SCHEDULER_WINDOW_MINUTES') ?? 10,
      },
      {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 100,
        jobId: `prediction-scheduler_${Date.now()}`,
      },
    );
    return { jobId: job.id };
  }
}

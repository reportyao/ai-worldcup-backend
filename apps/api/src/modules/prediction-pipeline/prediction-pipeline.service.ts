import { AUTO_TRIGGER_PREDICTION_VERSIONS, ErrorCode } from '@ai-worldcup/shared';
import type { OnModuleDestroy } from '@nestjs/common';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PredictionTaskStatus, PredictionTrigger } from '@prisma/client';
import type { PredictionVersion } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QueueName } from '../../queues.js';

export interface EnqueuePredictionOptions {
  matchId: string;
  version: PredictionVersion;
  trigger: PredictionTrigger;
  rerun?: boolean;
}

export interface EnqueueScorecardOptions {
  matchId?: string;
  mode?: 'MATCH' | 'SCAN_FINISHED';
}

const T_MINUS_2H_MANUAL_WINDOW_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class PredictionPipelineService implements OnModuleDestroy {
  private readonly predictionQueue: Queue;
  private readonly scorecardQueue: Queue;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    const connection = { url: this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379/0' };
    this.predictionQueue = new Queue(QueueName.PredictionGenerator, { connection });
    this.scorecardQueue = new Queue(QueueName.ScorecardUpdate, { connection });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.predictionQueue.close(), this.scorecardQueue.close()]);
  }

  async enqueuePrediction(options: EnqueuePredictionOptions) {
    if (options.trigger === PredictionTrigger.CRON && !AUTO_TRIGGER_PREDICTION_VERSIONS.includes(options.version)) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Prediction version ${options.version} is not allowed for automatic trigger`,
      });
    }

    const match = await this.prisma.match.findUnique({ where: { id: options.matchId } });
    if (!match) throw new BadRequestException('Match not found');

    if (options.trigger === PredictionTrigger.MANUAL && options.version === 'T_MINUS_2H') {
      const msUntilKickoff = match.kickoffAt.getTime() - Date.now();
      if (msUntilKickoff > T_MINUS_2H_MANUAL_WINDOW_MS || msUntilKickoff < 0) {
        throw new BadRequestException({
          code: ErrorCode.VALIDATION_FAILED,
          message: '赛前2小时预测只能在比赛开始前2小时内由人工触发',
          details: { kickoffAt: match.kickoffAt, msUntilKickoff },
        });
      }
    }

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

  async enqueueScorecardUpdate(options: EnqueueScorecardOptions = {}) {
    if (options.matchId) {
      const match = await this.prisma.match.findUnique({ where: { id: options.matchId } });
      if (!match) throw new BadRequestException('Match not found');
      const job = await this.scorecardQueue.add(
        'update-scorecard',
        { matchId: options.matchId },
        {
          attempts: 2,
          removeOnComplete: 200,
          removeOnFail: 500,
          jobId: `scorecard_${options.matchId}_${Date.now()}`,
        },
      );
      return { mode: 'MATCH', matchId: options.matchId, jobId: job.id };
    }

    const job = await this.scorecardQueue.add(
      'scan-finished-scorecards',
      { mode: options.mode ?? 'SCAN_FINISHED' },
      {
        attempts: 1,
        removeOnComplete: 50,
        removeOnFail: 100,
        jobId: `scorecard-scan_${Date.now()}`,
      },
    );
    return { mode: 'SCAN_FINISHED', jobId: job.id };
  }
}

import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Redis } from 'ioredis';

import { PrismaService } from '../../prisma/prisma.service.js';

type DependencyStatus = 'ok' | 'error' | 'skipped';

export interface HealthDependencySnapshot {
  status: DependencyStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthSnapshot {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  uptimeSec: number;
  dependencies: {
    database: HealthDependencySnapshot;
    redis: HealthDependencySnapshot;
  };
}

@Injectable()
export class HealthService {
  private readonly version = process.env.APP_VERSION ?? '0.0.1';

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async snapshot(): Promise<HealthSnapshot> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    return {
      status: database.status === 'ok' && redis.status === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: this.version,
      uptimeSec: Math.round(process.uptime()),
      dependencies: { database, redis },
    };
  }

  private async checkDatabase(): Promise<HealthDependencySnapshot> {
    if (!this.prisma) return { status: 'skipped', message: 'PrismaService is not available' };

    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async checkRedis(): Promise<HealthDependencySnapshot> {
    const startedAt = Date.now();
    const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      enableReadyCheck: true,
    });
    client.on('error', () => undefined);

    try {
      await client.connect();
      await client.ping();
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      client.disconnect();
    }
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

import type { ActivityConfigUpsertDto } from './activity.schemas.js';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicConfig(key: string) {
    const config = await this.prisma.activityConfig.findUnique({ where: { key } });
    if (!config || config.status !== ActivityStatus.ACTIVE || !this.isWithinWindow(config.startsAt, config.endsAt)) {
      throw new NotFoundException('活动未开放');
    }
    return this.toPayload(config);
  }

  async listAdminConfigs(type?: string) {
    const configs = await this.prisma.activityConfig.findMany({
      where: type ? { type } : undefined,
      orderBy: { updatedAt: 'desc' },
    });
    return configs.map((config) => this.toPayload(config));
  }

  async upsertConfig(dto: ActivityConfigUpsertDto) {
    const saved = await this.prisma.activityConfig.upsert({
      where: { key: dto.key },
      create: {
        key: dto.key,
        type: dto.type,
        title: dto.title,
        status: ActivityStatus[dto.status],
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
      },
      update: {
        type: dto.type,
        title: dto.title,
        status: ActivityStatus[dto.status],
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        config: (dto.config ?? {}) as Prisma.InputJsonValue,
      },
    });
    return this.toPayload(saved);
  }

  private isWithinWindow(startsAt: Date | null, endsAt: Date | null): boolean {
    const now = Date.now();
    if (startsAt && startsAt.getTime() > now) return false;
    if (endsAt && endsAt.getTime() < now) return false;
    return true;
  }

  private toPayload(config: {
    id: string;
    key: string;
    type: string;
    title: string;
    status: ActivityStatus;
    startsAt: Date | null;
    endsAt: Date | null;
    config: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: config.id,
      key: config.key,
      type: config.type,
      title: config.title,
      status: config.status,
      startsAt: config.startsAt?.toISOString() ?? null,
      endsAt: config.endsAt?.toISOString() ?? null,
      config: config.config,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
}

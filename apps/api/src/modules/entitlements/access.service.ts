import { Injectable, Logger } from '@nestjs/common';
import type { Entitlement, EntitlementSource, User } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * 权益判断结果
 */
export interface AccessDecision {
  /** 是否允许查看完整 AI 模型分析 */
  canViewFullModels: boolean;
  /** 拒绝原因 */
  reason: AccessDenyReason | null;
  /** 当前权益快照 */
  snapshot: EntitlementSnapshot;
  /** 解锁引导类型（前端据此展示不同弹窗） */
  unlockHint: UnlockHint | null;
}

export type AccessDenyReason =
  | 'NO_SESSION'
  | 'FREE_QUOTA_EXHAUSTED'
  | 'NEED_CONSUME'
  | 'PASS_EXPIRED'
  | 'LOGIN_REQUIRED';

export type UnlockHint =
  | 'LOGIN_TO_GET_FREE'
  | 'INVITE_FRIENDS'
  | 'BUY_PASS'
  | 'CONSUME_FREE'
  | 'CONSUME_INVITE'
  | null;

export interface EntitlementSnapshot {
  freeDailyRemaining: number;
  freeDailyMax: number;
  inviteRewardRemaining: number;
  isPassActive: boolean;
  passExpiresAt: string | null;
  passTier: string | null;
  todayInviteRewardsGranted: number;
  maxDailyInviteRewards: number;
}

/** 业务常量 */
const FREE_DAILY_MAX_GUEST = 1;
const FREE_DAILY_MAX_USER = 3;
const MAX_DAILY_INVITE_REWARDS = 3;

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 核心权益判断：根据用户/游客身份判断是否可查看完整模型分析。
   * 判断优先级：Pass 会员 > 邀请奖励 > 每日免费额度
   */
  async checkAccess(
    userId?: string,
    guestId?: string,
    matchId?: string,
  ): Promise<AccessDecision> {
    // 无任何身份标识
    if (!userId && !guestId) {
      return {
        canViewFullModels: false,
        reason: 'NO_SESSION',
        snapshot: this.emptySnapshot(),
        unlockHint: 'LOGIN_TO_GET_FREE',
      };
    }

    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    // 注册用户
    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return {
          canViewFullModels: false,
          reason: 'NO_SESSION',
          snapshot: this.emptySnapshot(),
          unlockHint: 'LOGIN_TO_GET_FREE',
        };
      }

      if (matchId && await this.hasMatchUnlock(matchId, userId, null)) {
        const snapshot = await this.buildUserSnapshot(user, todayKey);
        return {
          canViewFullModels: true,
          reason: null,
          snapshot,
          unlockHint: null,
        };
      }

      // 1. Pass 会员判断
      if (user.isPassActive && user.passExpiresAt && user.passExpiresAt > now) {
        const snapshot = await this.buildUserSnapshot(user, todayKey);
        return {
          canViewFullModels: true,
          reason: null,
          snapshot,
          unlockHint: null,
        };
      }

      const shouldRequireExplicitMatchUnlock = Boolean(matchId);

      // 2. 每日免费额度判断
      const freeEntitlements = await this.getActiveEntitlements(
        userId,
        null,
        'FREE_DAILY',
        now,
      );
      const freeRemaining = this.sumRemaining(freeEntitlements);
      if (freeRemaining > 0) {
        const snapshot = await this.buildUserSnapshot(user, todayKey);
        return {
          canViewFullModels: !shouldRequireExplicitMatchUnlock,
          reason: shouldRequireExplicitMatchUnlock ? 'NEED_CONSUME' : null,
          snapshot,
          unlockHint: shouldRequireExplicitMatchUnlock ? 'CONSUME_FREE' : null,
        };
      }

      // 3. 邀请奖励判断
      const inviteEntitlements = await this.getActiveEntitlements(
        userId,
        null,
        'INVITE_REWARD',
        now,
      );
      const inviteRemaining = this.sumRemaining(inviteEntitlements);
      if (inviteRemaining > 0) {
        const snapshot = await this.buildUserSnapshot(user, todayKey);
        return {
          canViewFullModels: !shouldRequireExplicitMatchUnlock,
          reason: shouldRequireExplicitMatchUnlock ? 'NEED_CONSUME' : null,
          snapshot,
          unlockHint: shouldRequireExplicitMatchUnlock ? 'CONSUME_INVITE' : null,
        };
      }

      // 额度用完
      const snapshot = await this.buildUserSnapshot(user, todayKey);
      return {
        canViewFullModels: false,
        reason: 'FREE_QUOTA_EXHAUSTED',
        snapshot,
        unlockHint: inviteRemaining === 0 ? 'INVITE_FRIENDS' : 'BUY_PASS',
      };
    }

    // 游客
    if (guestId) {
      const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
      if (!guest) {
        return {
          canViewFullModels: false,
          reason: 'NO_SESSION',
          snapshot: this.emptySnapshot(),
          unlockHint: 'LOGIN_TO_GET_FREE',
        };
      }

      if (matchId && await this.hasMatchUnlock(matchId, null, guestId)) {
        const snapshot = {
          freeDailyRemaining: Math.max(0, FREE_DAILY_MAX_GUEST - (guest.freeResetDate === todayKey ? guest.freeUsedToday : 0)),
          freeDailyMax: FREE_DAILY_MAX_GUEST,
          inviteRewardRemaining: 0,
          isPassActive: false,
          passExpiresAt: null,
          passTier: null,
          todayInviteRewardsGranted: 0,
          maxDailyInviteRewards: MAX_DAILY_INVITE_REWARDS,
        };
        return {
          canViewFullModels: true,
          reason: null,
          snapshot,
          unlockHint: null,
        };
      }

      // 游客每日免费次数（通过 Guest 表的 freeUsedToday 字段快速判断）
      const usedToday = guest.freeResetDate === todayKey ? guest.freeUsedToday : 0;
      const freeRemaining = Math.max(0, FREE_DAILY_MAX_GUEST - usedToday);

      const snapshot: EntitlementSnapshot = {
        freeDailyRemaining: freeRemaining,
        freeDailyMax: FREE_DAILY_MAX_GUEST,
        inviteRewardRemaining: 0,
        isPassActive: false,
        passExpiresAt: null,
        passTier: null,
        todayInviteRewardsGranted: 0,
        maxDailyInviteRewards: MAX_DAILY_INVITE_REWARDS,
      };

      if (freeRemaining > 0) {
        return {
          canViewFullModels: !matchId,
          reason: matchId ? 'NEED_CONSUME' : null,
          snapshot,
          unlockHint: matchId ? 'CONSUME_FREE' : null,
        };
      }

      return {
        canViewFullModels: false,
        reason: 'FREE_QUOTA_EXHAUSTED',
        snapshot,
        unlockHint: 'LOGIN_TO_GET_FREE',
      };
    }

    return {
      canViewFullModels: false,
      reason: 'NO_SESSION',
      snapshot: this.emptySnapshot(),
      unlockHint: 'LOGIN_TO_GET_FREE',
    };
  }

  /**
   * 消费一次权益（查看模型分析时调用）。
   * 优先消费免费额度，再消费邀请奖励。Pass 会员不消费次数。
   */
  async consumeOne(userId?: string, guestId?: string, matchId?: string): Promise<boolean> {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return false;

      if (matchId && await this.hasMatchUnlock(matchId, userId, null)) {
        return true;
      }

      // Pass 会员无限制
      if (user.isPassActive && user.passExpiresAt && user.passExpiresAt > now) {
        if (matchId) {
          const passEntitlement = await this.prisma.entitlement.findFirst({
            where: { userId, source: 'PASS_SUBSCRIPTION', status: 'ACTIVE', validFrom: { lte: now }, validUntil: { gte: now } },
            orderBy: { validUntil: 'desc' },
          });
          await this.createMatchUnlock(matchId, userId, null, 'PASS_SUBSCRIPTION', passEntitlement?.id);
        }
        return true;
      }

      // 消费免费额度
      const freeEntitlement = await this.prisma.entitlement.findFirst({
        where: {
          userId,
          source: 'FREE_DAILY',
          status: 'ACTIVE',
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
        orderBy: { validUntil: 'asc' },
      });

      if (freeEntitlement && freeEntitlement.usedCount < freeEntitlement.maxCount) {
        await this.prisma.$transaction(async (tx) => {
          await tx.entitlement.update({
            where: { id: freeEntitlement.id },
            data: {
              usedCount: { increment: 1 },
              ...(freeEntitlement.usedCount + 1 >= freeEntitlement.maxCount
                ? { status: 'CONSUMED' }
                : {}),
            },
          });
          if (matchId) {
            await tx.matchUnlock.upsert({
              where: { matchId_userId: { matchId, userId } },
              update: { entitlementId: freeEntitlement.id, source: 'FREE_DAILY' },
              create: { matchId, userId, entitlementId: freeEntitlement.id, source: 'FREE_DAILY' },
            });
          }
        });
        return true;
      }

      // 消费邀请奖励
      const inviteEntitlement = await this.prisma.entitlement.findFirst({
        where: {
          userId,
          source: 'INVITE_REWARD',
          status: 'ACTIVE',
          validFrom: { lte: now },
          validUntil: { gte: now },
        },
        orderBy: { validUntil: 'asc' },
      });

      if (inviteEntitlement && inviteEntitlement.usedCount < inviteEntitlement.maxCount) {
        await this.prisma.$transaction(async (tx) => {
          await tx.entitlement.update({
            where: { id: inviteEntitlement.id },
            data: {
              usedCount: { increment: 1 },
              ...(inviteEntitlement.usedCount + 1 >= inviteEntitlement.maxCount
                ? { status: 'CONSUMED' }
                : {}),
            },
          });
          if (matchId) {
            await tx.matchUnlock.upsert({
              where: { matchId_userId: { matchId, userId } },
              update: { entitlementId: inviteEntitlement.id, source: 'INVITE_REWARD' },
              create: { matchId, userId, entitlementId: inviteEntitlement.id, source: 'INVITE_REWARD' },
            });
          }
        });
        return true;
      }

      return false;
    }

    // 游客消费
    if (guestId) {
      const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
      if (!guest) return false;

      if (matchId && await this.hasMatchUnlock(matchId, null, guestId)) {
        return true;
      }

      const usedToday = guest.freeResetDate === todayKey ? guest.freeUsedToday : 0;
      if (usedToday >= FREE_DAILY_MAX_GUEST) return false;

      await this.prisma.$transaction(async (tx) => {
        await tx.guest.update({
          where: { id: guestId },
          data: {
            freeUsedToday: usedToday + 1,
            freeResetDate: todayKey,
          },
        });
        if (matchId) {
          await tx.matchUnlock.upsert({
            where: { matchId_guestId: { matchId, guestId } },
            update: { source: 'FREE_DAILY' },
            create: { matchId, guestId, source: 'FREE_DAILY' },
          });
        }
      });
      return true;
    }

    return false;
  }

  /**
   * 获取权益快照（供前端展示）
   */
  async getSnapshot(userId?: string, guestId?: string): Promise<EntitlementSnapshot> {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    if (userId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) return this.emptySnapshot();
      return this.buildUserSnapshot(user, todayKey);
    }

    if (guestId) {
      const guest = await this.prisma.guest.findUnique({ where: { id: guestId } });
      if (!guest) return this.emptySnapshot();

      const usedToday = guest.freeResetDate === todayKey ? guest.freeUsedToday : 0;
      return {
        freeDailyRemaining: Math.max(0, FREE_DAILY_MAX_GUEST - usedToday),
        freeDailyMax: FREE_DAILY_MAX_GUEST,
        inviteRewardRemaining: 0,
        isPassActive: false,
        passExpiresAt: null,
        passTier: null,
        todayInviteRewardsGranted: 0,
        maxDailyInviteRewards: MAX_DAILY_INVITE_REWARDS,
      };
    }

    return this.emptySnapshot();
  }

  /**
   * 为用户发放每日免费权益（如果今天尚未发放）
   */
  async ensureDailyFreeEntitlement(userId: string): Promise<void> {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);
    const todayEnd = new Date(`${todayKey}T23:59:59.999Z`);

    const existing = await this.prisma.entitlement.findFirst({
      where: {
        userId,
        source: 'FREE_DAILY',
        validFrom: { gte: todayStart },
        validUntil: { lte: new Date(`${todayKey}T23:59:59.999Z`) },
      },
    });

    if (!existing) {
      await this.prisma.entitlement.create({
        data: {
          userId,
          source: 'FREE_DAILY',
          status: 'ACTIVE',
          validFrom: todayStart,
          validUntil: todayEnd,
          maxCount: FREE_DAILY_MAX_USER,
          usedCount: 0,
          description: `每日免费额度 ${todayKey}`,
        },
      });
      this.logger.debug(`Granted daily free entitlement to user ${userId}`);
    }
  }

  /**
   * 发放邀请奖励权益
   */
  async grantInviteReward(
    userId: string,
    invitationId: string,
  ): Promise<{ granted: boolean; reason?: string }> {
    const todayKey = new Date().toISOString().slice(0, 10);

    // 检查今日已发放的邀请奖励数
    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);
    const todayRewards = await this.prisma.entitlement.count({
      where: {
        userId,
        source: 'INVITE_REWARD',
        createdAt: { gte: todayStart },
      },
    });

    if (todayRewards >= MAX_DAILY_INVITE_REWARDS) {
      return { granted: false, reason: 'DAILY_INVITE_REWARD_LIMIT_REACHED' };
    }

    // 发放 5 次额度的邀请奖励，有效期 7 天
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7);

    await this.prisma.entitlement.create({
      data: {
        userId,
        source: 'INVITE_REWARD',
        status: 'ACTIVE',
        validFrom: new Date(),
        validUntil,
        maxCount: 5,
        usedCount: 0,
        invitationId,
        description: `邀请奖励 - 邀请码 ${invitationId}`,
      },
    });

    return { granted: true };
  }

  /**
   * 发放 Pass 会员权益（支付成功后调用）
   */
  async grantPassEntitlement(
    userId: string,
    orderId: string,
    passTier: string,
    passDays: number,
  ): Promise<void> {
    const now = new Date();
    const validUntil = new Date(now.getTime() + passDays * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      // 创建权益记录
      await tx.entitlement.create({
        data: {
          userId,
          source: 'PASS_SUBSCRIPTION',
          status: 'ACTIVE',
          validFrom: now,
          validUntil,
          maxCount: 0, // 0 表示无限制
          usedCount: 0,
          orderId,
          description: `World Cup Pass ${passTier} - ${passDays}天`,
        },
      });

      // 更新用户 Pass 状态
      await tx.user.update({
        where: { id: userId },
        data: {
          isPassActive: true,
          passExpiresAt: validUntil,
          passTier: passTier as 'TIER_1' | 'TIER_2' | 'TIER_3',
        },
      });
    });

    this.logger.log(
      `Granted Pass ${passTier} to user ${userId}, expires ${validUntil.toISOString()}`,
    );
  }

  private async hasMatchUnlock(matchId: string, userId?: string | null, guestId?: string | null): Promise<boolean> {
    if (!userId && !guestId) return false;
    const existing = await this.prisma.matchUnlock.findFirst({
      where: {
        matchId,
        ...(userId ? { userId } : { guestId }),
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private async createMatchUnlock(
    matchId: string,
    userId: string | null,
    guestId: string | null,
    source: EntitlementSource,
    entitlementId?: string,
  ): Promise<void> {
    if (userId) {
      await this.prisma.matchUnlock.upsert({
        where: { matchId_userId: { matchId, userId } },
        update: { source, entitlementId: entitlementId ?? null },
        create: { matchId, userId, source, entitlementId: entitlementId ?? null },
      });
      return;
    }

    if (guestId) {
      await this.prisma.matchUnlock.upsert({
        where: { matchId_guestId: { matchId, guestId } },
        update: { source, entitlementId: entitlementId ?? null },
        create: { matchId, guestId, source, entitlementId: entitlementId ?? null },
      });
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async getActiveEntitlements(
    userId: string | null,
    guestId: string | null,
    source: string,
    now: Date,
  ): Promise<Entitlement[]> {
    return this.prisma.entitlement.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(guestId ? { guestId } : {}),
        source: source as EntitlementSource,
        status: 'ACTIVE',
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
      orderBy: { validUntil: 'asc' },
    });
  }

  private sumRemaining(entitlements: Entitlement[]): number {
    return entitlements.reduce((sum, e) => {
      if (e.maxCount === 0) return sum + 999; // 无限制
      return sum + Math.max(0, e.maxCount - e.usedCount);
    }, 0);
  }

  private async buildUserSnapshot(
    user: User,
    todayKey: string,
  ): Promise<EntitlementSnapshot> {
    const now = new Date();

    // 确保今日免费权益已发放
    await this.ensureDailyFreeEntitlement(user.id);

    const freeEntitlements = await this.getActiveEntitlements(
      user.id,
      null,
      'FREE_DAILY',
      now,
    );
    const inviteEntitlements = await this.getActiveEntitlements(
      user.id,
      null,
      'INVITE_REWARD',
      now,
    );

    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);
    const todayInviteRewardsGranted = await this.prisma.entitlement.count({
      where: {
        userId: user.id,
        source: 'INVITE_REWARD',
        createdAt: { gte: todayStart },
      },
    });

    return {
      freeDailyRemaining: this.sumRemaining(freeEntitlements),
      freeDailyMax: FREE_DAILY_MAX_USER,
      inviteRewardRemaining: this.sumRemaining(inviteEntitlements),
      isPassActive: user.isPassActive && !!user.passExpiresAt && user.passExpiresAt > now,
      passExpiresAt: user.passExpiresAt?.toISOString() ?? null,
      passTier: user.passTier,
      todayInviteRewardsGranted,
      maxDailyInviteRewards: MAX_DAILY_INVITE_REWARDS,
    };
  }

  private emptySnapshot(): EntitlementSnapshot {
    return {
      freeDailyRemaining: 0,
      freeDailyMax: FREE_DAILY_MAX_GUEST,
      inviteRewardRemaining: 0,
      isPassActive: false,
      passExpiresAt: null,
      passTier: null,
      todayInviteRewardsGranted: 0,
      maxDailyInviteRewards: MAX_DAILY_INVITE_REWARDS,
    };
  }
}

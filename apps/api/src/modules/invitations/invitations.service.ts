import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessService } from '../entitlements/access.service.js';

/** 每日最多获得的邀请奖励数 */
const MAX_DAILY_INVITE_REWARDS = 3;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * 获取或创建用户的固定邀请码（每用户唯一，永久有效）。
   * 首次调用自动生成，后续调用直接返回已有的码。
   */
  async getOrCreateMyCode(userId: string): Promise<{
    code: string;
    shareUrl: string;
  }> {
    // 先查询用户是否已有固定邀请码
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { inviteCode: true },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (user.inviteCode) {
      // 已有固定码，直接返回
      return {
        code: user.inviteCode,
        shareUrl: `/invite/${user.inviteCode}`,
      };
    }

    // 首次生成固定码（带重试防碰撞）
    const maxAttempts = 10;
    let code: string | undefined;
    for (let attempts = 0; attempts < maxAttempts; attempts++) {
      const candidate = this.createUniqueCode();
      const existing = await this.prisma.user.findUnique({ where: { inviteCode: candidate } });
      if (!existing) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new BadRequestException('生成邀请码失败，请重试');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { inviteCode: code },
    });

    this.logger.log(`Generated fixed invite code ${code} for user ${userId}`);

    return {
      code,
      shareUrl: `/invite/${code}`,
    };
  }

  /**
   * 接受邀请码（被邀请人调用）。
   * 固定码逻辑：通过 inviteCode 找到邀请人，创建一条新的邀请记录。
   * 每个用户只能被邀请一次（inviteeId 唯一约束保证）。
   */
  async acceptInvitation(
    code: string,
    inviteeId: string,
  ): Promise<{
    success: boolean;
    message: string;
    rewardGranted: boolean;
  }> {
    // 通过固定码找到邀请人
    const inviter = await this.prisma.user.findUnique({
      where: { inviteCode: code },
      select: { id: true },
    });

    if (!inviter) {
      throw new BadRequestException('邀请码不存在或已失效');
    }

    if (inviter.id === inviteeId) {
      throw new BadRequestException('不能使用自己的邀请码');
    }

    // 检查被邀请人是否已经使用过邀请码（inviteeId 全局唯一）
    const existingAccepted = await this.prisma.invitation.findFirst({
      where: { inviteeId },
    });
    if (existingAccepted) {
      throw new BadRequestException('你已经使用过邀请码了');
    }

    // 执行接受操作（事务）
    const result = await this.prisma.$transaction(async (tx) => {
      // 创建一条新的邀请记录
      const invitation = await tx.invitation.create({
        data: {
          inviterId: inviter.id,
          code,
          inviteeId,
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });

      // 发放邀请奖励给邀请人
      const rewardResult = await this.accessService.grantInviteReward(
        inviter.id,
        invitation.id,
      );

      if (rewardResult.granted) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { rewardGranted: true },
        });
      }

      // 同时给被邀请人也发放奖励
      await this.accessService.grantInviteReward(inviteeId, invitation.id);

      return { rewardGranted: rewardResult.granted, reason: rewardResult.reason };
    });

    this.logger.log(
      `Fixed invite code ${code} accepted by user ${inviteeId}, inviter reward granted: ${result.rewardGranted}`,
    );

    return {
      success: true,
      message: result.rewardGranted
        ? '邀请成功！双方各获得 1 次免费解锁'
        : `邀请成功！${result.reason === 'DAILY_INVITE_REWARD_LIMIT_REACHED' ? '邀请人今日奖励已达上限' : ''}`,
      rewardGranted: result.rewardGranted,
    };
  }

  /**
   * 获取用户的邀请统计和历史
   */
  async getMyInvitations(userId: string) {
    // 确保用户有固定邀请码
    const { code } = await this.getOrCreateMyCode(userId);

    const invitations = await this.prisma.invitation.findMany({
      where: { inviterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const todayKey = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(`${todayKey}T00:00:00.000Z`);

    const todayRewardsGranted = await this.prisma.entitlement.count({
      where: {
        userId,
        source: 'INVITE_REWARD',
        createdAt: { gte: todayStart },
      },
    });

    return {
      myCode: code,
      shareUrl: `/invite/${code}`,
      invitations: invitations.map((inv) => ({
        id: inv.id,
        code: inv.code,
        status: inv.status,
        inviteeId: inv.inviteeId,
        acceptedAt: inv.acceptedAt?.toISOString() ?? null,
        rewardGranted: inv.rewardGranted,
        createdAt: inv.createdAt.toISOString(),
      })),
      stats: {
        totalAccepted: invitations.filter((i) => i.status === 'ACCEPTED').length,
        todayRewardsGranted,
        maxDailyRewards: MAX_DAILY_INVITE_REWARDS,
        remainingTodayRewards: Math.max(0, MAX_DAILY_INVITE_REWARDS - todayRewardsGranted),
      },
    };
  }

  /**
   * 验证邀请码是否有效（不消费，仅查询）
   */
  async validateCode(code: string): Promise<{
    valid: boolean;
    inviterNickname: string | null;
  }> {
    const inviter = await this.prisma.user.findUnique({
      where: { inviteCode: code },
      select: { nickname: true },
    });

    if (!inviter) {
      return { valid: false, inviterNickname: null };
    }

    return {
      valid: true,
      inviterNickname: inviter.nickname,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private createUniqueCode(): string {
    // 生成 8 位大写字母+数字的邀请码
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易混淆的字符
    const bytes = randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[bytes[i]! % chars.length];
    }
    return code;
  }
}

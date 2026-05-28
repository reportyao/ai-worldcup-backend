import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessService } from '../entitlements/access.service.js';

/** 邀请码有效期（天） */
const INVITATION_EXPIRY_DAYS = 30;
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
   * 为用户生成邀请码。每个用户可以有多个有效邀请码。
   */
  async generateInviteCode(userId: string): Promise<{
    code: string;
    expiresAt: string;
    shareUrl: string;
  }> {
    const code = this.createUniqueCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    await this.prisma.invitation.create({
      data: {
        inviterId: userId,
        code,
        status: 'PENDING',
        expiresAt,
      },
    });

    this.logger.log(`Generated invite code ${code} for user ${userId}`);

    return {
      code,
      expiresAt: expiresAt.toISOString(),
      shareUrl: `/invite/${code}`,
    };
  }

  /**
   * 接受邀请码（被邀请人调用）。
   * 归因逻辑：记录被邀请人，发放邀请奖励给邀请人。
   */
  async acceptInvitation(
    code: string,
    inviteeId: string,
  ): Promise<{
    success: boolean;
    message: string;
    rewardGranted: boolean;
  }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { code },
    });

    if (!invitation) {
      throw new NotFoundException('邀请码不存在');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(
        invitation.status === 'ACCEPTED'
          ? '该邀请码已被使用'
          : '该邀请码已过期',
      );
    }

    if (new Date() > invitation.expiresAt) {
      // 标记过期
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('该邀请码已过期');
    }

    if (invitation.inviterId === inviteeId) {
      throw new BadRequestException('不能使用自己的邀请码');
    }

    // 检查被邀请人是否已经使用过邀请码
    const existingAccepted = await this.prisma.invitation.findFirst({
      where: { inviteeId, status: 'ACCEPTED' },
    });
    if (existingAccepted) {
      throw new BadRequestException('你已经使用过邀请码了');
    }

    // 执行接受操作（事务）
    const result = await this.prisma.$transaction(async (tx) => {
      // 更新邀请记录
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          inviteeId,
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });

      // 尝试发放邀请奖励给邀请人
      const rewardResult = await this.accessService.grantInviteReward(
        invitation.inviterId,
        invitation.id,
      );

      if (rewardResult.granted) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { rewardGranted: true },
        });
      }

      return { rewardGranted: rewardResult.granted, reason: rewardResult.reason };
    });

    this.logger.log(
      `Invitation ${code} accepted by user ${inviteeId}, reward granted: ${result.rewardGranted}`,
    );

    return {
      success: true,
      message: result.rewardGranted
        ? '邀请码使用成功！邀请人已获得奖励'
        : `邀请码使用成功！${result.reason === 'DAILY_INVITE_REWARD_LIMIT_REACHED' ? '邀请人今日奖励已达上限' : ''}`,
      rewardGranted: result.rewardGranted,
    };
  }

  /**
   * 获取用户的邀请列表
   */
  async getMyInvitations(userId: string) {
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
      invitations: invitations.map((inv) => ({
        id: inv.id,
        code: inv.code,
        status: inv.status,
        inviteeId: inv.inviteeId,
        expiresAt: inv.expiresAt.toISOString(),
        acceptedAt: inv.acceptedAt?.toISOString() ?? null,
        rewardGranted: inv.rewardGranted,
        createdAt: inv.createdAt.toISOString(),
      })),
      stats: {
        totalSent: invitations.length,
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
    expiresAt: string | null;
  }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { code },
      include: { inviter: { select: { nickname: true } } },
    });

    if (!invitation || invitation.status !== 'PENDING' || new Date() > invitation.expiresAt) {
      return { valid: false, inviterNickname: null, expiresAt: null };
    }

    return {
      valid: true,
      inviterNickname: invitation.inviter.nickname,
      expiresAt: invitation.expiresAt.toISOString(),
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

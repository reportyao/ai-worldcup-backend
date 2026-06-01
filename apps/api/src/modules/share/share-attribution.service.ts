import { randomBytes, createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * T6-02: 小程序码与分享归因服务
 *
 * 职责：
 * 1. 生成带归因信息的小程序码 scene 值
 * 2. 创建分享追踪记录
 * 3. 新用户注册时绑定邀请归因
 * 4. 统计分享效果
 */
@Injectable()
export class ShareAttributionService {
  private readonly logger = new Logger(ShareAttributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成分享追踪记录并返回小程序码 scene 值
   * scene 值最长 32 字符（微信限制）
   */
  async createShareTrack(params: {
    userId?: string;
    guestId?: string;
    matchId?: string;
    targetType?: string;
    targetId?: string;
    channel?: string;
    templateType?: string;
    inviteCode?: string;
  }): Promise<{
    id: string;
    sceneValue: string;
    shareUrl: string;
    inviteCode: string | null;
  }> {
    const { userId, guestId, matchId, targetType, targetId, channel, templateType, inviteCode } = params;

    // 生成唯一 scene 值（最长 32 字符）
    const sceneValue = this.generateSceneValue(userId ?? guestId ?? 'anon', targetId ?? matchId);

    const track = await this.prisma.shareTrack.create({
      data: {
        userId,
        guestId,
        matchId,
        targetType,
        targetId,
        channel: channel ?? 'WECHAT_MINIPROGRAM',
        templateType: templateType ?? (targetType ? targetType.toUpperCase() : 'PREDICTION'),
        inviteCode,
        sceneValue,
        shareUrl: this.buildShareUrl(sceneValue, matchId, targetType, targetId),
      },
    });

    this.logger.log(
      `Share track created: ${track.id}, scene=${sceneValue}, user=${userId ?? guestId ?? 'anon'}`,
    );

    return {
      id: track.id,
      sceneValue,
      shareUrl: track.shareUrl!,
      inviteCode: inviteCode ?? null,
    };
  }

  /**
   * 获取小程序码（调用微信接口或返回已缓存的）
   * 注意：实际生产中需要调用微信 API 生成小程序码
   * 此处提供接口结构，实际调用需要配置 WECHAT_APP_ID 和 WECHAT_APP_SECRET
   */
  async getWxacode(params: {
    scene: string;
    page?: string;
    width?: number;
    envVersion?: 'release' | 'trial' | 'develop';
  }): Promise<{
    imageBuffer: Buffer | null;
    imageUrl: string;
    scene: string;
  }> {
    const { scene, page, width, envVersion } = params;

    // 检查是否已有缓存
    const existing = await this.prisma.shareTrack.findUnique({
      where: { sceneValue: scene },
    });

    if (existing?.qrcodeUrl) {
      return {
        imageBuffer: null,
        imageUrl: existing.qrcodeUrl,
        scene,
      };
    }

    // 尝试调用微信接口生成小程序码
    const appId = process.env.WECHAT_APP_ID;
    const appSecret = process.env.WECHAT_APP_SECRET;

    let imageUrl = '';
    let imageBuffer: Buffer | null = null;

    if (appId && appSecret) {
      try {
        // 获取 access_token
        const tokenRes = await fetch(
          `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`,
        );
        const tokenData = (await tokenRes.json()) as { access_token?: string; errmsg?: string };

        if (tokenData.access_token) {
          // 生成小程序码（getUnlimited 接口，scene 最长 32 字符）
          const wxaRes = await fetch(
            `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${tokenData.access_token}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scene,
                page: page ?? 'pages/index/index',
                width: width ?? 430,
                env_version: envVersion ?? 'release',
                auto_color: false,
                line_color: { r: 11, g: 95, b: 255 },
                is_hyaline: false,
              }),
            },
          );

          const contentType = wxaRes.headers.get('content-type') ?? '';
          if (contentType.includes('image')) {
            imageBuffer = Buffer.from(await wxaRes.arrayBuffer());
            // 实际生产中应上传到 OSS 并返回 CDN URL
            imageUrl = `/share/wxacode/${scene}`;
          } else {
            const errData = (await wxaRes.json()) as { errmsg?: string };
            this.logger.warn(`WeChat wxacode API error: ${errData.errmsg}`);
          }
        }
      } catch (err) {
        this.logger.error(`Failed to generate wxacode: ${(err as Error).message}`);
      }
    }

    // 如果微信接口不可用，生成占位 URL
    if (!imageUrl) {
      imageUrl = `/share/wxacode/${scene}?placeholder=true`;
    }

    // 更新记录
    if (existing) {
      await this.prisma.shareTrack.update({
        where: { id: existing.id },
        data: { qrcodeUrl: imageUrl },
      });
    }

    return { imageBuffer, imageUrl, scene };
  }

  /**
   * 新用户通过分享链接/小程序码注册时，绑定归因关系
   * 在 AuthService 的注册流程中调用
   */
  async bindAttribution(params: {
    newUserId: string;
    sceneValue?: string;
    inviteCode?: string;
    channel?: string;
  }): Promise<{
    bound: boolean;
    inviterUserId: string | null;
    rewardGranted: boolean;
    message: string;
  }> {
    const { newUserId, sceneValue, inviteCode, channel } = params;

    // 检查是否已绑定
    const existing = await this.prisma.shareAttribution.findUnique({
      where: { newUserId },
    });
    if (existing) {
      return {
        bound: false,
        inviterUserId: existing.inviterUserId,
        rewardGranted: existing.rewardGranted,
        message: '已绑定过归因关系',
      };
    }

    // 通过 scene 值找到分享追踪记录
    let shareTrack = sceneValue
      ? await this.prisma.shareTrack.findUnique({ where: { sceneValue } })
      : null;

    // 如果没有 scene 但有邀请码，通过邀请码找
    if (!shareTrack && inviteCode) {
      shareTrack = await this.prisma.shareTrack.findFirst({
        where: { inviteCode },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!shareTrack) {
      // 没有可归因的分享记录，但如果有邀请码，仍然可以走邀请流程
      if (inviteCode) {
        return {
          bound: false,
          inviterUserId: null,
          rewardGranted: false,
          message: '未找到分享记录，请通过邀请码接受邀请',
        };
      }
      return {
        bound: false,
        inviterUserId: null,
        rewardGranted: false,
        message: '无归因信息',
      };
    }

    const inviterUserId = shareTrack.userId;

    // 防止自己邀请自己
    if (inviterUserId === newUserId) {
      return {
        bound: false,
        inviterUserId: null,
        rewardGranted: false,
        message: '不能归因到自己',
      };
    }

    // 创建归因记录并更新分享追踪
    await this.prisma.$transaction(async (tx) => {
      const attr = await tx.shareAttribution.create({
        data: {
          shareTrackId: shareTrack!.id,
          newUserId,
          inviterUserId,
          inviteCode: shareTrack!.inviteCode,
          sceneValue: shareTrack!.sceneValue,
          channel: channel ?? shareTrack!.channel,
        },
      });

      // 更新分享追踪的绑定计数
      await tx.shareTrack.update({
        where: { id: shareTrack!.id },
        data: { bindCount: { increment: 1 } },
      });

      return attr;
    });

    this.logger.log(
      `Attribution bound: new user ${newUserId} -> inviter ${inviterUserId}, track ${shareTrack.id}`,
    );

    return {
      bound: true,
      inviterUserId,
      rewardGranted: false, // 奖励通过 InvitationsService 发放
      message: '归因绑定成功',
    };
  }

  /**
   * 记录分享浏览（scene 被扫描时调用）
   */
  async recordView(sceneValue: string, viewerFingerprint?: string): Promise<{ counted: boolean }> {
    const track = await this.prisma.shareTrack.findUnique({
      where: { sceneValue },
    });
    if (!track) return { counted: false };

    const windowKey = new Date().toISOString().slice(0, 10);
    const viewerHash = this.hashViewer(`${sceneValue}:${viewerFingerprint ?? 'anonymous'}`);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.shareViewEvent.create({
          data: {
            shareTrackId: track.id,
            viewerHash,
            windowKey,
          },
        });
        await tx.shareTrack.update({
          where: { id: track.id },
          data: { viewCount: { increment: 1 } },
        });
      });
      return { counted: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { counted: false };
      }
      throw error;
    }
  }

  /**
   * 获取用户的分享统计
   */
  async getUserShareStats(userId: string): Promise<{
    totalShares: number;
    totalViews: number;
    totalBinds: number;
    recentShares: Array<{
      id: string;
      matchId: string | null;
      templateType: string;
      channel: string;
      viewCount: number;
      bindCount: number;
      createdAt: string;
    }>;
  }> {
    const tracks = await this.prisma.shareTrack.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const totalShares = tracks.length;
    const totalViews = tracks.reduce((sum, t) => sum + t.viewCount, 0);
    const totalBinds = tracks.reduce((sum, t) => sum + t.bindCount, 0);

    return {
      totalShares,
      totalViews,
      totalBinds,
      recentShares: tracks.map((t) => ({
        id: t.id,
        matchId: t.matchId,
        templateType: t.templateType,
        channel: t.channel,
        viewCount: t.viewCount,
        bindCount: t.bindCount,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  /**
   * 生成 scene 值（最长 32 字符，微信限制）
   * 格式：{type}{hash} 例如 "s_a1b2c3d4e5f6"
   * 使用随机字节确保唯一性
   */
  private generateSceneValue(identifier: string, matchId?: string): string {
    const raw = `${identifier}:${matchId ?? ''}:${Date.now()}:${randomBytes(8).toString('hex')}`;
    const hash = createHash('sha256').update(raw).digest('hex').slice(0, 24);
    return `s_${hash}`;
  }

  /**
   * 构建分享 URL
   */
  private buildShareUrl(sceneValue: string, matchId?: string, targetType?: string, targetId?: string): string {
    const baseUrl = process.env.H5_BASE_URL ?? 'https://h5.example.com';
    if (targetType && targetId) {
      return `${baseUrl}/share/${targetType}/${targetId}?scene=${sceneValue}`;
    }
    if (matchId) {
      return `${baseUrl}/share/${matchId}?scene=${sceneValue}`;
    }
    return `${baseUrl}/share?scene=${sceneValue}`;
  }

  private hashViewer(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

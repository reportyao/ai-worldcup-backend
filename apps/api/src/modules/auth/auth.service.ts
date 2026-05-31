import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Guest, Locale, User } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service.js';
import { InvitationsService } from '../invitations/invitations.service.js';

import type { GuestIdentifyDto, WechatLoginDto } from './auth.schemas.js';

interface TokenPayload {
  sub: string;
  typ: 'guest' | 'user';
  iat: number;
}

interface WechatSession {
  openid: string;
  unionid?: string;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  /** 分享归因 scene，用于后续将登录用户与分享链路绑定。 */
  shareScene?: string;
  /** 邀请码，用于后续将登录用户与邀请链路绑定。 */
  inviteCode?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly invitationsService: InvitationsService,
  ) {}

  async identifyGuest(dto: GuestIdentifyDto, meta: RequestMeta) {
    const guest = await this.prisma.guest.upsert({
      where: { fingerprint: dto.fingerprint },
      create: {
        fingerprint: dto.fingerprint,
        userAgent: dto.userAgent ?? meta.userAgent,
        ipAddress: meta.ipAddress,
        locale: dto.locale as Locale,
        freeResetDate: this.todayKey(),
      },
      update: {
        userAgent: dto.userAgent ?? meta.userAgent,
        locale: dto.locale as Locale,
      },
    });

    return {
      guest: this.toGuestProfile(guest),
      guestToken: this.signToken({ sub: guest.id, typ: 'guest', iat: Date.now() }),
    };
  }

  async loginWithWechat(dto: WechatLoginDto, meta: RequestMeta) {
    const guestId = dto.guestToken ? this.verifyToken(dto.guestToken, 'guest').sub : undefined;
    const wechatSession = await this.resolveWechatSession(dto.code);

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { wechatOpenId: wechatSession.openid } });
      const savedUser = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              unionId: existing.unionId ?? wechatSession.unionid,
              nickname: dto.nickname ?? existing.nickname,
              avatarUrl: dto.avatarUrl ?? existing.avatarUrl,
              locale: dto.locale as Locale,
              ...(guestId && !existing.guestId ? { guestId } : {}),
            },
          })
        : await tx.user.create({
            data: {
              wechatOpenId: wechatSession.openid,
              unionId: wechatSession.unionid,
              nickname: dto.nickname ?? '微信用户',
              avatarUrl: dto.avatarUrl,
              locale: dto.locale as Locale,
              timezone: 'Asia/Shanghai',
              guestId,
            },
          });

      if (guestId) {
        await this.mergeGuestDataIntoUser(tx, guestId, savedUser.id, meta);
      }

      return savedUser;
    });

    // ─── 邀请码自动绑定逻辑 ───
    // 如果登录元数据中携带了邀请码，且用户是新用户（或者尚未被邀请过），自动尝试绑定
    if (meta.inviteCode) {
      try {
        await this.invitationsService.acceptInvitation(meta.inviteCode, user.id);
        this.logger.log(`Auto-bound invite code ${meta.inviteCode} for user ${user.id} during login`);
      } catch (err) {
        // 自动绑定失败不影响登录流程，可能是已绑定过或邀请码无效
        this.logger.debug(`Auto-bind invite code failed: ${(err as Error).message}`);
      }
    }

    return {
      user: this.toUserProfile(user),
      accessToken: this.signToken({ sub: user.id, typ: 'user', iat: Date.now() }),
      mergedGuestId: guestId ?? null,
    };
  }

  async resolveViewer(accessToken?: string, guestToken?: string) {
    if (accessToken) {
      const payload = this.verifyToken(accessToken, 'user');
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException('User session is invalid');
      return { userId: user.id, guestId: user.guestId ?? undefined, user };
    }

    if (guestToken) {
      const payload = this.verifyToken(guestToken, 'guest');
      const guest = await this.prisma.guest.findUnique({ where: { id: payload.sub } });
      if (!guest) throw new UnauthorizedException('Guest session is invalid');
      return { guestId: guest.id, guest };
    }

    return {};
  }

  async getMe(accessToken?: string, guestToken?: string) {
    const viewer = await this.resolveViewer(accessToken, guestToken);
    return {
      user: viewer.user ? this.toUserProfile(viewer.user) : null,
      guest: viewer.guest ? this.toGuestProfile(viewer.guest) : null,
    };
  }

  extractBearerToken(value?: string): string | undefined {
    if (!value) return undefined;
    const [scheme, token] = value.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
    return token;
  }

  private async mergeGuestDataIntoUser(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    guestId: string,
    userId: string,
    meta: RequestMeta,
  ) {
    const guestPredictions = await tx.userPrediction.findMany({ where: { guestId } });

    for (const prediction of guestPredictions) {
      const existingUserPrediction = await tx.userPrediction.findUnique({
        where: { matchId_userId: { matchId: prediction.matchId, userId } },
      });

      if (existingUserPrediction) {
        await tx.userPrediction.update({
          where: { id: existingUserPrediction.id },
          data: {
            prediction: prediction.prediction,
            homeScore: prediction.homeScore,
            awayScore: prediction.awayScore,
            goalsMin: prediction.goalsMin,
            goalsMax: prediction.goalsMax,
            clientRequestId: prediction.clientRequestId,
            ipAddress: meta.ipAddress ?? prediction.ipAddress,
            userAgent: meta.userAgent ?? prediction.userAgent,
            submittedAt: prediction.submittedAt,
          },
        });
        await tx.userPrediction.delete({ where: { id: prediction.id } });
      } else {
        await tx.userPrediction.update({
          where: { id: prediction.id },
          data: { userId, guestId: null },
        });
      }
    }

    await tx.entitlement.updateMany({
      where: { guestId, userId: null },
      data: { userId, guestId: null },
    });
  }

  private async resolveWechatSession(code: string): Promise<WechatSession> {
    const appId = this.configService.get<string>('WECHAT_APP_ID');
    const appSecret = this.configService.get<string>('WECHAT_APP_SECRET');
    const shouldMock = !appId || !appSecret || code.startsWith('mock-') || code.startsWith('demo-');

    if (shouldMock) {
      return { openid: `mock_${this.shortHash(code)}`, unionid: `mock_union_${this.shortHash(`union:${code}`)}` };
    }

    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    const response = await fetch(url);
    const json = (await response.json()) as { openid?: string; unionid?: string; errmsg?: string };
    if (!response.ok || !json.openid) {
      throw new UnauthorizedException(json.errmsg ?? 'WeChat login failed');
    }
    return { openid: json.openid, unionid: json.unionid };
  }

  private signToken(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifyToken(token: string, expectedType: TokenPayload['typ']): TokenPayload {
    const [body, signature] = token.split('.');
    if (!body || !signature) throw new UnauthorizedException('Invalid session token');
    const expected = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    if (!this.safeEqual(signature, expected)) throw new UnauthorizedException('Invalid session signature');

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (payload.typ !== expectedType || !payload.sub) throw new UnauthorizedException('Invalid session type');
    return payload;
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private tokenSecret(): string {
    return this.configService.get<string>('JWT_SECRET') ?? this.configService.get<string>('SESSION_SECRET') ?? 'ai-worldcup-dev-session-secret';
  }

  private shortHash(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private toGuestProfile(guest: Guest) {
    return {
      id: guest.id,
      fingerprint: guest.fingerprint,
      locale: guest.locale,
      freeUsedToday: guest.freeUsedToday,
      freeResetDate: guest.freeResetDate,
      createdAt: guest.createdAt.toISOString(),
    };
  }

  private toUserProfile(user: User) {
    return {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      timezone: user.timezone,
      isPassActive: user.isPassActive,
      passExpiresAt: user.passExpiresAt?.toISOString() ?? null,
      passTier: user.passTier,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

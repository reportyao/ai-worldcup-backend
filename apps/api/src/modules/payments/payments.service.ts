import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDecipheriv, createHash, createHmac, createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessService } from '../entitlements/access.service.js';

/** Pass 定价（分） */
const PASS_TIER_PRICE_CNY: Record<string, number> = {
  TIER_1: 6900, // ¥69.00 全赛季通行证
  TIER_2: 3900, // ¥39.00 月度通行证
  TIER_3: 1900, // ¥19.00 周通行证
};

/** Pass 有效天数 */
const PASS_TIER_DAYS: Record<string, number> = {
  TIER_1: 90,
  TIER_2: 30,
  TIER_3: 7,
};

export interface CreateOrderDto {
  passTier: string;
  channel?: string;
}

export interface WechatNotifyPayload {
  id: string;
  create_time: string;
  resource_type: string;
  event_type: string;
  summary: string;
  resource: {
    original_type: string;
    algorithm: string;
    ciphertext: string;
    associated_data: string;
    nonce: string;
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * T5-04: 创建预支付订单
   */
  async createOrder(userId: string, dto: CreateOrderDto) {
    const passTier = dto.passTier;
    if (!PASS_TIER_PRICE_CNY[passTier]) {
      throw new BadRequestException(`无效的 Pass 等级: ${passTier}`);
    }

    const amountCents = PASS_TIER_PRICE_CNY[passTier]!;
    const passDays = PASS_TIER_DAYS[passTier]!;
    const channel = dto.channel ?? 'WECHAT_PAY';

    // 创建订单记录
    const order = await this.prisma.order.create({
      data: {
        userId,
        channel: channel as 'WECHAT_PAY' | 'STRIPE',
        amountCents,
        currency: 'CNY',
        status: 'CREATED',
        passTier: passTier as 'TIER_1' | 'TIER_2' | 'TIER_3',
        passDays,
        metadata: {
          createdVia: 'api',
          clientTime: new Date().toISOString(),
        },
      },
    });

    this.logger.log(
      `Order ${order.id} created for user ${userId}, tier=${passTier}, amount=${amountCents}`,
    );

    // 调用微信支付统一下单
    if (channel === 'WECHAT_PAY') {
      const prepayResult = await this.createWechatPrepayOrder(order.id, userId, amountCents);
      return {
        orderId: order.id,
        channel,
        amountCents,
        currency: 'CNY',
        passTier,
        passDays,
        status: order.status,
        wechatPay: prepayResult,
      };
    }

    // Stripe 预留
    return {
      orderId: order.id,
      channel,
      amountCents,
      currency: 'CNY',
      passTier,
      passDays,
      status: order.status,
      wechatPay: null,
    };
  }

  /**
   * T5-05: 微信支付回调处理
   */
  async handleWechatNotify(payload: WechatNotifyPayload): Promise<{ success: boolean }> {
    this.logger.log(`Received WeChat Pay notification: ${payload.event_type}`);

    if (payload.event_type !== 'TRANSACTION.SUCCESS') {
      this.logger.warn(`Ignoring non-success event: ${payload.event_type}`);
      return { success: true };
    }

    // 解密回调数据
    const decrypted = this.decryptWechatResource(payload.resource);
    if (!decrypted) {
      this.logger.error('Failed to decrypt WeChat Pay notification');
      return { success: false };
    }

    const { out_trade_no, transaction_id, trade_state } = decrypted as {
      out_trade_no: string;
      transaction_id: string;
      trade_state: string;
    };

    if (trade_state !== 'SUCCESS') {
      this.logger.warn(`Trade state is not SUCCESS: ${trade_state}`);
      return { success: true };
    }

    // 查找订单
    const order = await this.prisma.order.findUnique({
      where: { id: out_trade_no },
    });

    if (!order) {
      this.logger.error(`Order not found: ${out_trade_no}`);
      return { success: false };
    }

    if (order.status === 'PAID') {
      this.logger.warn(`Order ${order.id} already paid, skipping`);
      return { success: true };
    }

    if (order.status !== 'CREATED') {
      this.logger.warn(`Order ${order.id} in unexpected status: ${order.status}`);
      return { success: false };
    }

    // 执行支付成功处理（事务）
    await this.prisma.$transaction(async (tx) => {
      // 更新订单状态
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PAID',
          externalOrderId: transaction_id,
          paidAt: new Date(),
        },
      });
    });

    // 发放会员权益（在事务外执行，避免长事务）
    await this.accessService.grantPassEntitlement(
      order.userId,
      order.id,
      order.passTier!,
      order.passDays!,
    );

    this.logger.log(
      `Order ${order.id} paid successfully, Pass granted to user ${order.userId}`,
    );

    return { success: true };
  }

  /**
   * 模拟支付成功（开发环境用）
   */
  async mockPaymentSuccess(orderId: string): Promise<{ success: boolean; message: string }> {
    const isDev = this.configService.get<string>('NODE_ENV') !== 'production';
    if (!isDev) {
      throw new BadRequestException('Mock payment is only available in development');
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status !== 'CREATED') {
      throw new BadRequestException(`订单状态异常: ${order.status}`);
    }

    // 更新订单状态
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        externalOrderId: `mock_${randomUUID()}`,
        paidAt: new Date(),
      },
    });

    // 发放会员权益
    await this.accessService.grantPassEntitlement(
      order.userId,
      order.id,
      order.passTier!,
      order.passDays!,
    );

    return { success: true, message: `订单 ${orderId} 模拟支付成功，会员已发放` };
  }

  /**
   * 获取用户订单列表
   */
  async getUserOrders(userId: string, page = 1, pageSize = 20) {
    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((order) => ({
        id: order.id,
        channel: order.channel,
        amountCents: order.amountCents,
        currency: order.currency,
        status: order.status,
        passTier: order.passTier,
        passDays: order.passDays,
        paidAt: order.paidAt?.toISOString() ?? null,
        failureReason: order.failureReason,
        createdAt: order.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取单个订单详情
   */
  async getOrderDetail(orderId: string, userId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.userId !== userId) throw new UnauthorizedException('无权查看此订单');

    return {
      id: order.id,
      userId: order.userId,
      channel: order.channel,
      amountCents: order.amountCents,
      currency: order.currency,
      status: order.status,
      passTier: order.passTier,
      passDays: order.passDays,
      externalOrderId: order.externalOrderId,
      paidAt: order.paidAt?.toISOString() ?? null,
      canceledAt: order.canceledAt?.toISOString() ?? null,
      refundedAt: order.refundedAt?.toISOString() ?? null,
      failureReason: order.failureReason,
      metadata: order.metadata,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  /**
   * 取消订单
   */
  async cancelOrder(orderId: string, userId: string): Promise<{ success: boolean }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.userId !== userId) throw new UnauthorizedException('无权操作此订单');
    if (order.status !== 'CREATED') {
      throw new BadRequestException('只能取消未支付的订单');
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });

    return { success: true };
  }

  // ─── Admin Methods ─────────────────────────────────────────────────────────

  /**
   * 后台获取所有订单列表
   */
  async adminListOrders(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    userId?: string;
    channel?: string;
  }) {
    const { page = 1, pageSize = 20, status, userId, channel } = params;
    const where = {
      ...(status ? { status: status as any } : {}),
      ...(userId ? { userId } : {}),
      ...(channel ? { channel: channel as any } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true, wechatOpenId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((order) => ({
        id: order.id,
        userId: order.userId,
        userNickname: order.user.nickname,
        channel: order.channel,
        amountCents: order.amountCents,
        currency: order.currency,
        status: order.status,
        passTier: order.passTier,
        passDays: order.passDays,
        externalOrderId: order.externalOrderId,
        paidAt: order.paidAt?.toISOString() ?? null,
        failureReason: order.failureReason,
        createdAt: order.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  // ─── WeChat Pay V3 Helpers ───────────────────────────────────────────────────

  private async createWechatPrepayOrder(
    orderId: string,
    userId: string,
    amountCents: number,
  ): Promise<{
    prepayId: string | null;
    paySign: string | null;
    timeStamp: string;
    nonceStr: string;
    packageStr: string;
    signType: string;
  } | null> {
    const mchId = this.configService.get<string>('WECHAT_PAY_MCHID');
    const appId = this.configService.get<string>('WECHAT_MP_APPID');
    const apiV3Key = this.configService.get<string>('WECHAT_PAY_API_V3_KEY');
    const serialNo = this.configService.get<string>('WECHAT_PAY_SERIAL_NO');
    const privateKeyPath = this.configService.get<string>('WECHAT_PAY_PRIVATE_KEY_PATH');
    const notifyUrl = this.configService.get<string>('WECHAT_PAY_NOTIFY_URL');

    // 开发环境下返回 mock 数据
    if (!mchId || !appId || !apiV3Key) {
      this.logger.warn('WeChat Pay not configured, returning mock prepay data');
      const timeStamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = randomUUID().replace(/-/g, '').slice(0, 32);
      return {
        prepayId: `mock_prepay_${orderId}`,
        paySign: `mock_sign_${orderId}`,
        timeStamp,
        nonceStr,
        packageStr: `prepay_id=mock_prepay_${orderId}`,
        signType: 'RSA',
      };
    }

    // 获取用户的 openId
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wechatOpenId: true },
    });

    if (!user?.wechatOpenId) {
      throw new BadRequestException('用户未绑定微信，无法使用微信支付');
    }

    // 构建统一下单请求
    const requestBody = {
      appid: appId,
      mchid: mchId,
      description: 'AI World Cup Pass',
      out_trade_no: orderId,
      notify_url: notifyUrl ?? `${this.configService.get<string>('PUBLIC_BASE_URL')}/payments/wechat/notify`,
      amount: {
        total: amountCents,
        currency: 'CNY',
      },
      payer: {
        openid: user.wechatOpenId,
      },
    };

    try {
      const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonceStr = randomUUID().replace(/-/g, '').slice(0, 32);
      const bodyStr = JSON.stringify(requestBody);

      // 生成签名
      const signMessage = `POST\n/v3/pay/transactions/jsapi\n${timestamp}\n${nonceStr}\n${bodyStr}\n`;
      const privateKey = readFileSync(privateKeyPath ?? './secrets/wechatpay/apiclient_key.pem', 'utf8');
      const sign = createSign('RSA-SHA256');
      sign.update(signMessage);
      const signature = sign.sign(privateKey, 'base64');

      const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authorization,
        },
        body: bodyStr,
      });

      const result = (await response.json()) as { prepay_id?: string; code?: string; message?: string };

      if (!response.ok || !result.prepay_id) {
        this.logger.error(`WeChat prepay failed: ${result.code} - ${result.message}`);
        await this.prisma.order.update({
          where: { id: orderId },
          data: {
            status: 'FAILED',
            failureReason: `WeChat prepay failed: ${result.message ?? 'unknown'}`,
          },
        });
        throw new BadRequestException(`微信支付下单失败: ${result.message ?? '未知错误'}`);
      }

      // 生成小程序调起支付的签名
      const payTimestamp = Math.floor(Date.now() / 1000).toString();
      const payNonceStr = randomUUID().replace(/-/g, '').slice(0, 32);
      const packageStr = `prepay_id=${result.prepay_id}`;
      const paySignMessage = `${appId}\n${payTimestamp}\n${payNonceStr}\n${packageStr}\n`;
      const paySign = createSign('RSA-SHA256');
      paySign.update(paySignMessage);
      const paySignature = paySign.sign(privateKey, 'base64');

      return {
        prepayId: result.prepay_id,
        paySign: paySignature,
        timeStamp: payTimestamp,
        nonceStr: payNonceStr,
        packageStr,
        signType: 'RSA',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`WeChat prepay request failed: ${error}`);
      throw new BadRequestException('微信支付下单请求失败');
    }
  }

  private decryptWechatResource(resource: WechatNotifyPayload['resource']): unknown | null {
    const apiV3Key = this.configService.get<string>('WECHAT_PAY_API_V3_KEY');

    // 开发环境下，如果没有配置 API key，尝试解析 mock 数据
    if (!apiV3Key) {
      this.logger.warn('WECHAT_PAY_API_V3_KEY not configured, attempting mock decrypt');
      try {
        // Mock 模式下 ciphertext 直接是 base64 编码的 JSON
        const decoded = Buffer.from(resource.ciphertext, 'base64').toString('utf8');
        return JSON.parse(decoded);
      } catch {
        return null;
      }
    }

    try {
      // AES-256-GCM 解密
      const key = Buffer.from(apiV3Key, 'utf8');
      const nonce = Buffer.from(resource.nonce, 'utf8');
      const associatedData = Buffer.from(resource.associated_data, 'utf8');
      const ciphertext = Buffer.from(resource.ciphertext, 'base64');

      // 最后 16 字节是 auth tag
      const authTag = ciphertext.subarray(ciphertext.length - 16);
      const encrypted = ciphertext.subarray(0, ciphertext.length - 16);

      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(authTag);
      decipher.setAAD(associatedData);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      this.logger.error(`Failed to decrypt WeChat resource: ${error}`);
      return null;
    }
  }
}

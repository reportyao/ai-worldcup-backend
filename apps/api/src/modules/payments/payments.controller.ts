import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from '../auth/auth.service.js';

import { PaymentsService } from './payments.service.js';
import type { CreateOrderDto, WechatNotifyPayload } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly authService: AuthService,
  ) {}

  /**
   * POST /payments/orders
   * 创建预支付订单（需要登录）
   */
  @Post('orders')
  async createOrder(@Req() req: Request, @Body() body: CreateOrderDto) {
    const userId = await this.requireUserId(req);
    return this.paymentsService.createOrder(userId, body);
  }

  /**
   * GET /payments/orders
   * 获取我的订单列表（需要登录）
   */
  @Get('orders')
  async listOrders(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const userId = await this.requireUserId(req);
    return this.paymentsService.getUserOrders(
      userId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  /**
   * GET /payments/orders/:id
   * 获取订单详情（需要登录）
   */
  @Get('orders/:id')
  async getOrder(@Req() req: Request, @Param('id') id: string) {
    const userId = await this.requireUserId(req);
    return this.paymentsService.getOrderDetail(id, userId);
  }

  /**
   * POST /payments/orders/:id/cancel
   * 取消订单（需要登录）
   */
  @Post('orders/:id/cancel')
  async cancelOrder(@Req() req: Request, @Param('id') id: string) {
    const userId = await this.requireUserId(req);
    return this.paymentsService.cancelOrder(id, userId);
  }

  /**
   * POST /payments/orders/:id/mock-pay
   * 模拟支付成功（仅开发环境）
   */
  @Post('orders/:id/mock-pay')
  async mockPay(@Param('id') id: string) {
    return this.paymentsService.mockPaymentSuccess(id);
  }

  /**
   * POST /payments/wechat/notify
   * 微信支付回调通知（无需登录，由微信服务器调用）
   */
  @Post('wechat/notify')
  async wechatNotify(@Body() body: WechatNotifyPayload, @Res() res: Response) {
    try {
      const result = await this.paymentsService.handleWechatNotify(body);
      if (result.success) {
        res.status(200).json({ code: 'SUCCESS', message: '成功' });
      } else {
        res.status(500).json({ code: 'FAIL', message: '处理失败' });
      }
    } catch (error) {
      res.status(500).json({ code: 'FAIL', message: '处理异常' });
    }
  }

  // ─── Admin Endpoints ─────────────────────────────────────────────────────────

  /**
   * GET /payments/admin/orders
   * 后台获取所有订单列表
   */
  @Get('admin/orders')
  async adminListOrders(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('channel') channel?: string,
  ) {
    return this.paymentsService.adminListOrders({
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      status,
      userId,
      channel,
    });
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private async requireUserId(req: Request): Promise<string> {
    const accessToken = this.authService.extractBearerToken(
      req.headers.authorization,
    );
    if (!accessToken) {
      throw new UnauthorizedException('请先登录');
    }
    const viewer = await this.authService.resolveViewer(accessToken);
    if (!viewer.userId) {
      throw new UnauthorizedException('请先登录');
    }
    return viewer.userId;
  }
}

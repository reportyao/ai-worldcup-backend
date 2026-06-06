/**
 * Lindy AI 预测 Controller
 *
 * 提供回调接口（公开，无需 admin 认证）用于接收 Lindy 异步结果。
 * 管理接口通过 AdminController 统一暴露。
 */
import {
  Body,
  Controller,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { LindyPredictionService, type LindyCallbackPayload } from './lindy-prediction.service.js';

@Controller('lindy-prediction')
export class LindyPredictionController {
  private readonly logger = new Logger(LindyPredictionController.name);

  constructor(private readonly lindyService: LindyPredictionService) {}

  /**
   * Lindy 回调接口 - 接收异步预测结果
   * 公开路由，不需要 admin 认证（Lindy 服务器直接调用）
   */
  @Post('callback')
  async handleCallback(
    @Query('taskId') taskId: string,
    @Query('matchId') matchId: string,
    @Query('aiModelId') aiModelId: string,
    @Body() payload: LindyCallbackPayload,
  ) {
    this.logger.log({ taskId, matchId, aiModelId, model: payload.model, status: payload.status }, 'Lindy callback received');

    if (!taskId || !matchId || !aiModelId) {
      return { success: false, message: 'Missing required query parameters: taskId, matchId, aiModelId' };
    }

    const result = await this.lindyService.handleCallback(taskId, matchId, aiModelId, payload);
    return result;
  }
}

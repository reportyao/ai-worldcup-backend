import { Module } from '@nestjs/common';

/**
 * 阶段 0 占位模块：阶段 1 接入微信小程序 wx.login 换取 openid、JWT 签发与刷新。
 * 计划提供：
 *   - POST /auth/wechat/login    使用 code 交换 openid+session_key
 *   - POST /auth/refresh         刷新 access token
 *   - GET  /auth/me              当前用户信息
 */
@Module({})
export class AuthModule {}

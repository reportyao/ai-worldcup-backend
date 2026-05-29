/**
 * T6-02 补充：分享归因与注册流程集成
 *
 * 此文件提供一个轻量工具函数，供 AuthService 在用户注册/登录后调用，
 * 自动检查并绑定分享归因关系。
 *
 * 使用方式：在 AuthService 的 wechatLogin 方法中，
 * 当新用户首次注册时，检查请求中是否携带 scene 或 invite_code 参数，
 * 如果有则调用 ShareAttributionService.bindAttribution。
 *
 * 由于 AuthModule 和 ShareModule 之间存在循环依赖风险，
 * 建议通过事件机制或在 Controller 层协调调用。
 */

/**
 * 从请求 headers 或 body 中提取归因参数
 */
export function extractAttributionParams(headers: Record<string, string | undefined>, body?: Record<string, unknown>): {
  sceneValue?: string;
  inviteCode?: string;
  channel?: string;
} | null {
  const scene = headers['x-share-scene'] ?? (body?.sceneValue as string | undefined);
  const inviteCode = headers['x-invite-code'] ?? (body?.inviteCode as string | undefined);

  if (!scene && !inviteCode) {
    return null;
  }

  return {
    sceneValue: scene ?? undefined,
    inviteCode: inviteCode ?? undefined,
    channel: headers['x-share-channel'] ?? 'WECHAT_MINIPROGRAM',
  };
}

/**
 * 判断是否为新注册用户（用于决定是否触发归因绑定）
 */
export function isNewRegistration(createdAt: Date, thresholdMs: number = 5000): boolean {
  return Date.now() - createdAt.getTime() < thresholdMs;
}

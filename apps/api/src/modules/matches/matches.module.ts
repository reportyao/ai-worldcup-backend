import { Module } from '@nestjs/common';

/**
 * 阶段 0 占位模块：阶段 1 接入第三方足球数据源、维护 Match 列表与详情。
 * 计划提供：
 *   - GET /matches               按日期/状态筛选
 *   - GET /matches/:id           单场详情（含两版本预测可见性）
 */
@Module({})
export class MatchesModule {}

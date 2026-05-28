import { Module } from '@nestjs/common';

/**
 * 阶段 0 占位模块：阶段 1 提供多模型结构化预测的查询接口。
 * 计划提供：
 *   - GET /predictions/by-match/:matchId      返回 24h/2h 两版本聚合
 *   - GET /predictions/:id                    单条原始预测（含 prompt 快照可控暴露）
 *   - GET /predictions/by-match/:matchId/consensus  共识指数
 */
@Module({})
export class PredictionsModule {}

import { PredictionTaskStatus } from '../enums/index.js';

/**
 * 预测任务状态机：所有迁移必须经过此函数校验，避免非法迁移。
 */
const transitions: Record<PredictionTaskStatus, PredictionTaskStatus[]> = {
  [PredictionTaskStatus.PENDING]: [
    PredictionTaskStatus.RUNNING,
    PredictionTaskStatus.FAILED,
  ],
  [PredictionTaskStatus.RUNNING]: [
    PredictionTaskStatus.PARTIAL_SUCCESS,
    PredictionTaskStatus.SUCCEEDED,
    PredictionTaskStatus.FAILED,
  ],
  [PredictionTaskStatus.PARTIAL_SUCCESS]: [
    PredictionTaskStatus.SUCCEEDED,
    PredictionTaskStatus.REVIEWED,
    PredictionTaskStatus.PUBLISHED,
    PredictionTaskStatus.FAILED,
  ],
  [PredictionTaskStatus.SUCCEEDED]: [
    PredictionTaskStatus.REVIEWED,
    PredictionTaskStatus.PUBLISHED,
  ],
  [PredictionTaskStatus.REVIEWED]: [PredictionTaskStatus.PUBLISHED],
  [PredictionTaskStatus.PUBLISHED]: [],
  [PredictionTaskStatus.FAILED]: [PredictionTaskStatus.PENDING],
};

export function canTransitionPredictionTask(
  from: PredictionTaskStatus,
  to: PredictionTaskStatus,
): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function nextAllowedPredictionTaskStatuses(
  from: PredictionTaskStatus,
): PredictionTaskStatus[] {
  return transitions[from] ?? [];
}

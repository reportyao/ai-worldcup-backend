/**
 * BullMQ 队列名称集中定义，前后端共用时通过 shared 包再次导出。
 */
export const QueueName = {
  PredictionGenerator: 'prediction-generator',
  DataSync: 'data-sync',
  PostMatchReview: 'post-match-review',
  ConsensusCalculator: 'consensus-calculator',
  ScorecardUpdate: 'scorecard-update',
  Translation: 'translation',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

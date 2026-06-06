/**
 * BullMQ 队列名称集中定义。
 * 必须与 apps/worker/src/queues.ts 保持同步。
 */
export const QueueName = {
  PredictionGenerator: 'prediction-generator',
  DataSync: 'data-sync',
  PostMatchReview: 'post-match-review',
  ConsensusCalculator: 'consensus-calculator',
  ScorecardUpdate: 'scorecard-update',
  Translation: 'translation',
  FeatureCompute: 'feature-compute',
  SportteryAutoSync: 'sporttery-auto-sync',
  LindyPrediction: 'lindy-prediction',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

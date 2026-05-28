export const QueueName = {
  PredictionGenerator: 'prediction-generator',
  DataSync: 'data-sync',
  PostMatchReview: 'post-match-review',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

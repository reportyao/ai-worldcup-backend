-- Seed Lindy AI models (provider = 'lindy', webhook-based async prediction)
-- These models are called via Lindy webhook and results are received via callback.

INSERT INTO "AiModel" ("id", "modelId", "displayName", "persona", "provider", "isActive", "sortOrder", "description", "config", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'lindy-o3', 'Lindy O3', 'DATA_DRIVEN', 'lindy', true, 90, 'OpenAI o3 深度推理，通过 Lindy webhook 异步调用', '{"type":"lindy-webhook","model":"o3"}', NOW(), NOW()),
  (gen_random_uuid()::text, 'lindy-gpt5_5', 'Lindy GPT-5.5', 'ATTACKING', 'lindy', true, 91, 'GPT-5.5 分析，通过 Lindy webhook 异步调用', '{"type":"lindy-webhook","model":"gpt5_5"}', NOW(), NOW()),
  (gen_random_uuid()::text, 'lindy-claude', 'Lindy Claude', 'STEADY', 'lindy', true, 92, 'Claude 4.7 Opus Thinking，通过 Lindy webhook 异步调用', '{"type":"lindy-webhook","model":"claude"}', NOW(), NOW())
ON CONFLICT ("modelId") DO NOTHING;

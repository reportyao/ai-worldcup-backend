-- Sprint A: 强化模型预测赛后评估与概率评分字段
ALTER TABLE "ModelPrediction"
  ADD COLUMN IF NOT EXISTS "winDrawLossCorrect" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "handicapCorrect" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "overUnderCorrect" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "scoreExact" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "halfFullCorrect" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "goalRangeHit" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "anyHit" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "brierScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "logLoss" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "outcomeProbability" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "actualOutcome" TEXT,
  ADD COLUMN IF NOT EXISTS "evaluationVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "evaluatedAt" TIMESTAMP(3);

ALTER TABLE "ModelScorecard"
  ADD COLUMN IF NOT EXISTS "brierScoreAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "logLossAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "probabilitySamples" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ModelPrediction_evaluatedAt_idx" ON "ModelPrediction"("evaluatedAt");
CREATE INDEX IF NOT EXISTS "ModelPrediction_actualOutcome_idx" ON "ModelPrediction"("actualOutcome");

-- Sprint A: 使用空字符串作为 OVERALL / RECENT_10 的 scopeId 哨兵值，保证复合唯一键 upsert 可幂等执行
UPDATE "ModelScorecard" SET "scopeId" = '' WHERE "scopeId" IS NULL;
ALTER TABLE "ModelScorecard" ALTER COLUMN "scopeId" SET DEFAULT '';
ALTER TABLE "ModelScorecard" ALTER COLUMN "scopeId" SET NOT NULL;

-- Phase 4: Consensus, Post-Match Review, Model Scorecard
-- T4-01: AI Consensus Index (computed into PredictionTask.consensusSummary)
-- T4-03: Post-Match Review per model
-- T4-04: Model Scorecard aggregation

-- ─── Review Status Enum ─────────────────────────────────────────────────────
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'GENERATING', 'PUBLISHED', 'FAILED');

-- ─── ModelReview: 单模型赛后复盘 ─────────────────────────────────────────────
CREATE TABLE "ModelReview" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "aiModelId" TEXT NOT NULL,
    "predictionTaskId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "structuredOutput" JSONB,
    "accuracyJson" JSONB,
    "rawOutput" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelReview_pkey" PRIMARY KEY ("id")
);

-- Each model reviews each match only once
CREATE UNIQUE INDEX "ModelReview_matchId_aiModelId_key" ON "ModelReview"("matchId", "aiModelId");
CREATE INDEX "ModelReview_matchId_status_idx" ON "ModelReview"("matchId", "status");
CREATE INDEX "ModelReview_aiModelId_createdAt_idx" ON "ModelReview"("aiModelId", "createdAt");

ALTER TABLE "ModelReview" ADD CONSTRAINT "ModelReview_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelReview" ADD CONSTRAINT "ModelReview_aiModelId_fkey"
    FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ModelReview" ADD CONSTRAINT "ModelReview_predictionTaskId_fkey"
    FOREIGN KEY ("predictionTaskId") REFERENCES "PredictionTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ModelScorecard: 模型战绩聚合 ───────────────────────────────────────────
-- scope_type: 'OVERALL' | 'COMPETITION' | 'RECENT_10'
-- scope_id: null for OVERALL/RECENT_10, competition_id for COMPETITION
CREATE TABLE "ModelScorecard" (
    "id" TEXT NOT NULL,
    "aiModelId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'OVERALL',
    "scopeId" TEXT,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "winDrawLossCorrect" INTEGER NOT NULL DEFAULT 0,
    "scoreExact" INTEGER NOT NULL DEFAULT 0,
    "goalRangeHit" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recentForm" TEXT,
    "lastMatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelScorecard_pkey" PRIMARY KEY ("id")
);

-- Each model has one scorecard per scope
CREATE UNIQUE INDEX "ModelScorecard_aiModelId_scopeType_scopeId_key" ON "ModelScorecard"("aiModelId", "scopeType", COALESCE("scopeId", '__NULL__'));
CREATE INDEX "ModelScorecard_aiModelId_scopeType_idx" ON "ModelScorecard"("aiModelId", "scopeType");

ALTER TABLE "ModelScorecard" ADD CONSTRAINT "ModelScorecard_aiModelId_fkey"
    FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

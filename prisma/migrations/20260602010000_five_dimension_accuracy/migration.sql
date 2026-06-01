-- Sprint 1: Five-Dimension Accuracy & Half-Time Score
-- Adds half-time scores to Match, expands ModelScorecard with 5-dimension hit tracking

-- 1. Match: Add half-time score fields
ALTER TABLE "Match" ADD COLUMN "homeHalfScore" INTEGER;
ALTER TABLE "Match" ADD COLUMN "awayHalfScore" INTEGER;
ALTER TABLE "Match" ADD COLUMN "handicapLine" DOUBLE PRECISION;
ALTER TABLE "Match" ADD COLUMN "overUnderLine" DOUBLE PRECISION;

-- 2. ModelScorecard: Add 5-dimension hit counters
ALTER TABLE "ModelScorecard" ADD COLUMN "handicapCorrect" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelScorecard" ADD COLUMN "overUnderCorrect" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelScorecard" ADD COLUMN "halfFullCorrect" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelScorecard" ADD COLUMN "anyHit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ModelScorecard" ADD COLUMN "hitRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

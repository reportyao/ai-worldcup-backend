-- Phase 2: guest/user prediction submissions and mergeable ownership.
CREATE TYPE "UserPredictionResult" AS ENUM ('HOME_WIN', 'DRAW', 'AWAY_WIN');

CREATE TABLE "UserPrediction" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "prediction" "UserPredictionResult" NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "goalsMin" INTEGER,
    "goalsMax" INTEGER,
    "clientRequestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPrediction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserPrediction_owner_check" CHECK (("userId" IS NOT NULL) OR ("guestId" IS NOT NULL))
);

CREATE UNIQUE INDEX "UserPrediction_matchId_userId_key" ON "UserPrediction"("matchId", "userId");
CREATE UNIQUE INDEX "UserPrediction_matchId_guestId_key" ON "UserPrediction"("matchId", "guestId");
CREATE INDEX "UserPrediction_matchId_submittedAt_idx" ON "UserPrediction"("matchId", "submittedAt");
CREATE INDEX "UserPrediction_userId_submittedAt_idx" ON "UserPrediction"("userId", "submittedAt");
CREATE INDEX "UserPrediction_guestId_submittedAt_idx" ON "UserPrediction"("guestId", "submittedAt");

ALTER TABLE "UserPrediction" ADD CONSTRAINT "UserPrediction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPrediction" ADD CONSTRAINT "UserPrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserPrediction" ADD CONSTRAINT "UserPrediction_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

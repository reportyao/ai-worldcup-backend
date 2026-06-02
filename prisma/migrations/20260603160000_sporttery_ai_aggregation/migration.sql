-- Add Sporttery official JCTZ football market snapshots for AI aggregation/statistics.
CREATE TABLE IF NOT EXISTS "SportteryMatchMarket" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'sporttery',
    "saleDate" TEXT NOT NULL,
    "matchNo" TEXT NOT NULL,
    "issueNo" TEXT,
    "matchId" TEXT,
    "leagueName" TEXT,
    "homeTeamName" TEXT NOT NULL,
    "awayTeamName" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "handicapLine" DOUBLE PRECISION,
    "overUnderLine" DOUBLE PRECISION,
    "winDrawLoss" TEXT,
    "handicapResult" TEXT,
    "overUnderResult" TEXT,
    "scoreResult" TEXT,
    "halfFullResult" TEXT,
    "rawJson" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportteryMatchMarket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SportteryMatchMarket_provider_saleDate_matchNo_key" ON "SportteryMatchMarket"("provider", "saleDate", "matchNo");
CREATE INDEX IF NOT EXISTS "SportteryMatchMarket_matchId_idx" ON "SportteryMatchMarket"("matchId");
CREATE INDEX IF NOT EXISTS "SportteryMatchMarket_saleDate_kickoffAt_idx" ON "SportteryMatchMarket"("saleDate", "kickoffAt");
CREATE INDEX IF NOT EXISTS "SportteryMatchMarket_provider_syncedAt_idx" ON "SportteryMatchMarket"("provider", "syncedAt");

ALTER TABLE "SportteryMatchMarket" ADD CONSTRAINT "SportteryMatchMarket_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

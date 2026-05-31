-- Migration: Football Data Sync Log
-- Records API-Football ingestion runs, parameters, summaries, and failure details.

CREATE TABLE "FootballDataSyncLog" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'api-football',
  "scope" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "params" JSONB,
  "summary" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FootballDataSyncLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FootballDataSyncLog_provider_scope_startedAt_idx"
  ON "FootballDataSyncLog"("provider", "scope", "startedAt");

CREATE INDEX "FootballDataSyncLog_status_startedAt_idx"
  ON "FootballDataSyncLog"("status", "startedAt");

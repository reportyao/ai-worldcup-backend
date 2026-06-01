-- CreateEnum
CREATE TYPE "CompetitionPriority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- AlterTable: Add priority to Competition
ALTER TABLE "Competition" ADD COLUMN "priority" "CompetitionPriority" NOT NULL DEFAULT 'P2';

-- AlterTable: Add featureSnapshotId to PredictionTask
ALTER TABLE "PredictionTask" ADD COLUMN "featureSnapshotId" TEXT;

-- CreateTable: RawApiResponse
CREATE TABLE "RawApiResponse" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'api-football',
    "endpoint" TEXT NOT NULL,
    "externalId" TEXT,
    "rawJson" JSONB NOT NULL,
    "params" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawApiResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable: MatchFeature
CREATE TABLE "MatchFeature" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "featuresJson" JSONB NOT NULL,
    "summaryText" TEXT,
    "dataQuality" TEXT NOT NULL DEFAULT 'MEDIUM',
    "missingSignals" JSONB DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competition_priority_status_idx" ON "Competition"("priority", "status");

-- CreateIndex
CREATE INDEX "RawApiResponse_provider_endpoint_externalId_idx" ON "RawApiResponse"("provider", "endpoint", "externalId");

-- CreateIndex
CREATE INDEX "RawApiResponse_createdAt_idx" ON "RawApiResponse"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchFeature_matchId_featureVersion_key" ON "MatchFeature"("matchId", "featureVersion");

-- CreateIndex
CREATE INDEX "MatchFeature_matchId_computedAt_idx" ON "MatchFeature"("matchId", "computedAt");

-- CreateIndex
CREATE INDEX "MatchFeature_featureVersion_computedAt_idx" ON "MatchFeature"("featureVersion", "computedAt");

-- AddForeignKey
ALTER TABLE "MatchFeature" ADD CONSTRAINT "MatchFeature_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

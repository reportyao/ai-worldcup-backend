-- Additive migration for activity operation switches and generalized share attribution.
-- Core personality-test and AI PK data models are provided by
-- 20260602010000_personality_ai_pk_foundation.

CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

ALTER TABLE "ShareTrack"
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId" TEXT;

CREATE TABLE "ActivityConfig" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "ActivityStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ActivityConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShareViewEvent" (
  "id" TEXT NOT NULL,
  "shareTrackId" TEXT NOT NULL,
  "viewerHash" TEXT NOT NULL,
  "windowKey" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShareViewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityConfig_key_key" ON "ActivityConfig"("key");
CREATE INDEX "ActivityConfig_type_status_idx" ON "ActivityConfig"("type", "status");
CREATE INDEX "ActivityConfig_status_startsAt_endsAt_idx" ON "ActivityConfig"("status", "startsAt", "endsAt");

CREATE INDEX "ShareTrack_targetType_targetId_idx" ON "ShareTrack"("targetType", "targetId");
CREATE UNIQUE INDEX "ShareViewEvent_shareTrackId_viewerHash_windowKey_key" ON "ShareViewEvent"("shareTrackId", "viewerHash", "windowKey");
CREATE INDEX "ShareViewEvent_shareTrackId_createdAt_idx" ON "ShareViewEvent"("shareTrackId", "createdAt");
CREATE INDEX "ShareViewEvent_viewerHash_createdAt_idx" ON "ShareViewEvent"("viewerHash", "createdAt");

ALTER TABLE "ShareViewEvent" ADD CONSTRAINT "ShareViewEvent_shareTrackId_fkey" FOREIGN KEY ("shareTrackId") REFERENCES "ShareTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

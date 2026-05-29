-- AI prediction prompt templates and match-scoped unlocks
CREATE TYPE "PromptTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "PromptTemplate" (
  "id" TEXT NOT NULL,
  "scene" TEXT NOT NULL DEFAULT 'MATCH_PREDICTION',
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "PromptTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "systemPrompt" TEXT NOT NULL,
  "userPrompt" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromptTemplate_scene_version_key" ON "PromptTemplate"("scene", "version");
CREATE INDEX "PromptTemplate_scene_status_updatedAt_idx" ON "PromptTemplate"("scene", "status", "updatedAt");

CREATE TABLE "MatchUnlock" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT,
  "guestId" TEXT,
  "entitlementId" TEXT,
  "source" "EntitlementSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchUnlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchUnlock_matchId_userId_key" ON "MatchUnlock"("matchId", "userId");
CREATE UNIQUE INDEX "MatchUnlock_matchId_guestId_key" ON "MatchUnlock"("matchId", "guestId");
CREATE INDEX "MatchUnlock_userId_createdAt_idx" ON "MatchUnlock"("userId", "createdAt");
CREATE INDEX "MatchUnlock_guestId_createdAt_idx" ON "MatchUnlock"("guestId", "createdAt");
CREATE INDEX "MatchUnlock_matchId_createdAt_idx" ON "MatchUnlock"("matchId", "createdAt");
CREATE INDEX "MatchUnlock_entitlementId_idx" ON "MatchUnlock"("entitlementId");

ALTER TABLE "MatchUnlock" ADD CONSTRAINT "MatchUnlock_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchUnlock" ADD CONSTRAINT "MatchUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchUnlock" ADD CONSTRAINT "MatchUnlock_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatchUnlock" ADD CONSTRAINT "MatchUnlock_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "Entitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

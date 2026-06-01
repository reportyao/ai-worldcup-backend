-- CreateEnum
CREATE TYPE "PersonalityQuestionType" AS ENUM ('SINGLE_CHOICE');

-- CreateEnum
CREATE TYPE "PersonalityResultEventType" AS ENUM ('VIEW_RESULT', 'CHANGE_SUBTITLE', 'CHANGE_SKIN', 'SAVE_IMAGE', 'SHARE_CLICK', 'CTA_CLICK', 'FRIEND_VOTE');

-- CreateEnum
CREATE TYPE "AiPkPick" AS ENUM ('HOME_WIN', 'DRAW', 'AWAY_WIN');

-- CreateEnum
CREATE TYPE "AiPkSettlementStatus" AS ENUM ('PENDING', 'USER_HIT_AI_MISS', 'USER_MISS_AI_HIT', 'BOTH_HIT', 'BOTH_MISS', 'VOID');

-- CreateEnum
CREATE TYPE "AiPkEventType" AS ENUM ('SAVE_IMAGE', 'SHARE_CLICK', 'CHANGE_REASON', 'CTA_CLICK');

-- CreateTable
CREATE TABLE "PersonalityActivity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityType" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "description" TEXT NOT NULL,
    "traits" JSONB,
    "indices" JSONB,
    "defaultCta" JSONB,
    "rarity" TEXT,
    "themeColor" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalitySubtitle" (
    "id" TEXT NOT NULL,
    "personalityId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scene" TEXT,
    "safetyLevel" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalitySubtitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityQuestion" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "type" "PersonalityQuestionType" NOT NULL DEFAULT 'SINGLE_CHOICE',
    "options" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalityQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityTestResult" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "activityVersion" INTEGER NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "personalityId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "selectedSubtitleId" TEXT,
    "subtitleVersion" INTEGER NOT NULL DEFAULT 1,
    "selectedSkin" TEXT NOT NULL DEFAULT 'CLASSIC_DARK',
    "sameCountSnapshot" INTEGER NOT NULL DEFAULT 0,
    "totalCountSnapshot" INTEGER NOT NULL DEFAULT 0,
    "rarityLabelSnapshot" TEXT,
    "resultSummary" JSONB,
    "inviteCode" TEXT,
    "ownerTokenHash" TEXT,
    "clientRequestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalityTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityResultEvent" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "type" "PersonalityResultEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityResultEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalityFriendVote" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "sceneValue" TEXT,
    "voteType" TEXT NOT NULL,
    "voterUserId" TEXT,
    "voterGuestId" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityFriendVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPkRecord" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "userPick" "AiPkPick" NOT NULL,
    "aiPick" "AiPkPick" NOT NULL,
    "aiConfidence" DOUBLE PRECISION,
    "predictionTaskId" TEXT,
    "aiSummarySnapshot" JSONB,
    "reasonText" TEXT,
    "reasonTemplateCode" TEXT,
    "reasonVersion" INTEGER NOT NULL DEFAULT 1,
    "settlementStatus" "AiPkSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settlementSnapshot" JSONB,
    "settledAt" TIMESTAMP(3),
    "inviteCode" TEXT,
    "ownerTokenHash" TEXT,
    "clientRequestId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPkRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiPkEvent" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "type" "AiPkEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonalityActivity_code_key" ON "PersonalityActivity"("code");
CREATE INDEX "PersonalityActivity_isActive_startsAt_endsAt_idx" ON "PersonalityActivity"("isActive", "startsAt", "endsAt");
CREATE UNIQUE INDEX "PersonalityType_activityId_code_key" ON "PersonalityType"("activityId", "code");
CREATE INDEX "PersonalityType_activityId_isActive_sortOrder_idx" ON "PersonalityType"("activityId", "isActive", "sortOrder");
CREATE INDEX "PersonalitySubtitle_personalityId_isActive_idx" ON "PersonalitySubtitle"("personalityId", "isActive");
CREATE UNIQUE INDEX "PersonalityQuestion_activityId_code_key" ON "PersonalityQuestion"("activityId", "code");
CREATE INDEX "PersonalityQuestion_activityId_isActive_sortOrder_idx" ON "PersonalityQuestion"("activityId", "isActive", "sortOrder");
CREATE INDEX "PersonalityTestResult_activityId_createdAt_idx" ON "PersonalityTestResult"("activityId", "createdAt");
CREATE INDEX "PersonalityTestResult_userId_createdAt_idx" ON "PersonalityTestResult"("userId", "createdAt");
CREATE INDEX "PersonalityTestResult_guestId_createdAt_idx" ON "PersonalityTestResult"("guestId", "createdAt");
CREATE INDEX "PersonalityTestResult_personalityId_createdAt_idx" ON "PersonalityTestResult"("personalityId", "createdAt");
CREATE INDEX "PersonalityTestResult_clientRequestId_idx" ON "PersonalityTestResult"("clientRequestId");
CREATE INDEX "PersonalityResultEvent_resultId_type_createdAt_idx" ON "PersonalityResultEvent"("resultId", "type", "createdAt");
CREATE INDEX "PersonalityResultEvent_type_createdAt_idx" ON "PersonalityResultEvent"("type", "createdAt");
CREATE INDEX "PersonalityFriendVote_resultId_voteType_createdAt_idx" ON "PersonalityFriendVote"("resultId", "voteType", "createdAt");
CREATE INDEX "PersonalityFriendVote_sceneValue_createdAt_idx" ON "PersonalityFriendVote"("sceneValue", "createdAt");
CREATE UNIQUE INDEX "AiPkRecord_matchId_userId_key" ON "AiPkRecord"("matchId", "userId");
CREATE UNIQUE INDEX "AiPkRecord_matchId_guestId_key" ON "AiPkRecord"("matchId", "guestId");
CREATE INDEX "AiPkRecord_matchId_createdAt_idx" ON "AiPkRecord"("matchId", "createdAt");
CREATE INDEX "AiPkRecord_userId_createdAt_idx" ON "AiPkRecord"("userId", "createdAt");
CREATE INDEX "AiPkRecord_guestId_createdAt_idx" ON "AiPkRecord"("guestId", "createdAt");
CREATE INDEX "AiPkRecord_settlementStatus_createdAt_idx" ON "AiPkRecord"("settlementStatus", "createdAt");
CREATE INDEX "AiPkRecord_predictionTaskId_idx" ON "AiPkRecord"("predictionTaskId");
CREATE INDEX "AiPkRecord_clientRequestId_idx" ON "AiPkRecord"("clientRequestId");
CREATE INDEX "AiPkEvent_recordId_type_createdAt_idx" ON "AiPkEvent"("recordId", "type", "createdAt");
CREATE INDEX "AiPkEvent_type_createdAt_idx" ON "AiPkEvent"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "PersonalityType" ADD CONSTRAINT "PersonalityType_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PersonalityActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalitySubtitle" ADD CONSTRAINT "PersonalitySubtitle_personalityId_fkey" FOREIGN KEY ("personalityId") REFERENCES "PersonalityType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalityQuestion" ADD CONSTRAINT "PersonalityQuestion_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PersonalityActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalityTestResult" ADD CONSTRAINT "PersonalityTestResult_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "PersonalityActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonalityTestResult" ADD CONSTRAINT "PersonalityTestResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalityTestResult" ADD CONSTRAINT "PersonalityTestResult_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonalityTestResult" ADD CONSTRAINT "PersonalityTestResult_personalityId_fkey" FOREIGN KEY ("personalityId") REFERENCES "PersonalityType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PersonalityResultEvent" ADD CONSTRAINT "PersonalityResultEvent_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "PersonalityTestResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonalityFriendVote" ADD CONSTRAINT "PersonalityFriendVote_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "PersonalityTestResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPkRecord" ADD CONSTRAINT "AiPkRecord_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiPkRecord" ADD CONSTRAINT "AiPkRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiPkRecord" ADD CONSTRAINT "AiPkRecord_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiPkRecord" ADD CONSTRAINT "AiPkRecord_predictionTaskId_fkey" FOREIGN KEY ("predictionTaskId") REFERENCES "PredictionTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiPkEvent" ADD CONSTRAINT "AiPkEvent_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AiPkRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

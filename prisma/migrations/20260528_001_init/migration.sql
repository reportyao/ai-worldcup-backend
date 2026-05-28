-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('zh_CN', 'en');

-- CreateEnum
CREATE TYPE "CompetitionType" AS ENUM ('WORLD_CUP', 'CONTINENTAL_CUP', 'CITY_LEAGUE', 'OTHER');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PredictionVersion" AS ENUM ('T_MINUS_24H', 'T_MINUS_2H');

-- CreateEnum
CREATE TYPE "PredictionTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'REVIEWED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PredictionTrigger" AS ENUM ('CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "ConsensusLevel" AS ENUM ('HIGH', 'MIXED', 'STRONG_DIVERGENCE');

-- CreateEnum
CREATE TYPE "ModelPersona" AS ENUM ('STEADY', 'ATTACKING', 'UPSET_HUNTER', 'DATA_DRIVEN');

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompetitionType" NOT NULL DEFAULT 'WORLD_CUP',
    "season" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "countryCode" TEXT,
    "crestUrl" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "matchday" TEXT,
    "stage" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "persona" "ModelPersona" NOT NULL DEFAULT 'STEADY',
    "provider" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictionTask" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "version" "PredictionVersion" NOT NULL,
    "status" "PredictionTaskStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "PredictionTrigger" NOT NULL DEFAULT 'CRON',
    "modelCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "consensusLevel" "ConsensusLevel",
    "consensusSummary" JSONB,
    "publishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PredictionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelPrediction" (
    "id" TEXT NOT NULL,
    "predictionTaskId" TEXT NOT NULL,
    "aiModelId" TEXT NOT NULL,
    "structuredOutput" JSONB NOT NULL,
    "rawOutput" TEXT,
    "promptVersion" TEXT,
    "promptSnapshot" TEXT,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "isSuccess" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "wechatOpenId" TEXT,
    "unionId" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'zh_CN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Competition_code_key" ON "Competition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_externalId_key" ON "Competition"("externalId");

-- CreateIndex
CREATE INDEX "Competition_type_season_idx" ON "Competition"("type", "season");

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Team_externalId_key" ON "Team"("externalId");

-- CreateIndex
CREATE INDEX "Team_code_idx" ON "Team"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Match_externalId_key" ON "Match"("externalId");

-- CreateIndex
CREATE INDEX "Match_competitionId_kickoffAt_idx" ON "Match"("competitionId", "kickoffAt");

-- CreateIndex
CREATE INDEX "Match_status_kickoffAt_idx" ON "Match"("status", "kickoffAt");

-- CreateIndex
CREATE INDEX "Match_matchday_idx" ON "Match"("matchday");

-- CreateIndex
CREATE UNIQUE INDEX "Match_competitionId_homeTeamId_awayTeamId_kickoffAt_key" ON "Match"("competitionId", "homeTeamId", "awayTeamId", "kickoffAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_modelId_key" ON "AiModel"("modelId");

-- CreateIndex
CREATE INDEX "AiModel_isActive_persona_idx" ON "AiModel"("isActive", "persona");

-- CreateIndex
CREATE INDEX "PredictionTask_status_createdAt_idx" ON "PredictionTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PredictionTask_matchId_version_status_idx" ON "PredictionTask"("matchId", "version", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PredictionTask_matchId_version_key" ON "PredictionTask"("matchId", "version");

-- CreateIndex
CREATE INDEX "ModelPrediction_predictionTaskId_isSuccess_idx" ON "ModelPrediction"("predictionTaskId", "isSuccess");

-- CreateIndex
CREATE INDEX "ModelPrediction_aiModelId_generatedAt_idx" ON "ModelPrediction"("aiModelId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelPrediction_predictionTaskId_aiModelId_key" ON "ModelPrediction"("predictionTaskId", "aiModelId");

-- CreateIndex
CREATE UNIQUE INDEX "User_wechatOpenId_key" ON "User"("wechatOpenId");

-- CreateIndex
CREATE UNIQUE INDEX "User_unionId_key" ON "User"("unionId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionTask" ADD CONSTRAINT "PredictionTask_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_predictionTaskId_fkey" FOREIGN KEY ("predictionTaskId") REFERENCES "PredictionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "AiModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


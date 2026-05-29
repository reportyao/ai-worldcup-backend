-- T6-02: 小程序码与分享归因
-- T6-04/T6-05: i18n 翻译支持

-- 分享追踪表：记录每次分享行为和归因
CREATE TABLE "ShareTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "matchId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'WECHAT_MINIPROGRAM',
    "templateType" TEXT NOT NULL DEFAULT 'PREDICTION',
    "inviteCode" TEXT,
    "sceneValue" TEXT,
    "shareUrl" TEXT,
    "qrcodeUrl" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "bindCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareTrack_pkey" PRIMARY KEY ("id")
);

-- 分享归因绑定表：新用户通过分享链接注册后的归因记录
CREATE TABLE "ShareAttribution" (
    "id" TEXT NOT NULL,
    "shareTrackId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "inviterUserId" TEXT,
    "inviteCode" TEXT,
    "sceneValue" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'WECHAT_MINIPROGRAM',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rewardGranted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareAttribution_pkey" PRIMARY KEY ("id")
);

-- AI 内容翻译表
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "structuredJson" JSONB,
    "rawText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "errorMessage" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'AUTO',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- 索引
CREATE INDEX "ShareTrack_userId_createdAt_idx" ON "ShareTrack"("userId", "createdAt");
CREATE INDEX "ShareTrack_matchId_idx" ON "ShareTrack"("matchId");
CREATE INDEX "ShareTrack_inviteCode_idx" ON "ShareTrack"("inviteCode");
CREATE INDEX "ShareTrack_sceneValue_idx" ON "ShareTrack"("sceneValue");

CREATE INDEX "ShareAttribution_shareTrackId_idx" ON "ShareAttribution"("shareTrackId");
CREATE INDEX "ShareAttribution_newUserId_idx" ON "ShareAttribution"("newUserId");
CREATE INDEX "ShareAttribution_inviterUserId_idx" ON "ShareAttribution"("inviterUserId");
CREATE UNIQUE INDEX "ShareAttribution_newUserId_key" ON "ShareAttribution"("newUserId");

CREATE UNIQUE INDEX "ContentTranslation_sourceType_sourceId_locale_key" ON "ContentTranslation"("sourceType", "sourceId", "locale");
CREATE INDEX "ContentTranslation_status_idx" ON "ContentTranslation"("status");
CREATE INDEX "ContentTranslation_sourceType_sourceId_idx" ON "ContentTranslation"("sourceType", "sourceId");

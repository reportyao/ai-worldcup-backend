ALTER TABLE "AiModel" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX "AiModel_isActive_sortOrder_idx" ON "AiModel"("isActive", "sortOrder");

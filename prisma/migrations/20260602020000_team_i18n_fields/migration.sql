-- AlterTable: Add nameZh and flagUrl to Team for multilingual support
ALTER TABLE "Team" ADD COLUMN "nameZh" TEXT;
ALTER TABLE "Team" ADD COLUMN "flagUrl" TEXT;

-- Populate nameZh from shortName for existing seed data (shortName was used for Chinese names)
UPDATE "Team" SET "nameZh" = "shortName" WHERE "shortName" IS NOT NULL AND "shortName" != "name";

-- Populate flagUrl using countryCode (flagcdn.com provides free flag images)
UPDATE "Team" SET "flagUrl" = CONCAT('https://flagcdn.com/w80/', LOWER("countryCode"), '.png') WHERE "countryCode" IS NOT NULL;

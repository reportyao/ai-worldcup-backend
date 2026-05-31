-- Migration: Fixed Invite Code
-- 1. Add inviteCode field to User table (unique, nullable)
-- 2. Remove unique constraint on Invitation.code (no longer one-per-code)
-- 3. Remove expiresAt from Invitation (permanent codes don't expire)

-- Add inviteCode to User
ALTER TABLE "User" ADD COLUMN "inviteCode" TEXT;
CREATE UNIQUE INDEX "User_inviteCode_key" ON "User"("inviteCode");

-- Drop old unique index on Invitation.code
DROP INDEX IF EXISTS "Invitation_code_key";

-- Drop expiresAt column from Invitation (fixed codes are permanent)
ALTER TABLE "Invitation" DROP COLUMN IF EXISTS "expiresAt";

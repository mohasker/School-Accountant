-- Daily Telegram digest marker.
ALTER TABLE "User" ADD COLUMN "tgDigestDay" TEXT NOT NULL DEFAULT '';

-- Accounts created with a known initial password must choose their own at the first sign-in.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

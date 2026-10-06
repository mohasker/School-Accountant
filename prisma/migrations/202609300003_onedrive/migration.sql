-- Round 6: the shared archive can keep its files on a OneDrive account (Microsoft Graph).
-- Secrets (client secret, refresh token) are stored encrypted by the application.
ALTER TABLE "Tenant" ADD COLUMN "odClientId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "odSecret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "odAuthority" TEXT NOT NULL DEFAULT 'common';
ALTER TABLE "Tenant" ADD COLUMN "odRefresh" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "odAccount" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "odFolder" TEXT NOT NULL DEFAULT 'MOESAS-Archive';

ALTER TABLE "Archive" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "Archive" ADD COLUMN "storage" TEXT NOT NULL DEFAULT 'DATABASE';
ALTER TABLE "Archive" ADD COLUMN "remoteId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Archive" ADD COLUMN "remoteUrl" TEXT NOT NULL DEFAULT '';

-- Round 7: each school records the account that added it and an optional location (for the nearest school to a sign-in).
ALTER TABLE "School" ADD COLUMN "createdBy" UUID;
ALTER TABLE "School" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN "lng" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing schools: owned by the first accountant working in them (an accountant before the administrator).
UPDATE "School" s SET "createdBy" = (
  SELECT m."userId" FROM "Membership" m JOIN "User" u ON u."id" = m."userId"
  WHERE m."schoolId" = s."id" ORDER BY u."isTenantAdmin" ASC, u."username" ASC LIMIT 1
);
CREATE INDEX "School_createdBy_idx" ON "School"("createdBy");

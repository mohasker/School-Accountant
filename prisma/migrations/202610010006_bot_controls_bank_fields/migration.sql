-- Bot issuing controls and the extra supplier-card fields.
ALTER TABLE "Tenant" ADD COLUMN "tgIssue" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "tgLimit" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierCard" ADD COLUMN "nameEn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierCard" ADD COLUMN "crExpiry" DATE;
ALTER TABLE "SupplierCard" ADD COLUMN "accountsEmail" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierCard" ADD COLUMN "website" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierCard" ADD COLUMN "beneficiary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierCard" ADD COLUMN "ibanVerified" BOOLEAN NOT NULL DEFAULT false;

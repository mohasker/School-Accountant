-- Addressees of certificates, Telegram link, supplier bank cards, and the reference register of earlier certificates.
ALTER TABLE "Tenant" ADD COLUMN "addressees" JSONB NOT NULL DEFAULT '["إدارة الشؤون المالية", "إدارة الخدمات العامة", "إدارة المشتريات والمناقصات"]';
ALTER TABLE "Tenant" ADD COLUMN "tgToken" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "tgOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "tgChatId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "tgCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "tgCodeExp" TIMESTAMP(3);

CREATE TABLE "SupplierCard" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "name" TEXT NOT NULL,
  "legalName" TEXT NOT NULL DEFAULT '', "cr" TEXT NOT NULL DEFAULT '', "iban" TEXT NOT NULL DEFAULT '', "bank" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '', "mobile" TEXT NOT NULL DEFAULT '', "email" TEXT NOT NULL DEFAULT '', "contact" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '', "category" TEXT NOT NULL DEFAULT '', "note" TEXT NOT NULL DEFAULT '', "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupplierCard_tenantId_name_key" ON "SupplierCard"("tenantId", "name");
ALTER TABLE "Supplier" ADD COLUMN "cardId" UUID;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "SupplierCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LegacyCertificate" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "seq" INTEGER NOT NULL, "date" DATE NOT NULL,
  "schoolName" TEXT NOT NULL DEFAULT '', "supplier" TEXT NOT NULL, "orderNo" TEXT NOT NULL DEFAULT '', "invoice" TEXT NOT NULL DEFAULT '',
  "orderValue" DECIMAL(18,2) NOT NULL DEFAULT 0, "orderDate" DATE, "deliveryDate" DATE, "delivered" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "lateDays" INTEGER NOT NULL DEFAULT 0, "finePct" DECIMAL(8,2) NOT NULL DEFAULT 0, "fine" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "net" DECIMAL(18,2) NOT NULL DEFAULT 0, "note" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "LegacyCertificate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyCertificate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LegacyCertificate_tenantId_seq_key" ON "LegacyCertificate"("tenantId", "seq");
CREATE INDEX "LegacyCertificate_tenantId_supplier_idx" ON "LegacyCertificate"("tenantId", "supplier");
CREATE INDEX "LegacyCertificate_tenantId_schoolName_idx" ON "LegacyCertificate"("tenantId", "schoolName");

-- DropIndex
DROP INDEX "Expense_imprestId_invoice_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isTenantAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "orderPrefix" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "groupKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "kgAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nameEn" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "schoolAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sort" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "deliveryDays" INTEGER,
ADD COLUMN     "exclusiveReason" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "policy" JSONB;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "quoteDate" DATE;

-- AlterTable
ALTER TABLE "Certificate" ADD COLUMN     "details" JSONB;

-- AlterTable
ALTER TABLE "Imprest" ADD COLUMN     "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "reference" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "vendor" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "proof" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "coverHtml" TEXT,
ADD COLUMN     "details" JSONB,
ADD COLUMN     "number" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicySetting" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetCatalog" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL DEFAULT '',
    "groupKey" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BudgetCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetPlan" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "schoolBuildings" INTEGER NOT NULL DEFAULT 1,
    "kgBuildings" INTEGER NOT NULL DEFAULT 0,
    "studentsSchool" INTEGER NOT NULL DEFAULT 0,
    "studentsKg" INTEGER NOT NULL DEFAULT 0,
    "teachersSchool" INTEGER NOT NULL DEFAULT 0,
    "teachersKg" INTEGER NOT NULL DEFAULT 0,
    "adminSchool" INTEGER NOT NULL DEFAULT 0,
    "adminKg" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_tenantId_date_key" ON "Holiday"("tenantId", "date");

-- CreateIndex
CREATE INDEX "PolicySetting_tenantId_key_effectiveFrom_idx" ON "PolicySetting"("tenantId", "key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetCatalog_tenantId_code_key" ON "BudgetCatalog"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPlan_schoolId_yearId_key" ON "BudgetPlan"("schoolId", "yearId");

-- CreateIndex
CREATE INDEX "Expense_imprestId_idx" ON "Expense"("imprestId");

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicySetting" ADD CONSTRAINT "PolicySetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetCatalog" ADD CONSTRAINT "BudgetCatalog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_yearId_schoolId_fkey" FOREIGN KEY ("yearId", "schoolId") REFERENCES "FiscalYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- V0 business constraints
ALTER TABLE "Evidence" DROP CONSTRAINT signed_certificate_required;
ALTER TABLE "Evidence" ADD CONSTRAINT signed_certificate_required CHECK ((code IN (13,14) AND "certificateId" IS NOT NULL) OR ((code BETWEEN 1 AND 12 OR code = 15) AND "certificateId" IS NULL));
ALTER TABLE "Budget" ADD CONSTRAINT budget_split_nonnegative CHECK ("schoolAmount" >= 0 AND "kgAmount" >= 0);
ALTER TABLE "Imprest" ADD CONSTRAINT imprest_amount_nonnegative CHECK (amount >= 0);
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_number_positive CHECK (number > 0);
ALTER TABLE "Case" ADD CONSTRAINT case_method_known CHECK (method IS NULL OR method IN ('SINGLE_QUOTE','THREE_QUOTES','EXCLUSIVE','MINISTRY'));
ALTER TABLE "BudgetPlan" ADD CONSTRAINT plan_counts_nonnegative CHECK ("schoolBuildings" >= 0 AND "kgBuildings" >= 0 AND "studentsSchool" >= 0 AND "studentsKg" >= 0 AND "teachersSchool" >= 0 AND "teachersKg" >= 0 AND "adminSchool" >= 0 AND "adminKg" >= 0);
-- Policy history is append-only: a new value is a new row with its own effective date.
CREATE TRIGGER policy_immutable BEFORE UPDATE OR DELETE ON "PolicySetting" FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
-- Tenant-wide settings (holidays, policy, catalog, schools) are audited against the tenant.
ALTER TABLE "Audit" ALTER COLUMN "schoolId" DROP NOT NULL;
ALTER TABLE "Audit" ADD COLUMN "tenantId" UUID;
ALTER TABLE "Audit" ADD CONSTRAINT audit_tenant_fk FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT;
ALTER TABLE "Audit" ADD CONSTRAINT audit_scope CHECK ("schoolId" IS NOT NULL OR "tenantId" IS NOT NULL);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "principal" TEXT NOT NULL,
    "pettyCustodian" TEXT NOT NULL DEFAULT '',
    "educationCustodian" TEXT NOT NULL DEFAULT '',
    "bookCustodian" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "roles" TEXT[],

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "csrf" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cr" TEXT NOT NULL,
    "iban" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "approved" DECIMAL(18,2) NOT NULL,
    "committed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "spent" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'SCHOOL',
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" UUID NOT NULL,
    "accountantName" TEXT NOT NULL,
    "principalName" TEXT NOT NULL,
    "supplierId" UUID,
    "evaluationHtml" TEXT,
    "orderHtml" TEXT,
    "supplierSnapshot" JSONB,
    "selectedQuoteId" UUID,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ministryReference" TEXT,
    "dueDate" DATE,
    "issueDate" DATE,
    "orderNumber" TEXT,
    "evaluationNumber" TEXT,
    "awardReason" TEXT,
    "evaluationBy" UUID,
    "issuedBy" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'عدد',
    "qty" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "acceptedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "acceptedValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "certifiedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "prices" JSONB NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "compliant" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "invoice" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portion" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "received" DECIMAL(12,3) NOT NULL,
    "accepted" DECIMAL(12,3) NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "lateDays" INTEGER NOT NULL,
    "rawFine" DECIMAL(24,6) NOT NULL,
    "certificateId" UUID,

    CONSTRAINT "Portion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "fine" DECIMAL(18,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "coverHtml" TEXT,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "issuedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "data" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedBy" UUID NOT NULL,
    "verifiedBy" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "scanStatus" TEXT NOT NULL DEFAULT 'UNSCANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Erp" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "schoolId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "actor" UUID NOT NULL,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "Erp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "commitment" DECIMAL(18,2) NOT NULL,
    "expense" DECIMAL(18,2) NOT NULL,
    "source" TEXT NOT NULL,
    "actor" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Imprest" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "custodian" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Imprest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "imprestId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "invoice" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "proof" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "settlementId" UUID,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "imprestId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "replenished" BOOLEAN NOT NULL DEFAULT false,
    "erpRef" TEXT,
    "actor" UUID NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "imprestId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "actor" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "actor" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Idempotency" (
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idempotency_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "yearId" UUID NOT NULL,
    "actor" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "School_id_tenantId_key" ON "School"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "School_tenantId_code_key" ON "School"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_schoolId_key" ON "Membership"("userId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_id_schoolId_key" ON "FiscalYear"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_schoolId_label_key" ON "FiscalYear"("schoolId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_schoolId_cr_key" ON "Supplier"("schoolId", "cr");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_id_schoolId_key" ON "Supplier"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_id_schoolId_yearId_key" ON "Budget"("id", "schoolId", "yearId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_schoolId_yearId_code_key" ON "Budget"("schoolId", "yearId", "code");

-- CreateIndex
CREATE INDEX "Case_schoolId_yearId_state_idx" ON "Case"("schoolId", "yearId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Case_id_schoolId_yearId_key" ON "Case"("id", "schoolId", "yearId");

-- CreateIndex
CREATE UNIQUE INDEX "Case_schoolId_yearId_number_key" ON "Case"("schoolId", "yearId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Item_id_caseId_key" ON "Item"("id", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_caseId_supplierId_key" ON "Quote"("caseId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_id_caseId_key" ON "Delivery"("id", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_caseId_note_key" ON "Delivery"("caseId", "note");

-- CreateIndex
CREATE UNIQUE INDEX "Portion_deliveryId_itemId_key" ON "Portion"("deliveryId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_id_caseId_key" ON "Certificate"("id", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_caseId_number_key" ON "Certificate"("caseId", "number");

-- CreateIndex
CREATE INDEX "Evidence_caseId_code_idx" ON "Evidence"("caseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Erp_caseId_key" ON "Erp"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Erp_schoolId_reference_key" ON "Erp"("schoolId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_eventKey_key" ON "Ledger"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "Imprest_id_schoolId_yearId_key" ON "Imprest"("id", "schoolId", "yearId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_imprestId_invoice_key" ON "Expense"("imprestId", "invoice");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_id_imprestId_key" ON "Settlement"("id", "imprestId");

-- CreateIndex
CREATE INDEX "Audit_schoolId_createdAt_idx" ON "Audit"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportRun_schoolId_yearId_createdAt_idx" ON "ReportRun"("schoolId", "yearId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_schoolId_tenantId_fkey" FOREIGN KEY ("schoolId", "tenantId") REFERENCES "School"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_yearId_schoolId_fkey" FOREIGN KEY ("yearId", "schoolId") REFERENCES "FiscalYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_yearId_schoolId_fkey" FOREIGN KEY ("yearId", "schoolId") REFERENCES "FiscalYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_supplierId_schoolId_fkey" FOREIGN KEY ("supplierId", "schoolId") REFERENCES "Supplier"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_caseId_schoolId_yearId_fkey" FOREIGN KEY ("caseId", "schoolId", "yearId") REFERENCES "Case"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_budgetId_schoolId_yearId_fkey" FOREIGN KEY ("budgetId", "schoolId", "yearId") REFERENCES "Budget"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_caseId_schoolId_yearId_fkey" FOREIGN KEY ("caseId", "schoolId", "yearId") REFERENCES "Case"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_supplierId_schoolId_fkey" FOREIGN KEY ("supplierId", "schoolId") REFERENCES "Supplier"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_caseId_schoolId_yearId_fkey" FOREIGN KEY ("caseId", "schoolId", "yearId") REFERENCES "Case"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portion" ADD CONSTRAINT "Portion_deliveryId_caseId_fkey" FOREIGN KEY ("deliveryId", "caseId") REFERENCES "Delivery"("id", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portion" ADD CONSTRAINT "Portion_itemId_caseId_fkey" FOREIGN KEY ("itemId", "caseId") REFERENCES "Item"("id", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portion" ADD CONSTRAINT "Portion_certificateId_caseId_fkey" FOREIGN KEY ("certificateId", "caseId") REFERENCES "Certificate"("id", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Erp" ADD CONSTRAINT "Erp_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Imprest" ADD CONSTRAINT "Imprest_yearId_schoolId_fkey" FOREIGN KEY ("yearId", "schoolId") REFERENCES "FiscalYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_imprestId_schoolId_yearId_fkey" FOREIGN KEY ("imprestId", "schoolId", "yearId") REFERENCES "Imprest"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_budgetId_schoolId_yearId_fkey" FOREIGN KEY ("budgetId", "schoolId", "yearId") REFERENCES "Budget"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_settlementId_imprestId_fkey" FOREIGN KEY ("settlementId", "imprestId") REFERENCES "Settlement"("id", "imprestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_imprestId_fkey" FOREIGN KEY ("imprestId") REFERENCES "Imprest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_imprestId_fkey" FOREIGN KEY ("imprestId") REFERENCES "Imprest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defense-in-depth checks; all financial changes also use serializable application transactions.
ALTER TABLE "Budget" ADD CONSTRAINT budget_nonnegative CHECK (approved >= 0 AND committed >= 0 AND spent >= 0 AND committed + spent <= approved);
ALTER TABLE "FiscalYear" ADD CONSTRAINT year_dates CHECK ("startDate" < "endDate");
ALTER TABLE "Item" ADD CONSTRAINT item_quantities CHECK (qty > 0 AND "acceptedQty" >= 0 AND "acceptedQty" <= qty AND "certifiedQty" >= 0 AND "certifiedQty" <= "acceptedQty" AND "unitPrice" >= 0 AND value >= 0 AND "acceptedValue" >= 0 AND "acceptedValue" <= value);
ALTER TABLE "Portion" ADD CONSTRAINT portion_quantities CHECK (received > 0 AND accepted >= 0 AND accepted <= received AND value >= 0 AND "lateDays" >= 0 AND "rawFine" >= 0);
ALTER TABLE "Certificate" ADD CONSTRAINT certificate_values CHECK (gross >= 0 AND fine >= 0 AND net >= 0 AND net = gross - fine);
ALTER TABLE "Imprest" ADD CONSTRAINT imprest_balance CHECK (balance >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT expense_positive CHECK (amount > 0);
ALTER TABLE "Case" ADD CONSTRAINT case_creator_fk FOREIGN KEY ("createdBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Case" ADD CONSTRAINT case_approver_fk FOREIGN KEY ("evaluationBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Case" ADD CONSTRAINT case_issuer_fk FOREIGN KEY ("issuedBy") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Audit" ADD CONSTRAINT audit_actor_fk FOREIGN KEY (actor) REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Audit" ADD CONSTRAINT audit_school_fk FOREIGN KEY ("schoolId") REFERENCES "School"(id) ON DELETE RESTRICT;
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Financial history is append-only'; END; $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "Audit" FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON "Ledger" FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER cash_immutable BEFORE UPDATE OR DELETE ON "CashMovement" FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

-- Round 5: shared document archive, notes board, direct expenses, sign-in log, ERP school code, AI key.
ALTER TABLE "School" ADD COLUMN "erpCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Tenant" ADD COLUMN "aiKey" TEXT NOT NULL DEFAULT '';

CREATE TABLE "DirectExpense" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "yearId" UUID NOT NULL,
  "budgetId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "vendor" TEXT NOT NULL DEFAULT '',
  "reference" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "note" TEXT NOT NULL DEFAULT '',
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectExpense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DirectExpense_schoolId_yearId_idx" ON "DirectExpense"("schoolId", "yearId");
ALTER TABLE "DirectExpense" ADD CONSTRAINT "DirectExpense_yearId_schoolId_fkey" FOREIGN KEY ("yearId", "schoolId") REFERENCES "FiscalYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectExpense" ADD CONSTRAINT "DirectExpense_budgetId_schoolId_yearId_fkey" FOREIGN KEY ("budgetId", "schoolId", "yearId") REFERENCES "Budget"("id", "schoolId", "yearId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Archive" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "uploadedBy" UUID NOT NULL,
  "uploaderName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Archive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Archive_tenantId_company_idx" ON "Archive"("tenantId", "company");
ALTER TABLE "Archive" ADD CONSTRAINT "Archive_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Note" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '',
  "sort" INTEGER NOT NULL DEFAULT 0,
  "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Note" ADD CONSTRAINT "Note_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LoginLog" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "ip" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL DEFAULT '',
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginLog_userId_createdAt_idx" ON "LoginLog"("userId", "createdAt");
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional second-person approval.
ALTER TABLE "Tenant" ADD COLUMN "fourEyes" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "fourEyesLimit" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierCard" ADD COLUMN "pendingIban" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SupplierCard" ADD COLUMN "pendingBy" UUID;
ALTER TABLE "SupplierCard" ADD COLUMN "pendingAt" TIMESTAMP(3);
CREATE TABLE "Approval" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requestedBy" UUID NOT NULL,
  "requestedName" TEXT NOT NULL,
  "decidedBy" UUID,
  "decidedName" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "Approval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Approval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Approval_caseId_idx" ON "Approval"("caseId");
CREATE INDEX "Approval_schoolId_status_idx" ON "Approval"("schoolId", "status");

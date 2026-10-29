-- Paper-file check before sending.
ALTER TABLE "Tenant" ADD COLUMN "checkAi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "checkRules" JSONB NOT NULL DEFAULT '[]';
CREATE TABLE "FileCheck" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "source" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "pages" INTEGER NOT NULL,
  "facts" JSONB NOT NULL,
  "findings" JSONB NOT NULL,
  "result" TEXT NOT NULL,
  "errors" INTEGER NOT NULL,
  "warnings" INTEGER NOT NULL,
  "notes" INTEGER NOT NULL,
  "html" TEXT NOT NULL,
  "createdBy" UUID NOT NULL,
  "byName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FileCheck_caseId_createdAt_idx" ON "FileCheck"("caseId", "createdAt");
CREATE INDEX "FileCheck_schoolId_createdAt_idx" ON "FileCheck"("schoolId", "createdAt");

-- Audit returns register and case comments.
CREATE TABLE "CaseReturn" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "reasons" JSONB NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdBy" UUID NOT NULL,
  "byName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" UUID,
  "resolveNote" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "CaseReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaseReturn_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CaseReturn_schoolId_date_idx" ON "CaseReturn"("schoolId", "date");
CREATE INDEX "CaseReturn_caseId_idx" ON "CaseReturn"("caseId");
CREATE TABLE "CaseComment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "byName" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "docCode" INTEGER,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CaseComment_caseId_createdAt_idx" ON "CaseComment"("caseId", "createdAt");

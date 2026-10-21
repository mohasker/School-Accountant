-- Comparison runs of the monthly ERP expense report with the system figures.
CREATE TABLE "ErpRecon" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "yearId" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "rows" JSONB NOT NULL,
  "settled" INTEGER NOT NULL DEFAULT 0,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErpRecon_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ErpRecon_schoolId_yearId_idx" ON "ErpRecon"("schoolId", "yearId");

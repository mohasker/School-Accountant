-- The ministry's schools list with each school's link, the accountant's notepad, and guidance journal entries.
CREATE TABLE "SchoolDirectory" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "sn" INTEGER NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "building" TEXT NOT NULL DEFAULT '',
  "stage" TEXT NOT NULL DEFAULT '',
  "gender" TEXT NOT NULL DEFAULT '',
  "district" TEXT NOT NULL DEFAULT '',
  "schoolId" UUID,
  CONSTRAINT "SchoolDirectory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolDirectory_tenantId_sn_key" ON "SchoolDirectory"("tenantId", "sn");
CREATE INDEX "SchoolDirectory_tenantId_schoolId_idx" ON "SchoolDirectory"("tenantId", "schoolId");

CREATE TABLE "UserNote" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "schoolId" UUID,
  "text" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'yellow',
  "done" BOOLEAN NOT NULL DEFAULT false,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UserNote_userId_done_idx" ON "UserNote"("userId", "done");

CREATE TABLE "JournalGuide" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "usage" TEXT NOT NULL DEFAULT '',
  "lines" JSONB NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "sort" INTEGER NOT NULL DEFAULT 0,
  "updatedBy" UUID,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalGuide_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JournalGuide_tenantId_category_idx" ON "JournalGuide"("tenantId", "category");

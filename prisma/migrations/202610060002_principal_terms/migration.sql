-- Principals of a school with the date each one starts; documents print the principal on their own date.
CREATE TABLE "PrincipalTerm" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "fromDate" DATE NOT NULL,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrincipalTerm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrincipalTerm_schoolId_fromDate_key" ON "PrincipalTerm"("schoolId", "fromDate");
ALTER TABLE "PrincipalTerm" ADD CONSTRAINT "PrincipalTerm_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

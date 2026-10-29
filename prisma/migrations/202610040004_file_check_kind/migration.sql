-- A check is of a purchase file or of an imprest settlement statement.
ALTER TABLE "FileCheck" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CASE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "assetCode" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "accountCode" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "BudgetCatalog" ADD COLUMN     "assetCode" TEXT NOT NULL DEFAULT '';


-- Library: the budget line is the expense account 510201; books bought for the library are
-- posted to the asset account 110805 on the same budget line.
UPDATE "BudgetCatalog" c SET code = '510201', "assetCode" = '110805'
  WHERE c.code = '110805' AND NOT EXISTS (SELECT 1 FROM "BudgetCatalog" x WHERE x."tenantId" = c."tenantId" AND x.code = '510201');
UPDATE "Budget" b SET code = '510201', "assetCode" = '110805'
  WHERE b.code = '110805' AND NOT EXISTS (SELECT 1 FROM "Budget" x WHERE x."schoolId" = b."schoolId" AND x."yearId" = b."yearId" AND x.code = '510201');
UPDATE "Expense" e SET "accountCode" = b.code FROM "Budget" b WHERE e."budgetId" = b.id AND e."accountCode" = '';

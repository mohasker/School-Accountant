-- Career-path materials: confirmed account number 10001 (was the placeholder CAREER).
UPDATE "BudgetCatalog" c SET code = '10001'
  WHERE c.code = 'CAREER' AND NOT EXISTS (SELECT 1 FROM "BudgetCatalog" x WHERE x."tenantId" = c."tenantId" AND x.code = '10001');
UPDATE "Budget" b SET code = '10001'
  WHERE b.code = 'CAREER' AND NOT EXISTS (SELECT 1 FROM "Budget" x WHERE x."schoolId" = b."schoolId" AND x."yearId" = b."yearId" AND x.code = '10001');
UPDATE "Expense" e SET "accountCode" = '10001' WHERE e."accountCode" = 'CAREER';

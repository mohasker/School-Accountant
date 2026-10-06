import { STANDARD_SUPPLIERS } from '../apps/api/src/core/suppliers-list';
import { ensureSupplierCards, loadLegacyCertificates } from '../apps/api/src/core/standard-data';
import * as argon2 from 'argon2';
import { db } from '../apps/api/src/common/db';
import { BUDGET_CATALOG } from './catalog';
import { DEMO_BUDGET, DEMO_HOLIDAYS, DEMO_NOTES, DEMO_SCHOOLS, history, people, priorSpend, withHistory } from './demo-data';

/**
 * Trial data on an empty database only (never run against real data): the schools and suppliers of
 * the approved workbooks, the official budget lines with trial amounts, and the holidays. The
 * purchase files and imprests are then created through the API by scripts/demo-scenario.ts.
 */
async function main() {
  if (process.env.DEMO_MODE !== 'true' || !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12)
    throw new Error('Set DEMO_MODE=true and DEMO_PASSWORD with 12+ characters.');
  if (await db.tenant.count()) throw new Error('Seed requires an empty database. It never overwrites data.');
  const who = await people();

  const t = await db.tenant.create({ data: { name: 'MOESAS — بيانات تجريبية' } });
  const schools = [];
  for (const [i, s] of DEMO_SCHOOLS.entries()) {
    const names = who.schools?.[s.key] ?? {};
    schools.push({
      ...s,
      row: await db.school.create({
        data: {
          tenantId: t.id,
          code: 'SCH-' + String(i + 1).padStart(3, '0'),
          name: s.name,
          principal: names.principal ?? 'مدير / ة المدرسة',
          pettyCustodian: names.pettyCustodian ?? 'مسؤول / ة العهدة',
          purchasingOfficer: names.purchasingOfficer ?? '',
          orderPrefix: s.prefix,
          erpCode: (s as { erpCode?: string }).erpCode ?? '',
        },
      }),
    });
  }
  const passwordHash = await argon2.hash(process.env.DEMO_PASSWORD, { type: argon2.argon2id });
  const mine = schools.filter((s) => !s.other).map((s) => s.row),
    theirs = schools.filter((s) => s.other).map((s) => s.row);
  const accounts = [
    ['admin', who.admin ?? 'مدير النظام', ['ACCOUNTANT', 'ADMIN'], [...mine, ...theirs], true],
    ['accountant', who.accountant ?? 'المحاسب', ['ACCOUNTANT'], mine, false],
    ['other', who.other ?? 'محاسب مدرسة أخرى', ['ACCOUNTANT'], theirs, false],
  ] as const;
  for (const [username, name, roles, list, isTenantAdmin] of accounts) {
    const user = await db.user.create({ data: { tenantId: t.id, username, name, passwordHash, isTenantAdmin } });
    for (const sc of list) await db.membership.create({ data: { tenantId: t.id, userId: user.id, schoolId: sc.id, roles: [...roles] } });
  }
  // Each trial school belongs to the accountant who works in it (as if they had added it).
  await db.$executeRaw`UPDATE "School" s SET "createdBy" = (SELECT m."userId" FROM "Membership" m JOIN "User" u ON u."id" = m."userId" WHERE m."schoolId" = s."id" ORDER BY u."isTenantAdmin" ASC LIMIT 1)`;

  await db.budgetCatalog.createMany({ data: BUDGET_CATALOG.map((c) => ({ ...c, tenantId: t.id })) });
  for (const { row } of schools) {
    // Trial amount per line, plus what the school already spent on it in 2026 (certificates before the system).
    const prior = priorSpend(row.name);
    const approved = (code: string) => String(Number(DEMO_BUDGET[code] ?? 0) + Math.ceil((prior[code] ?? 0) / 1000) * 1000);
    const y = await db.fiscalYear.create({
      data: { schoolId: row.id, label: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    for (const [i, c] of BUDGET_CATALOG.entries())
      await db.budget.create({
        data: {
          schoolId: row.id,
          yearId: y.id,
          code: c.code,
          name: c.nameAr,
          nameEn: c.nameEn,
          assetCode: c.assetCode ?? '',
          groupKey: c.groupKey,
          sort: i,
          approved: approved(c.code),
          schoolAmount: approved(c.code),
        },
      });
    await db.supplier.createMany({ data: STANDARD_SUPPLIERS.map((name) => ({ schoolId: row.id, name })) });
  }

  const days = new Map<string, string>();
  for (const [from, to, name] of DEMO_HOLIDAYS)
    for (let d = new Date(from); d <= new Date(to); d = new Date(d.getTime() + 86400000)) days.set(d.toISOString().slice(0, 10), name);
  // The holidays sheet of the certificate workbook (spring break and the national days).
  if (withHistory()) for (const [day, name] of history().holidays) if (!days.has(day)) days.set(day, name);
  for (const [day, name] of days) await db.holiday.create({ data: { tenantId: t.id, date: new Date(day), name, createdBy: t.id } });
  // The supplier bank (one card per company) and the reference register of earlier certificates.
  await ensureSupplierCards(db, t.id);
  console.log('Legacy certificates for reference: ' + (await loadLegacyCertificates(db, t.id)));
  const adminUser = await db.user.findUniqueOrThrow({ where: { username: 'admin' } });
  await db.note.createMany({ data: DEMO_NOTES.map((n) => ({ ...n, tenantId: t.id, updatedBy: adminUser.id })) });
  console.log('Trial accounts: admin (system administrator), accountant, other. Password is the supplied DEMO_PASSWORD.');
}

main().finally(() => db.$disconnect());

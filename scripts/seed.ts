import * as argon2 from 'argon2';
import { db } from '../apps/api/src/common/db';
import { BUDGET_CATALOG } from './catalog';

/** Synthetic demo data on an empty database only. Never run against real data. */
async function main() {
  if (process.env.DEMO_MODE !== 'true' || !process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12)
    throw new Error('Set DEMO_MODE=true and DEMO_PASSWORD with 12+ characters.');
  if (await db.tenant.count()) throw new Error('Seed requires an empty database. It never overwrites data.');

  const t = await db.tenant.create({ data: { name: 'جهة تجريبية — بيانات اصطناعية' } });
  const school = await db.school.create({
    data: { tenantId: t.id, code: 'DEMO-A', name: 'مدرسة الريادة التجريبية', principal: 'مدير المدرسة التجريبي', pettyCustodian: 'مسؤول العهدة التجريبي', orderPrefix: 'RYD' },
  });
  const other = await db.school.create({
    data: { tenantId: t.id, code: 'DEMO-B', name: 'مدرسة الأفق التجريبية', principal: 'مدير المدرسة الثانية', orderPrefix: 'OFQ' },
  });
  const passwordHash = await argon2.hash(process.env.DEMO_PASSWORD, { type: argon2.argon2id });
  const accounts = [
    ['accountant', 'المحاسب التجريبي', ['ACCOUNTANT'], [school], false],
    ['approver', 'المراجع المعتمد', ['APPROVER', 'REVIEWER', 'ERP'], [school], false],
    ['admin', 'مسؤول النظام', ['ADMIN'], [school, other], true],
    ['other', 'محاسب المدرسة الثانية', ['ACCOUNTANT'], [other], false],
  ] as const;
  for (const [username, name, roles, schools, isTenantAdmin] of accounts) {
    const user = await db.user.create({ data: { tenantId: t.id, username, name, passwordHash, isTenantAdmin } });
    for (const sc of schools) await db.membership.create({ data: { tenantId: t.id, userId: user.id, schoolId: sc.id, roles: [...roles] } });
  }

  await db.budgetCatalog.createMany({ data: BUDGET_CATALOG.map((c) => ({ ...c, tenantId: t.id })) });
  // Demo amounts; the first line is large enough for the purchase-cycle tests.
  const demoAmounts: Record<string, string> = { '510401': '50000', '520601': '20000', '520801': '30000', '530301': '15000', '540201': '10000' };
  for (const sc of [school, other]) {
    const y = await db.fiscalYear.create({
      data: { schoolId: sc.id, label: '2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31') },
    });
    const ordered = [...BUDGET_CATALOG].sort((a, b) => Number(b.code in demoAmounts) - Number(a.code in demoAmounts) || a.sort - b.sort);
    for (const [i, c] of ordered.entries())
      await db.budget.create({
        data: {
          schoolId: sc.id,
          yearId: y.id,
          code: c.code,
          name: c.nameAr,
          nameEn: c.nameEn,
          groupKey: c.groupKey,
          sort: i,
          approved: demoAmounts[c.code] ?? '0',
          schoolAmount: demoAmounts[c.code] ?? '0',
        },
      });
  }

  for (const [date, name] of [
    ['2026-12-18', 'اليوم الوطني'],
    ['2027-02-09', 'اليوم الرياضي للدولة'],
  ])
    await db.holiday.create({ data: { tenantId: t.id, date: new Date(date), name, createdBy: t.id } });

  for (const [name, cr] of [
    ['المورد التجريبي الأول', 'DEMO-CR-001'],
    ['المورد التجريبي الثاني', 'DEMO-CR-002'],
    ['المورد التجريبي الثالث', 'DEMO-CR-003'],
  ])
    await db.supplier.create({ data: { schoolId: school.id, name, cr } });
  console.log('Demo accounts: accountant, approver, admin (system administrator), other. Password is the supplied DEMO_PASSWORD.');
}

main().finally(() => db.$disconnect());

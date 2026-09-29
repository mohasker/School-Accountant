import { z } from 'zod';
import { db } from '../common/db';
import { date, fail, id, parse, text } from '../common/validation';
import { passwordHash, ROLES, scope, WORK } from '../core/identity';
import { loadPolicy } from '../core/policy';
import { openYear } from '../core/transaction';
import type { ReadCtx, WriteCtx } from './context';

/** Everything a screen needs to start: school, years, suppliers, budget lines, users and policy. */
export async function readSetup({ s, school, query }: ReadCtx) {
  const yearId = query.year ? parse(id, query.year) : undefined;
  const [schoolRow, years, suppliers, budgets, users, plan] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: school } }),
    db.fiscalYear.findMany({ where: { schoolId: school }, orderBy: { startDate: 'desc' } }),
    db.supplier.findMany({ where: { schoolId: school }, orderBy: { name: 'asc' } }),
    db.budget.findMany({
      where: { schoolId: school, ...(yearId ? { yearId } : {}) },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    }),
    // Only the system administrator sees the other accounts of a school.
    db.membership.findMany({
      where: { schoolId: school, ...(s.user.isTenantAdmin ? {} : { userId: s.user.id }) },
      include: { user: { select: { id: true, name: true, username: true, active: true } } },
    }),
    yearId ? db.budgetPlan.findUnique({ where: { schoolId_yearId: { schoolId: school, yearId } } }) : null,
  ]);
  return {
    school: schoolRow,
    years,
    suppliers,
    budgets,
    users,
    plan,
    roles: scope(s, school).roles,
    policy: await loadPolicy(db, s.user.tenantId),
    demo: process.env.DEMO_MODE === 'true',
  };
}

export async function writeSchool({ s, school, t, body }: WriteCtx) {
  scope(s, school, WORK);
  const p = parse(
    z
      .object({
        name: text,
        principal: text,
        pettyCustodian: z.string().max(100),
        educationCustodian: z.string().max(100),
        bookCustodian: z.string().max(100),
        purchasingOfficer: z.string().max(100).optional(),
        erpCode: z.string().trim().max(40).optional(),
        orderPrefix: z
          .string()
          .regex(/^[A-Za-z0-9]{0,12}$/, 'رمز أوامر الشراء: حروف إنجليزية وأرقام فقط')
          .optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
      })
      .partial()
      .strict(),
    body,
  );
  if ((p.lat == null) !== (p.lng == null)) fail('موقع المدرسة: خط العرض وخط الطول معاً');
  return t.school.update({ where: { id: school }, data: p });
}

export async function writeUser({ s, school, t, body }: WriteCtx) {
  scope(s, school, ['ADMIN']);
  const p = parse(
    z
      .object({
        username: z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),
        name: text,
        password: z.string().min(8).max(128),
        roles: z.array(z.enum(ROLES)).min(1),
      })
      .strict(),
    body,
  );
  const user = await t.user.create({
    data: { tenantId: s.user.tenantId, username: p.username, name: p.name, passwordHash: await passwordHash(p.password) },
  });
  await t.membership.create({ data: { tenantId: s.user.tenantId, schoolId: school, userId: user.id, roles: p.roles } });
  return { id: user.id, name: user.name };
}

export async function writeYear({ s, school, t, body, rid, action }: WriteCtx) {
  scope(s, school, WORK);
  if (action === 'close') {
    const y = await openYear(t, school, parse(id, rid));
    const open =
      (await t.case.count({
        where: { schoolId: school, yearId: y.id, state: { notIn: ['CERTIFIED', 'COMPLETE', 'REGISTERED', 'CANCELLED'] } },
      })) || (await t.imprest.count({ where: { schoolId: school, yearId: y.id, closed: false } }));
    if (open) fail('توجد معاملات أو عهد غير منجزة');
    return t.fiscalYear.update({ where: { id: y.id }, data: { closed: true } });
  }
  const p = parse(z.object({ label: text, start: date, end: date }).strict(), body);
  if (p.start >= p.end) fail('الفترة غير صحيحة');
  const overlap = await t.fiscalYear.count({
    where: { schoolId: school, startDate: { lte: new Date(p.end) }, endDate: { gte: new Date(p.start) } },
  });
  if (overlap) fail('الفترة تتداخل مع عام قائم');
  const year = await t.fiscalYear.create({
    data: { schoolId: school, label: p.label, startDate: new Date(p.start), endDate: new Date(p.end) },
  });
  // The new year starts with the official budget lines (amounts are entered on the budget screen).
  const catalog = await t.budgetCatalog.findMany({
    where: { tenantId: s.user.tenantId, active: true },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  await t.budget.createMany({
    data: catalog.map((c, i) => ({
      schoolId: school,
      yearId: year.id,
      code: c.code,
      name: c.nameAr,
      nameEn: c.nameEn,
      assetCode: c.assetCode,
      groupKey: c.groupKey,
      sort: i,
      approved: 0,
    })),
  });
  return year;
}

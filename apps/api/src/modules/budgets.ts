import { NotFoundException } from '@nestjs/common';
import { principalOn } from '../core/principal';
import { z } from 'zod';
import { db } from '../common/db';
import { isoDay, today } from '../common/dates';
import { D } from '../common/money';
import { fail, id, money, parse, text } from '../common/validation';
import { APPROVE, scope } from '../core/identity';
import { audit, openYear } from '../core/transaction';
import { budgetEstimate } from '../print/budget';
import type { ReadCtx, WriteCtx } from './context';

export async function readLedger({ school, query }: ReadCtx) {
  const yearId = parse(id, query.year);
  return db.ledger.findMany({
    where: { budget: { schoolId: school, yearId, ...(query.budget ? { id: parse(id, query.budget) } : {}) } },
    include: { budget: true },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
}

export async function readBudgetEstimate({ school, query }: ReadCtx) {
  const yearId = parse(id, query.year);
  const year = await db.fiscalYear.findUnique({ where: { id: yearId, schoolId: school }, include: { school: true } });
  if (!year) throw new NotFoundException();
  const [plan, lines] = await Promise.all([
    db.budgetPlan.findUnique({ where: { schoolId_yearId: { schoolId: school, yearId } } }),
    db.budget.findMany({ where: { schoolId: school, yearId }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
  ]);
  return {
    html: budgetEstimate({
      school: year.school.name,
      principal: await principalOn(db, school, isoDay(year.endDate) < today() ? isoDay(year.endDate) : today(), year.school.principal),
      year: year.label,
      plan,
      lines,
    }),
  };
}

const lineSchema = z
  .object({
    yearId: id,
    code: text,
    name: text,
    amount: money,
    reason: text,
    nameEn: z.string().max(150).optional(),
    groupKey: z.string().max(40).optional(),
    schoolAmount: money.optional(),
    kgAmount: money.optional(),
  })
  .strict();

export async function writeBudget(ctx: WriteCtx) {
  const { s, school, t, body, rid, action } = ctx;
  scope(s, school, APPROVE);
  if (rid === 'init') return initFromCatalog(ctx);
  if (action) throw new NotFoundException();
  const p = parse(lineSchema, body);
  await openYear(t, school, p.yearId);
  if (p.schoolAmount !== undefined || p.kgAmount !== undefined) {
    const split = new D(p.schoolAmount ?? '0').plus(p.kgAmount ?? '0');
    if (!split.eq(p.amount)) fail('إجمالي الاعتماد يجب أن يساوي مبلغ مبنى المدرسة + مبنى الروضة');
  }
  const { yearId, reason, amount, ...fields } = p;
  if (rid) {
    const b = await t.budget.findUnique({ where: { id: parse(id, rid), schoolId: school, yearId } });
    if (!b) throw new NotFoundException();
    if (new D(amount).lt(b.committed.plus(b.spent))) fail('الاعتماد أقل من المصروف والمرتبط');
    await audit(t, s, school, 'BUDGET_CHANGE', b.id, { before: b.approved, after: amount, reason });
    const { code: _code, ...editable } = fields;
    return t.budget.update({ where: { id: b.id }, data: { ...editable, approved: amount } });
  }
  return t.budget.create({ data: { ...fields, schoolId: school, yearId, approved: amount } });
}

/** Creates the official budget lines of the catalog for the year (zero amounts) without touching existing lines. */
async function initFromCatalog({ s, school, t, body }: WriteCtx) {
  const p = parse(z.object({ yearId: id }).strict(), body);
  await openYear(t, school, p.yearId);
  const catalog = await t.budgetCatalog.findMany({ where: { tenantId: s.user.tenantId, active: true }, orderBy: { sort: 'asc' } });
  if (!catalog.length) fail('لا توجد بنود رسمية في دليل الموازنة؛ يضيفها مسؤول النظام');
  const existing = new Set((await t.budget.findMany({ where: { schoolId: school, yearId: p.yearId } })).map((b) => b.code));
  const missing = catalog.filter((c) => !existing.has(c.code));
  await t.budget.createMany({
    data: missing.map((c) => ({
      schoolId: school,
      yearId: p.yearId,
      code: c.code,
      name: c.nameAr,
      nameEn: c.nameEn,
      assetCode: c.assetCode,
      groupKey: c.groupKey,
      sort: c.sort,
      approved: 0,
    })),
  });
  return { count: missing.length };
}

const count = z.number().int().min(0).max(100000);

export async function writeBudgetPlan({ s, school, t, body }: WriteCtx) {
  scope(s, school, ['APPROVER', 'ACCOUNTANT']);
  const p = parse(
    z
      .object({
        yearId: id,
        schoolBuildings: count,
        kgBuildings: count,
        studentsSchool: count,
        studentsKg: count,
        teachersSchool: count,
        teachersKg: count,
        adminSchool: count,
        adminKg: count,
      })
      .strict(),
    body,
  );
  const { yearId, ...data } = p;
  await openYear(t, school, yearId);
  return t.budgetPlan.upsert({
    where: { schoolId_yearId: { schoolId: school, yearId } },
    create: { schoolId: school, yearId, ...data },
    update: data,
  });
}

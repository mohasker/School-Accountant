import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { Tx } from '../common/db';
import { id, parse } from '../common/validation';
import type { Identity } from '../core/identity';

/**
 * Deletion of data by the system administrator (trial data, mistakes). Budget positions are restored
 * from the deleted ledger events, then the rows are removed. The append-only history triggers allow
 * deletes only inside this transaction; nothing is ever updated in place.
 */
async function allowPurge(t: Tx) {
  await t.$queryRaw`SELECT set_config('madar.purge', 'on', true)`;
}

/** Removes ledger events and gives their commitment and expense back to the budget lines. */
async function reverseLedger(t: Tx, where: { eventKey: { in: string[] } }) {
  const rows = await t.ledger.findMany({ where });
  const byBudget = new Map<string, { commitment: any; expense: any }>();
  for (const r of rows) {
    const b = byBudget.get(r.budgetId);
    byBudget.set(r.budgetId, b ? { commitment: b.commitment.plus(r.commitment), expense: b.expense.plus(r.expense) } : r);
  }
  await t.ledger.deleteMany({ where });
  for (const [budgetId, v] of byBudget)
    await t.budget.update({ where: { id: budgetId }, data: { committed: { decrement: v.commitment }, spent: { decrement: v.expense } } });
}

export async function deleteCase(t: Tx, caseId: string) {
  const c = await t.case.findUnique({ where: { id: caseId }, include: { items: true, deliveries: { include: { portions: true } } } });
  if (!c) throw new NotFoundException('المعاملة غير موجودة');
  const keys = [
    ...c.items.flatMap((i) => ['order:' + i.id, 'cancel:' + i.id]),
    ...c.deliveries.flatMap((d) => d.portions.map((p) => 'certificate:' + p.id)),
  ];
  await reverseLedger(t, { eventKey: { in: keys } });
  await t.evidence.deleteMany({ where: { caseId } });
  await t.portion.deleteMany({ where: { caseId } });
  await t.certificate.deleteMany({ where: { caseId } });
  await t.delivery.deleteMany({ where: { caseId } });
  await t.quote.deleteMany({ where: { caseId } });
  await t.erp.deleteMany({ where: { caseId } });
  await t.item.deleteMany({ where: { caseId } });
  await t.case.delete({ where: { id: caseId } });
}

export async function deleteImprest(t: Tx, imprestId: string) {
  const a = await t.imprest.findUnique({ where: { id: imprestId }, include: { expenses: { select: { id: true } } } });
  if (!a) throw new NotFoundException('العهدة غير موجودة');
  await reverseLedger(t, { eventKey: { in: a.expenses.map((e) => 'expense:' + e.id) } });
  await t.expense.deleteMany({ where: { imprestId } });
  await t.settlement.deleteMany({ where: { imprestId } });
  await t.cashMovement.deleteMany({ where: { imprestId } });
  await t.imprest.delete({ where: { id: imprestId } });
}

/** Transactions of a school (purchase files, imprests, saved reports); its setup stays. */
async function clearSchool(t: Tx, schoolId: string) {
  for (const c of await t.case.findMany({ where: { schoolId }, select: { id: true } })) await deleteCase(t, c.id);
  for (const a of await t.imprest.findMany({ where: { schoolId }, select: { id: true } })) await deleteImprest(t, a.id);
  await t.reportRun.deleteMany({ where: { schoolId } });
  await t.sequence.deleteMany({ where: { key: { startsWith: schoolId + '/' } } });
}

async function deleteSchool(t: Tx, schoolId: string) {
  await clearSchool(t, schoolId);
  await t.ledger.deleteMany({ where: { budget: { schoolId } } });
  await t.budget.deleteMany({ where: { schoolId } });
  await t.budgetPlan.deleteMany({ where: { schoolId } });
  await t.fiscalYear.deleteMany({ where: { schoolId } });
  await t.supplier.deleteMany({ where: { schoolId } });
  await t.membership.deleteMany({ where: { schoolId } });
  await t.audit.deleteMany({ where: { schoolId } });
  await t.school.delete({ where: { id: schoolId } });
}

/**
 * POST admin/purge { scope, id }:
 *  case / imprest — one purchase file or imprest; school — a school with everything in it;
 *  transactions — every purchase file, imprest and saved report of every school (setup stays);
 *  all — every school and all their data (accounts, holidays, policy and catalog stay).
 */
export async function purge(s: Identity, t: Tx, body: unknown) {
  const p = parse(
    z
      .object({
        scope: z.enum(['case', 'imprest', 'school', 'transactions', 'all']),
        id: id.optional(),
        confirm: z.literal('حذف'),
      })
      .strict(),
    body,
  );
  const tenantId = s.user.tenantId;
  const schools = (await t.school.findMany({ where: { tenantId }, select: { id: true } })).map((x) => x.id);
  await allowPurge(t);
  switch (p.scope) {
    case 'case': {
      const c = await t.case.findFirst({ where: { id: p.id, schoolId: { in: schools } } });
      if (!c) throw new NotFoundException();
      await deleteCase(t, c.id);
      break;
    }
    case 'imprest': {
      const a = await t.imprest.findFirst({ where: { id: p.id, schoolId: { in: schools } } });
      if (!a) throw new NotFoundException();
      await deleteImprest(t, a.id);
      break;
    }
    case 'school':
      if (!p.id || !schools.includes(p.id)) throw new NotFoundException();
      await deleteSchool(t, p.id);
      break;
    case 'transactions':
      for (const school of schools) await clearSchool(t, school);
      break;
    case 'all':
      for (const school of schools) await deleteSchool(t, school);
      break;
  }
  return { id: p.id ?? tenantId, scope: p.scope, deleted: true };
}

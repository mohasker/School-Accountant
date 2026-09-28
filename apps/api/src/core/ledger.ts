import type { Tx } from '../common/db';
import { D, type Decimal } from '../common/money';
import { fail } from '../common/validation';

/**
 * Moves a budget line's commitment and expense atomically and records the ledger event.
 * The event key is unique, so the same business event can never post twice.
 */
export async function posting(
  t: Tx,
  budgetId: string,
  commit: Decimal,
  expense: Decimal,
  eventKey: string,
  source: string,
  actor: string,
) {
  await t.$queryRaw`SELECT id FROM "Budget" WHERE id = ${budgetId}::uuid FOR UPDATE`;
  const b = await t.budget.findUniqueOrThrow({ where: { id: budgetId } }),
    committed = b.committed.plus(commit),
    spent = b.spent.plus(expense);
  if (committed.lt(0) || spent.lt(0) || committed.plus(spent).gt(b.approved))
    fail(`رصيد بند الموازنة ${b.code} غير كافٍ أو حركة عكسية غير صالحة`);
  await t.budget.update({ where: { id: budgetId }, data: { committed, spent } });
  await t.ledger.create({
    data: {
      budgetId,
      eventKey,
      kind: expense.eq(0) ? 'COMMITMENT' : 'EXPENSE',
      commitment: commit,
      expense,
      source,
      actor,
    },
  });
}

export const ZERO = new D(0);

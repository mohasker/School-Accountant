import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { inYear, today } from '../common/dates';
import { D, amount, sum } from '../common/money';
import { date, fail, id, money, optionalText, parse, text } from '../common/validation';
import { ACCOUNT, APPROVE, ERP, scope, type Identity } from '../core/identity';
import { posting, ZERO } from '../core/ledger';
import { loadPolicy } from '../core/policy';
import { openYear } from '../core/transaction';
import { IMPREST_TYPES, imprestCover, imprestStatement, type ImprestStatement } from '../print/imprest';
import type { ReadCtx, WriteCtx } from './context';

const TYPES = ['PETTY', 'EDUCATION', 'BOOK', 'OTHER'] as const;

const withDetail = {
  expenses: { include: { budget: { select: { code: true, name: true } } }, orderBy: { date: 'asc' as const } },
  settlements: { orderBy: { createdAt: 'asc' as const } },
  movements: { orderBy: { createdAt: 'asc' as const } },
};

async function findImprest(t: Tx, school: string, rid: unknown) {
  const a = await t.imprest.findUnique({ where: { id: parse(id, rid), schoolId: school }, include: { ...withDetail, year: true } });
  if (!a) throw new NotFoundException();
  return a;
}
type FullImprest = Awaited<ReturnType<typeof findImprest>>;

/** Figures shown on the settlement screen before the user chooses replenishment or closure. */
async function status(t: Tx, tenantId: string, a: FullImprest) {
  const policy = await loadPolicy(t, tenantId);
  const unsettled = a.expenses.filter((e) => !e.settlementId);
  const unsettledTotal = sum(unsettled.map((e) => e.amount));
  const threshold = a.amount.mul(policy.pettyReplenishPct);
  return {
    unsettledCount: unsettled.length,
    unsettledTotal,
    spentTotal: sum(a.expenses.map((e) => e.amount)),
    threshold,
    replenishPct: policy.pettyReplenishPct,
    canReplenish: a.type === 'PETTY' && unsettled.length > 0 && unsettledTotal.gte(threshold),
    canClose: unsettled.length > 0 || a.balance.gt(0),
  };
}

export async function readImprests({ s, school, rid, action, query }: ReadCtx) {
  if (rid) {
    const a = await findImprest(db, school, rid);
    const info = await status(db, s.user.tenantId, a);
    if (action === 'preview') {
      const type = query.type === 'CLOSE' ? 'CLOSE' : 'REPLENISH';
      const data = await statementData(
        db,
        s,
        school,
        a,
        type,
        a.expenses.filter((e) => !e.settlementId),
        {},
      );
      return { html: imprestStatement(data), cover: imprestCover(data) };
    }
    const settlement = action ? a.settlements.find((x) => x.id === action) : undefined;
    if (action && !settlement) throw new NotFoundException();
    if (settlement) return { html: settlement.html, cover: settlement.coverHtml };
    return { ...a, status: info };
  }
  const yearId = parse(id, query.year);
  const rows = await db.imprest.findMany({ where: { schoolId: school, yearId }, include: withDetail, orderBy: { createdAt: 'asc' } });
  const policy = await loadPolicy(db, s.user.tenantId);
  return rows.map((a) => {
    const unsettledTotal = sum(a.expenses.filter((e) => !e.settlementId).map((e) => e.amount));
    return {
      ...a,
      settlements: a.settlements.map(({ html, coverHtml, ...st }) => st),
      status: {
        unsettledTotal,
        threshold: a.amount.mul(policy.pettyReplenishPct),
        replenishPct: policy.pettyReplenishPct,
        canReplenish: a.type === 'PETTY' && unsettledTotal.gt(0) && unsettledTotal.gte(a.amount.mul(policy.pettyReplenishPct)),
      },
    };
  });
}

async function statementData(
  t: Tx,
  s: Identity,
  school: string,
  a: FullImprest,
  settlementType: string,
  expenses: FullImprest['expenses'],
  names: { custodian?: string; principal?: string; date?: string },
): Promise<ImprestStatement> {
  const schoolRow = await t.school.findUniqueOrThrow({ where: { id: school } });
  // The statement is signed by the accountant who recorded the invoices, not by the approver settling it.
  const recorder = expenses[0] ? await t.user.findUnique({ where: { id: expenses[0].createdBy }, select: { name: true } }) : null;
  return {
    number: a.settlements.length + 1,
    date: names.date ?? today(),
    type: a.type,
    settlementType,
    school: schoolRow.name,
    year: a.year.label,
    principal: names.principal || schoolRow.principal,
    custodian: names.custodian || a.custodian,
    accountant: recorder?.name ?? s.user.name,
    imprestAmount: a.amount,
    expenses,
  };
}

/** Records one invoice paid from the imprest (budget posting, balance and cash movement). */
async function addExpense({ s, school, t }: WriteCtx, a: FullImprest, y: Awaited<ReturnType<typeof openYear>>, input: unknown) {
  const p = parse(
    z
      .object({
        budgetId: id,
        vendor: text,
        invoice: optionalText(100),
        date,
        description: text,
        amount: money,
        note: optionalText(300),
        proof: optionalText(300),
        asset: z.boolean().default(false),
      })
      .strict(),
    input,
  );
  inYear(y, p.date);
  if (p.date > today() || new D(p.amount).lte(0) || new D(p.amount).gt(a.balance)) fail('المبلغ أو التاريخ غير صالح أو يتجاوز رصيد العهدة');
  if (!p.invoice && !p.note) fail('بدون رقم فاتورة يلزم ذكر السبب في الملاحظات');
  if (a.type === 'PETTY') {
    const policy = await loadPolicy(t, s.user.tenantId, p.date);
    if (new D(p.amount).gt(policy.singleQuoteLimit))
      fail(`الشراء من النثرية حتى ${amount(policy.singleQuoteLimit)} ريال للفاتورة؛ ما يزيد يتطلب عروض أسعار ومعاملة شراء`);
  }
  if (p.invoice && a.expenses.some((e) => e.invoice === p.invoice && e.vendor === p.vendor && e.amount.eq(p.amount)))
    fail('الفاتورة مسجلة مسبقاً لنفس المورد والمبلغ');
  const budget = await t.budget.findUnique({ where: { id: p.budgetId, schoolId: school, yearId: a.yearId } });
  if (!budget) fail('بند موازنة غير صالح');
  // Asset purchases (e.g. library books) keep the budget line but post to its asset account.
  if (p.asset && !budget.assetCode) fail('هذا البند ليس له حساب أصل');
  const { asset, ...fields } = p;
  const e = await t.expense.create({
    data: {
      ...fields,
      accountCode: asset ? budget.assetCode : budget.code,
      date: new Date(p.date),
      imprestId: a.id,
      schoolId: school,
      yearId: a.yearId,
      createdBy: s.user.id,
    },
  });
  await posting(t, p.budgetId, ZERO, new D(p.amount), 'expense:' + e.id, e.id, s.user.id);
  await t.imprest.update({ where: { id: a.id }, data: { balance: { decrement: p.amount } } });
  await t.cashMovement.create({
    data: { imprestId: a.id, amount: new D(p.amount).neg(), kind: 'EXPENSE', reference: p.invoice || p.vendor, actor: s.user.id },
  });
  return e;
}

export async function writeImprests(ctx: WriteCtx) {
  const { s, school, t, body, rid, action } = ctx;
  if (!rid) return openImprest(ctx);
  const a = await findImprest(t, school, rid);
  const y = await openYear(t, school, a.yearId);
  if (a.closed) fail('العهدة مغلقة');

  if (action === 'expense') {
    scope(s, school, ACCOUNT);
    return addExpense(ctx, a, y, body);
  }

  if (action === 'settle') {
    scope(s, school, APPROVE);
    const p = parse(
      z
        .object({
          type: z.enum(['REPLENISH', 'CLOSE']),
          date: date.optional(),
          custodian: z.string().trim().max(150).optional(),
          principal: z.string().trim().max(150).optional(),
          reason: z.string().trim().max(500).default(''),
          invoices: z.array(z.record(z.string(), z.unknown())).max(300).default([]),
        })
        .strict(),
      body,
    );
    // Invoices are entered once, on the settlement screen, and recorded together with the statement.
    if (p.invoices.length) scope(s, school, ACCOUNT);
    for (const [i, row] of p.invoices.entries()) {
      try {
        await addExpense(ctx, await findImprest(t, school, a.id), y, row);
      } catch (e: any) {
        if (e?.getStatus?.() === 400 || e?.status === 400) fail(`الفاتورة ${i + 1}: ${e.message}`);
        throw e;
      }
    }
    if (p.invoices.length) Object.assign(a, await findImprest(t, school, a.id));
    const expenses = a.expenses.filter((e) => !e.settlementId);
    if (!expenses.length) fail('لا توجد مصروفات غير مسواة');
    const info = await status(t, s.user.tenantId, a);
    if (p.type === 'REPLENISH') {
      if (a.type !== 'PETTY') fail(`${IMPREST_TYPES[a.type]} تُسوّى وتُغلق ولا تُستعاض`);
      if (!info.canReplenish)
        fail(
          `الاستعاضة عند بلوغ المنصرف ${new D(info.replenishPct).mul(100)}% من قيمة العهدة (${amount(info.threshold)} ر.ق)؛ المنصرف غير المسوى ${amount(
            info.unsettledTotal,
          )} ر.ق`,
        );
    }
    const data = await statementData(t, s, school, a, p.type, expenses, p);
    const st = await t.settlement.create({
      data: {
        imprestId: a.id,
        number: data.number,
        type: p.type,
        amount: sum(expenses.map((e) => e.amount)),
        actor: s.user.id,
        html: imprestStatement(data),
        coverHtml: imprestCover(data),
        details: { date: data.date, custodian: data.custodian, principal: data.principal, reason: p.reason },
      },
    });
    await t.expense.updateMany({ where: { id: { in: expenses.map((e) => e.id) }, settlementId: null }, data: { settlementId: st.id } });
    return st;
  }

  if (action === 'replenish') {
    scope(s, school, APPROVE);
    const p = parse(z.object({ settlementId: id, reference: text }).strict(), body);
    const st = a.settlements.find((x) => x.id === p.settlementId);
    if (!st || st.replenished || st.type !== 'REPLENISH') fail('الاستعاضة غير متاحة');
    await t.settlement.update({ where: { id: st.id }, data: { replenished: true } });
    await t.cashMovement.create({
      data: { imprestId: a.id, amount: st.amount, kind: 'REPLENISH', reference: p.reference, actor: s.user.id },
    });
    return t.imprest.update({ where: { id: a.id }, data: { balance: { increment: st.amount } } });
  }

  if (action === 'erp') {
    scope(s, school, ERP);
    const p = parse(z.object({ settlementId: id, reference: text }).strict(), body);
    const st = a.settlements.find((x) => x.id === p.settlementId);
    if (!st || st.erpRef) fail('التسوية غير متاحة');
    return t.settlement.update({ where: { id: st.id }, data: { erpRef: p.reference } });
  }

  if (action === 'close') {
    scope(s, school, APPROVE);
    const p = parse(z.object({ returnReference: text }).strict(), body);
    if (a.expenses.some((e) => !e.settlementId)) fail('توجد فواتير غير مسواة؛ أصدر كشف التسوية أولاً');
    await t.cashMovement.create({
      data: { imprestId: a.id, amount: a.balance.neg(), kind: 'RETURN', reference: p.returnReference, actor: s.user.id },
    });
    return t.imprest.update({ where: { id: a.id }, data: { balance: 0, closed: true } });
  }
  throw new NotFoundException('الإجراء غير موجود');
}

/** Opens an imprest; the amount is asked every time because the approved value changes by policy. */
async function openImprest({ s, school, t, body }: WriteCtx) {
  scope(s, school, APPROVE);
  const p = parse(
    z.object({ yearId: id, name: text, custodian: text, type: z.enum(TYPES), amount: money, reference: text }).strict(),
    body,
  );
  await openYear(t, school, p.yearId);
  if (new D(p.amount).lte(0)) fail('قيمة العهدة مطلوبة');
  if (p.type === 'PETTY' && (await t.imprest.count({ where: { schoolId: school, yearId: p.yearId, type: 'PETTY', closed: false } })))
    fail('توجد عهدة نثرية مفتوحة لهذه المدرسة؛ أغلقها أولاً');
  const row = await t.imprest.create({
    data: {
      schoolId: school,
      yearId: p.yearId,
      name: p.name,
      custodian: p.custodian,
      type: p.type,
      amount: p.amount,
      balance: p.amount,
      reference: p.reference,
    },
  });
  await t.cashMovement.create({ data: { imprestId: row.id, amount: p.amount, kind: 'FUNDING', reference: p.reference, actor: s.user.id } });
  return row;
}

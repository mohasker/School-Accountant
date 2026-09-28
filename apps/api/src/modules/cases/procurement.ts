import { z } from 'zod';
import type { Tx } from '../../common/db';
import { inYear, isoDay, today } from '../../common/dates';
import { D, amount, round } from '../../common/money';
import { date, fail, id, money, parse, plain, quantity, text } from '../../common/validation';
import { ACCOUNT, APPROVE, REVIEW, scope } from '../../core/identity';
import { posting, ZERO } from '../../core/ledger';
import { loadCalendar, loadPolicy, type Policy } from '../../core/policy';
import { audit, formatNumber, nextNumber, openYear } from '../../core/transaction';
import { orderLetter, quoteStudyReport } from '../../print/procurement';
import type { WriteCtx } from '../context';
import { independent, requireState, type FullCase } from './common';

const prices = z.array(z.object({ itemId: id, price: money })).min(1);

export async function createCase({ s, school, t, body }: WriteCtx) {
  const m = scope(s, school, ACCOUNT);
  const p = parse(
    z
      .object({
        yearId: id,
        subject: text,
        origin: z.enum(['SCHOOL', 'MINISTRY']),
        ministryReference: z.string().trim().max(150).optional(),
        items: z.array(z.object({ name: text, unit: text, qty: quantity, budgetId: id })).min(1).max(100),
      })
      .strict(),
    body,
  );
  const y = await openYear(t, school, p.yearId);
  inYear(y, today());
  if (p.origin === 'MINISTRY' && !p.ministryReference) fail('مرجع التكليف الوزاري مطلوب');
  if (p.ministryReference && (await t.case.count({ where: { schoolId: school, yearId: p.yearId, ministryReference: p.ministryReference } })))
    fail('التكليف الوزاري مسجل');
  for (const item of p.items)
    if (!(await t.budget.findUnique({ where: { id: item.budgetId, schoolId: school, yearId: p.yearId } }))) fail('بند موازنة غير مسموح');
  return t.case.create({
    data: {
      schoolId: school,
      yearId: p.yearId,
      number: formatNumber('TR', await nextNumber(t, school, p.yearId, 'TR')),
      subject: p.subject,
      origin: p.origin,
      ministryReference: p.ministryReference || null,
      createdBy: s.user.id,
      accountantName: s.user.name,
      principalName: m.school.principal,
      items: { create: p.items },
    },
  });
}

/** Validates one unit price per item and returns the rounded order total. */
function priceLines(c: FullCase, lines: { itemId: string; price: string }[]) {
  if (lines.length !== c.items.length || new Set(lines.map((x) => x.itemId)).size !== c.items.length)
    fail('يلزم سعر لكل بند دون تكرار');
  let total = new D(0);
  const values = lines.map((line) => {
    const item = c.items.find((i) => i.id === line.itemId);
    if (!item) fail('بند غير صحيح');
    if (new D(line.price).lte(0)) fail('السعر موجب');
    const value = round(item.qty.mul(line.price));
    total = total.plus(value);
    return { item, price: line.price, value };
  });
  return { total, values };
}

export async function addQuote({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, ACCOUNT);
  requireState(c, ['DRAFT']);
  if (c.origin !== 'SCHOOL') fail('التكليف الوزاري لا يحتاج عروض أسعار');
  const p = parse(
    z
      .object({
        supplierId: id,
        reference: text,
        quoteDate: date.optional(),
        prices,
        compliant: z.boolean(),
        note: z.string().max(1000),
      })
      .strict(),
    body,
  );
  if (!(await t.supplier.findUnique({ where: { id: p.supplierId, schoolId: school, active: true } }))) fail('المورد غير متاح');
  const { total } = priceLines(c, p.prices);
  if (!p.compliant && !p.note.trim()) fail('سبب استبعاد العرض مطلوب');
  return t.quote.create({
    data: {
      schoolId: school,
      yearId: c.yearId,
      caseId: c.id,
      supplierId: p.supplierId,
      reference: p.reference,
      quoteDate: p.quoteDate ? new Date(p.quoteDate) : null,
      prices: p.prices,
      total,
      compliant: p.compliant,
      note: p.note,
    },
  });
}

/**
 * Purchase method from the awarded value (policy in force today):
 *  - above the tender limit: ministry procurement department, not processed by the school;
 *  - up to the single-quote limit: one quote is enough;
 *  - above it: at least `minQuotes` quotes, unless the supplier is the exclusive source (with a reason).
 */
export function purchaseMethod(policy: Policy, total: InstanceType<typeof D>, quoteCount: number, exclusiveReason?: string) {
  if (total.gt(policy.tenderLimit))
    fail(`القيمة تتجاوز ${amount(policy.tenderLimit)} ريال؛ الشراء بمناقصة من اختصاص إدارة المشتريات والمناقصات بالوزارة`);
  if (total.lte(policy.singleQuoteLimit)) return 'SINGLE_QUOTE';
  if (exclusiveReason?.trim()) return 'EXCLUSIVE';
  if (quoteCount < policy.minQuotes)
    fail(
      `المشتريات التي تزيد عن ${amount(policy.singleQuoteLimit)} ريال تتطلب ${policy.minQuotes} عروض أسعار على الأقل، إلا إذا كان المورد محتكراً للصنف (اذكر السبب)`,
    );
  return 'THREE_QUOTES';
}

export async function evaluate({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, ACCOUNT);
  requireState(c, ['DRAFT']);
  if (c.origin !== 'SCHOOL') fail('استخدم مسار التكليف الوزاري');
  const p = parse(z.object({ quoteId: id, reason: text, exclusiveReason: z.string().trim().max(500).optional() }).strict(), body);
  const q = c.quotes.find((q) => q.id === p.quoteId && q.compliant && q.supplier.active);
  if (!q) fail('العرض المختار غير صالح');
  const policy = await loadPolicy(t, s.user.tenantId);
  const method = purchaseMethod(policy, q.total, c.quotes.length, p.exclusiveReason);
  if (method === 'EXCLUSIVE' && c.quotes.length > 1) fail('حالة المورد المحتكر تكون بعرض سعر واحد');
  for (const line of q.prices as { itemId: string; price: string }[]) {
    const item = c.items.find((i) => i.id === line.itemId)!;
    await t.item.update({ where: { id: item.id }, data: { unitPrice: line.price, value: round(item.qty.mul(line.price)) } });
  }
  return t.case.update({
    where: { id: c.id },
    data: {
      state: 'EVALUATED',
      selectedQuoteId: q.id,
      supplierId: q.supplierId,
      total: q.total,
      awardReason: p.reason,
      method,
      exclusiveReason: method === 'EXCLUSIVE' ? p.exclusiveReason : null,
      evaluationNumber: c.evaluationNumber ?? formatNumber('EV', await nextNumber(t, school, c.yearId, 'EV')),
      version: { increment: 1 },
    },
  });
}

export async function directOrder({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, ACCOUNT);
  requireState(c, ['DRAFT']);
  if (c.origin !== 'MINISTRY') fail('ليس تكليفاً وزارياً');
  const p = parse(z.object({ supplierId: id, reason: text, prices }).strict(), body);
  if (!(await t.supplier.findUnique({ where: { id: p.supplierId, schoolId: school, active: true } }))) fail('مورد غير صالح');
  const { total, values } = priceLines(c, p.prices);
  for (const v of values) await t.item.update({ where: { id: v.item.id }, data: { unitPrice: v.price, value: v.value } });
  return t.case.update({
    where: { id: c.id },
    data: { supplierId: p.supplierId, total, awardReason: p.reason, method: 'MINISTRY', state: 'EVALUATED', version: { increment: 1 } },
  });
}

/** Quote study report from the current case data (used for the preview and frozen at approval). */
export async function renderQuoteReport(t: Tx, c: FullCase, tenantId: string, on = today()) {
  const policy = await loadPolicy(t, tenantId, on);
  return quoteStudyReport({
    ref: c.evaluationNumber ?? c.number,
    date: on,
    school: c.school.name,
    principal: c.principalName,
    accountant: c.accountantName,
    subject: c.subject,
    quotes: c.quotes.map((q) => ({
      supplier: q.supplier.name,
      total: q.total,
      compliant: q.compliant,
      note: q.note,
      selected: q.id === c.selectedQuoteId,
    })),
    method: c.method ?? 'THREE_QUOTES',
    exclusiveReason: c.exclusiveReason,
    awardReason: c.awardReason,
    singleQuoteLimit: policy.singleQuoteLimit,
  });
}

export async function approve({ s, school, t, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, APPROVE);
  independent(s, c);
  requireState(c, ['EVALUATED']);
  return t.case.update({
    where: { id: c.id },
    data: {
      state: 'APPROVED',
      evaluationBy: s.user.id,
      evaluationHtml: c.origin === 'SCHOOL' ? await renderQuoteReport(t, c, s.user.tenantId) : null,
      version: { increment: 1 },
    },
  });
}

export async function returnCase({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, REVIEW);
  requireState(c, ['EVALUATED']);
  const p = parse(z.object({ reason: text }).strict(), body);
  await audit(t, s, school, 'RETURN_REASON', c.id, p);
  return t.case.update({ where: { id: c.id }, data: { state: 'DRAFT', version: { increment: 1 } } });
}

/** Local purchase order number: PREFIX/YYYY-MMDD, then -2, -3 … for further orders on the same day. */
async function orderNumberFor(t: Tx, c: FullCase, on: string, manual?: string) {
  const taken = async (n: string) => (await t.case.count({ where: { schoolId: c.schoolId, orderNumber: n } })) > 0;
  if (manual) {
    if (await taken(manual)) fail('رقم أمر الشراء مستخدم في المدرسة');
    return manual;
  }
  const base = `${c.school.orderPrefix || 'PO'}/${on.slice(0, 4)}-${on.slice(5, 7)}${on.slice(8, 10)}`;
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  fail('تعذر توليد رقم أمر الشراء');
}

const pct = (v: string) => new D(v).mul(100).toDecimalPlaces(2).toString();

export async function issue({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, ACCOUNT);
  requireState(c, ['APPROVED']);
  const p = parse(
    z
      .object({
        trigger: date,
        days: z.number().int().min(1).max(365),
        policyConfirmed: z.literal(true),
        orderNumber: z.string().trim().min(3).max(60).optional(),
      })
      .strict(),
    body,
  );
  inYear(c.year, p.trigger);
  if (p.trigger > today()) fail('تاريخ بدء مستقبلي غير مسموح');
  const policy = await loadPolicy(t, s.user.tenantId, p.trigger);
  const calendar = await loadCalendar(t, s.user.tenantId, policy.weekend);
  for (const item of [...c.items].sort((a, b) => a.budgetId.localeCompare(b.budgetId)))
    await posting(t, item.budgetId, item.value, ZERO, 'order:' + item.id, c.id, s.user.id);
  const orderNumber = c.origin === 'MINISTRY' ? c.ministryReference! : await orderNumberFor(t, c, p.trigger, p.orderNumber);
  const due = calendar.addWorkingDays(p.trigger, p.days);
  const quote = c.quotes.find((q) => q.id === c.selectedQuoteId);
  const html = orderLetter({
    orderNumber,
    date: p.trigger,
    school: c.school.name,
    principal: c.principalName,
    accountant: c.accountantName,
    supplier: c.supplier?.name ?? '',
    subject: c.subject,
    quoteRef: quote?.reference,
    quoteDate: quote?.quoteDate,
    ministryReference: c.origin === 'MINISTRY' ? c.ministryReference : null,
    items: c.items,
    total: c.total,
    startWithinDays: policy.startWithinDays,
    deliveryDays: p.days,
    dueDate: due,
    finePct: pct(policy.fineRatePerDay),
    capPct: pct(policy.fineCap),
  });
  return t.case.update({
    where: { id: c.id },
    data: {
      state: 'ORDERED',
      issueDate: new Date(p.trigger),
      dueDate: new Date(due),
      deliveryDays: p.days,
      orderNumber,
      orderHtml: html,
      supplierSnapshot: plain(c.supplier),
      policy: plain({ fineRatePerDay: policy.fineRatePerDay, fineCap: policy.fineCap, weekend: policy.weekend, basis: 'WORKING_DAYS' }),
      issuedBy: s.user.id,
      version: { increment: 1 },
    },
  });
}

/** Fine parameters frozen on the order when it was issued. */
export function orderPolicy(c: FullCase) {
  const p = (c.policy ?? {}) as Partial<Policy>;
  return { rate: p.fineRatePerDay ?? '0.01', cap: p.fineCap ?? '0.10', weekend: p.weekend ?? [5, 6] };
}

export async function extend({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, APPROVE);
  independent(s, c);
  requireState(c, ['ORDERED', 'PARTIAL']);
  const p = parse(z.object({ due: date, reason: text }).strict(), body);
  if (c.certificates.length) fail('يلزم تعديل مالي مستقل بعد إصدار شهادة؛ التمديد المباشر محظور');
  if (p.due <= isoDay(c.dueDate!)) fail('التاريخ ليس تمديداً');
  const { rate, weekend } = orderPolicy(c);
  const calendar = await loadCalendar(t, s.user.tenantId, weekend);
  for (const d of c.deliveries)
    for (const r of d.portions) {
      const lateDays = calendar.workingDaysBetween(p.due, isoDay(d.date));
      await t.portion.update({ where: { id: r.id }, data: { lateDays, rawFine: r.value.mul(rate).mul(lateDays) } });
    }
  await audit(t, s, school, 'EXTENSION', c.id, { old: c.dueDate, new: p.due, reason: p.reason });
  return t.case.update({ where: { id: c.id }, data: { dueDate: new Date(p.due), version: { increment: 1 } } });
}

export async function cancel({ s, school, t, body, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, APPROVE);
  independent(s, c);
  requireState(c, ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED']);
  const p = parse(z.object({ reason: text }).strict(), body);
  if (c.deliveries.length || c.certificates.length) fail('الإلغاء بعد الاستلام يحتاج مستند تصحيح؛ لا إلغاء صامت');
  if (c.state === 'ORDERED')
    for (const i of [...c.items].sort((a, b) => a.budgetId.localeCompare(b.budgetId)))
      await posting(t, i.budgetId, i.value.neg(), ZERO, 'cancel:' + i.id, c.id, s.user.id);
  await audit(t, s, school, 'CANCEL_REASON', c.id, p);
  return t.case.update({ where: { id: c.id }, data: { state: 'CANCELLED', version: { increment: 1 } } });
}


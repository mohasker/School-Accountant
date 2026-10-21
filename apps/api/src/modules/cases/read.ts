import { NotFoundException } from '@nestjs/common';
import { gateDocuments } from './fulfilment';
import { caseBundle } from './bundle';
import { performance } from '../bank';
import { approvalRequired } from './approvals';
import { db } from '../../common/db';
import { isoDay, today } from '../../common/dates';
import { D, num } from '../../common/money';
import { id, parse } from '../../common/validation';
import { loadPolicy } from '../../core/policy';
import { BUDGET_GROUPS } from '../../print/budget';
import type { ReadCtx } from '../context';
import { checklist, getCase } from './common';
import { renderQuoteReport } from './procurement';

function caseFilter(school: string, yearId: string, query: Record<string, any>) {
  const q = String(query.q ?? '').slice(0, 200),
    state = query.state ? String(query.state) : undefined,
    contains = { contains: q, mode: 'insensitive' as const };
  return {
    schoolId: school,
    yearId,
    ...(state ? { state } : {}),
    ...(q
      ? {
          OR: [
            { number: contains },
            { subject: contains },
            { orderNumber: contains },
            { evaluationNumber: contains },
            { supplier: { name: contains } },
            { erp: { reference: contains } },
            { certificates: { some: { number: contains } } },
            { deliveries: { some: { invoice: contains } } },
          ],
        }
      : {}),
  };
}

async function ownedYear(school: string, year: unknown) {
  const yearId = parse(id, year);
  const owned = await db.fiscalYear.findUnique({ where: { id: yearId, schoolId: school } });
  if (!owned) throw new NotFoundException();
  return owned;
}

export async function readCases({ s, school, rid, action, query }: ReadCtx) {
  if (rid) return readCase(s.user.tenantId, school, parse(id, rid), action);
  const year = await ownedYear(school, query.year);
  return db.case.findMany({
    where: caseFilter(school, year.id, query),
    include: {
      supplier: true,
      certificates: { select: { id: true, number: true, gross: true, fine: true, net: true, finalized: true } },
      erp: true,
      returns: { where: { resolvedAt: null }, select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

async function readCase(tenantId: string, school: string, caseId: string, action?: string) {
  const c = await getCase(db, school, caseId);
  if (action === 'report-print') {
    if (c.evaluationHtml) return { html: c.evaluationHtml };
    // Before the report is issued it can be previewed with the quotes entered so far.
    if (c.origin === 'SCHOOL' && ['DRAFT', 'EVALUATED'].includes(c.state) && c.quotes.length) {
      const lowest = [...c.quotes].filter((q) => q.compliant).sort((a, b) => a.total.comparedTo(b.total))[0];
      return {
        html: await renderQuoteReport(db, { ...c, selectedQuoteId: c.selectedQuoteId ?? lowest?.id ?? null }, tenantId),
        preview: true,
      };
    }
    throw new NotFoundException('أضف عروض الأسعار لمعاينة التقرير');
  }
  if (action === 'bundle') return caseBundle(school, caseId);
  if (action === 'order-print') {
    if (!c.orderHtml) throw new NotFoundException('يصدر كتاب التكليف بعد الإصدار');
    return { html: c.orderHtml };
  }
  if (action) throw new NotFoundException();
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { certGate: true, checkDocs: true } });
  // The delivery record of every quoting company, shown next to its quotation.
  const cardIds = [...new Set([...c.quotes.map((q) => q.supplier.cardId), c.supplier?.cardId].filter((v): v is string => !!v))];
  const cards = cardIds.length
    ? await db.supplierCard.findMany({ where: { id: { in: cardIds } }, select: { id: true, name: true, legalName: true } })
    : [];
  const perf = await performance(tenantId, cards);
  const performanceBySupplier = Object.fromEntries(
    [...c.quotes.map((q) => q.supplier), ...(c.supplier ? [c.supplier] : [])]
      .filter((x) => x.cardId && perf.has(x.cardId))
      .map((x) => [x.id, perf.get(x.cardId!)]),
  );
  return {
    ...c,
    checklist: checklist(c),
    gate: tenant.certGate ? gateDocuments(c, tenant.checkDocs) : null,
    approval: (await approvalRequired(db, tenantId, c))
      ? {
          required: true,
          last: await db.approval.findFirst({ where: { caseId: c.id, kind: 'CERTIFICATE' }, orderBy: { createdAt: 'desc' } }),
        }
      : null,
    performance: performanceBySupplier,
  };
}

const inPeriod = (d: Date | string | null | undefined, from: string, to: string) => {
  if (!d) return false;
  const v = typeof d === 'string' ? d.slice(0, 10) : isoDay(d);
  return v >= from && v <= to;
};
/** Name key that treats «SMARTQAT  Trading» and «smartqat trading» as the same company. */
const supplierKey = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Companies the school bought from more than twice in one calendar year (January–December), counting
 * assignments (from the issued quote report on), direct expenses and imprest invoices. It is a reminder
 * to widen the quotes and vary the suppliers, not a ban. The calendar year is the current one when it
 * falls inside the fiscal year, otherwise the fiscal year's first year.
 */
export async function repeatPurchases(school: string, start: string, end: string) {
  const now = today().slice(0, 4);
  const y = now >= start.slice(0, 4) && now <= end.slice(0, 4) ? now : start.slice(0, 4);
  const range = { gte: new Date(`${y}-01-01`), lte: new Date(`${y}-12-31T23:59:59Z`) };
  const [cases, direct, invoices] = await Promise.all([
    db.case.findMany({
      where: {
        schoolId: school,
        supplierId: { not: null },
        state: { notIn: ['DRAFT', 'CANCELLED'] },
        // Only files that can fall in the calendar year (by any of the three dates used below).
        OR: [{ issueDate: range }, { reportDate: range }, { createdAt: { gte: range.gte, lte: range.lte } }],
      },
      select: { total: true, issueDate: true, reportDate: true, createdAt: true, supplier: { select: { name: true } } },
    }),
    db.directExpense.findMany({ where: { schoolId: school, date: range, vendor: { not: '' } }, select: { vendor: true, amount: true } }),
    db.expense.findMany({ where: { schoolId: school, date: range, vendor: { not: '' } }, select: { vendor: true, amount: true } }),
  ]);
  type Tally = { name: string; count: number; orders: number; direct: number; invoices: number; value: InstanceType<typeof D> };
  const rows = new Map<string, Tally>();
  const add = (name: string, amount: unknown, kind: 'orders' | 'direct' | 'invoices') => {
    const key = supplierKey(name);
    if (!key) return;
    const r = rows.get(key) ?? { name: name.trim(), count: 0, orders: 0, direct: 0, invoices: 0, value: new D(0) };
    r.count++;
    r[kind]++;
    r.value = r.value.plus(amount as any);
    rows.set(key, r);
  };
  for (const c of cases) {
    const when = isoDay(c.issueDate ?? c.reportDate ?? c.createdAt);
    if (when.startsWith(y)) add(c.supplier!.name, c.total, 'orders');
  }
  for (const e of direct) add(e.vendor, e.amount, 'direct');
  for (const e of invoices) add(e.vendor, e.amount, 'invoices');
  return {
    year: y,
    rows: [...rows.values()]
      .filter((r) => r.count > 2)
      .sort((a, b) => b.count - a.count || b.value.comparedTo(a.value))
      .map((r) => ({ ...r, value: num(r.value) })),
  };
}

const monthOf = (d: Date | string) => (typeof d === 'string' ? d : isoDay(d)).slice(0, 7);

/**
 * Home screen of a school and fiscal year: budget position, and the documents issued in the chosen
 * period (quote reports, assignment letters, completion certificates with covering letters, imprest
 * invoices and settlements) with monthly figures for the charts.
 */
export async function readDashboard({ s, school, query }: ReadCtx) {
  const year = await ownedYear(school, query.year);
  const where = { schoolId: school, yearId: year.id };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = day.test(String(query.from ?? '')) ? String(query.from) : isoDay(year.startDate);
  const to = day.test(String(query.to ?? '')) ? String(query.to) : isoDay(year.endDate);
  const [cases, budgets, imprests, policy, directAll] = await Promise.all([
    db.case.findMany({
      where,
      select: {
        id: true,
        number: true,
        subject: true,
        state: true,
        total: true,
        createdAt: true,
        reportDate: true,
        issueDate: true,
        dueDate: true,
        orderNumber: true,
        accountantName: true,
        method: true,
        origin: true,
        supplier: { select: { name: true } },
        certificates: { select: { id: true, net: true, fine: true, gross: true, createdAt: true, details: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.budget.findMany({ where, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    db.imprest.findMany({
      where,
      include: { expenses: true, settlements: { select: { id: true, amount: true, type: true, createdAt: true, details: true } } },
    }),
    loadPolicy(db, s.user.tenantId),
    db.directExpense.findMany({ where, select: { date: true, amount: true } }),
  ]);
  const certDate = (c: { createdAt: Date; details: any }) => String(c.details?.date ?? isoDay(c.createdAt));
  // Which files have an issued quote report / cover letter: ids only, never the documents themselves.
  const [withReport, withCover] = await Promise.all([
    db.case.findMany({ where: { ...where, evaluationHtml: { not: null } }, select: { id: true } }).then((r) => new Set(r.map((x) => x.id))),
    db.certificate
      .findMany({ where: { case: where, coverHtml: { not: null } }, select: { id: true } })
      .then((r) => new Set(r.map((x) => x.id))),
  ]);
  const reports = cases.filter((c) => withReport.has(c.id) && inPeriod(c.reportDate ?? c.createdAt, from, to));
  const orders = cases.filter((c) => inPeriod(c.issueDate, from, to));
  const certificates = cases.flatMap((c) => c.certificates.map((x) => ({ ...x, case: c }))).filter((x) => inPeriod(certDate(x), from, to));
  const expenses = imprests.flatMap((a) => a.expenses).filter((e) => inPeriod(e.date, from, to));
  const direct = directAll.filter((e) => inPeriod(e.date, from, to));
  const repeatSuppliers = await repeatPurchases(school, isoDay(year.startDate), isoDay(year.endDate));
  const settlements = imprests
    .flatMap((a) => a.settlements)
    .filter((x) => inPeriod(String((x.details as any)?.date ?? isoDay(x.createdAt)), from, to));
  const total = (rows: object[], key: 'total' | 'net' | 'amount') =>
    num(rows.reduce((v: InstanceType<typeof D>, r: any) => v.plus(r[key] ?? 0), new D(0)));

  // Monthly values across the period for the charts.
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7) && months.length < 24;) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const monthly = months.map((m) => ({
    month: m,
    orders: num(orders.filter((c) => monthOf(c.issueDate!) === m).reduce((v, c) => v.plus(c.total), new D(0))),
    certificates: num(certificates.filter((x) => certDate(x).slice(0, 7) === m).reduce((v, x) => v.plus(x.net), new D(0))),
    imprests: num(expenses.filter((e) => monthOf(e.date) === m).reduce((v, e) => v.plus(e.amount), new D(0))),
    direct: num(direct.filter((e) => monthOf(e.date) === m).reduce((v, e) => v.plus(e.amount), new D(0))),
  }));

  const stage = (c: { state: string }) =>
    ['DRAFT'].includes(c.state)
      ? 'REPORT'
      : ['EVALUATED', 'APPROVED'].includes(c.state)
        ? 'ORDER'
        : ['ORDERED', 'PARTIAL', 'DELIVERED'].includes(c.state)
          ? 'CERTIFICATE'
          : c.state === 'CANCELLED'
            ? 'CANCELLED'
            : 'DONE';
  const stages = ['REPORT', 'ORDER', 'CERTIFICATE', 'DONE', 'CANCELLED'].map((key) => ({
    key,
    count: cases.filter((c) => stage(c) === key).length,
    value: num(cases.filter((c) => stage(c) === key).reduce((v, c) => v.plus(c.total), new D(0))),
  }));

  // Files not yet finished (no certificate yet), with the next document each one needs.
  const OPEN = ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED'];
  const incomplete = cases.filter((c) => OPEN.includes(c.state));
  const groups = [...BUDGET_GROUPS, { key: '', ar: 'بنود أخرى' }]
    .map((g) => {
      const rows = budgets.filter((b) => (g.key ? b.groupKey === g.key : !BUDGET_GROUPS.some((x) => x.key === b.groupKey)));
      const add = (k: 'approved' | 'spent' | 'committed') => rows.reduce((v, b) => v.plus(b[k]), new D(0));
      return {
        key: g.key || 'OTHER',
        name: g.ar,
        approved: num(add('approved')),
        spent: num(add('spent')),
        committed: num(add('committed')),
      };
    })
    .filter((g) => Number(g.approved) > 0 || Number(g.spent) > 0);

  const approved = budgets.reduce((v, b) => v.plus(b.approved), new D(0)),
    committed = budgets.reduce((v, b) => v.plus(b.committed), new D(0)),
    spent = budgets.reduce((v, b) => v.plus(b.spent), new D(0));

  // Petty imprests that reached the replenishment threshold are highlighted for action.
  const alerts = imprests
    .filter((a) => !a.closed && a.type === 'PETTY' && a.amount.gt(0))
    .map((a) => {
      const unsettled = a.expenses.filter((e) => !e.settlementId).reduce((v, e) => v.plus(e.amount), new D(0));
      return { id: a.id, name: a.name, unsettled, amount: a.amount, ratio: unsettled.div(a.amount).toNumber() };
    })
    .filter((a) => a.ratio >= Number(policy.pettyReplenishPct));
  const now = today();
  const lateOrders = cases
    .filter((c) => ['ORDERED', 'PARTIAL'].includes(c.state) && c.dueDate && isoDay(c.dueDate) < now)
    .map((c) => ({ id: c.id, number: c.number, subject: c.subject, dueDate: c.dueDate, supplier: c.supplier }));

  return {
    period: { from, to, yearStart: isoDay(year.startDate), yearEnd: isoDay(year.endDate) },
    budget: {
      approved: num(approved),
      committed: num(committed),
      spent: num(spent),
      available: num(approved.minus(committed).minus(spent)),
      groups,
      lines: budgets
        .filter((b) => b.approved.gt(0) || b.spent.gt(0) || b.committed.gt(0))
        .map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          approved: num(b.approved),
          committed: num(b.committed),
          spent: num(b.spent),
          available: num(b.approved.minus(b.committed).minus(b.spent)),
        })),
    },
    documents: {
      reports: { count: reports.length, value: total(reports, 'total') },
      orders: { count: orders.length, value: total(orders, 'total') },
      certificates: {
        count: certificates.length,
        value: num(certificates.reduce((v, x) => v.plus(x.net), new D(0))),
        fines: num(certificates.reduce((v, x) => v.plus(x.fine), new D(0))),
        covers: certificates.filter((x) => withCover.has(x.id)).length,
      },
      direct: { count: direct.length, value: total(direct, 'amount') },
      imprests: {
        open: imprests.filter((a) => !a.closed).length,
        balance: num(imprests.filter((a) => !a.closed).reduce((v, a) => v.plus(a.balance), new D(0))),
        invoices: expenses.length,
        spent: total(expenses, 'amount'),
        settlements: settlements.length,
        settled: total(settlements, 'amount'),
      },
    },
    monthly,
    stages,
    cases: cases.slice(0, 10).map(({ certificates, ...c }) => c),
    incomplete: {
      count: incomplete.length,
      value: num(incomplete.reduce((v, c) => v.plus(c.total), new D(0))),
      rows: incomplete.slice(0, 15).map(({ certificates, ...c }) => c),
    },
    total: cases.length,
    alerts: { replenish: alerts, lateOrders, repeatSuppliers },
  };
}

export async function readCertificate({ school, rid, action }: ReadCtx) {
  const cert = await db.certificate.findFirst({ where: { id: parse(id, rid), case: { schoolId: school } } });
  if (!cert) throw new NotFoundException();
  if (action === 'cover') {
    if (!cert.coverHtml) throw new NotFoundException('لم يُعد كتاب التغطية بعد');
    return { html: cert.coverHtml };
  }
  return { html: cert.html };
}

export async function readEvidence({ school, rid }: ReadCtx) {
  const f = await db.evidence.findFirst({ where: { id: parse(id, rid), case: { schoolId: school } } });
  if (!f) throw new NotFoundException();
  return { name: f.name, mime: f.mime, data: f.data ? Buffer.from(f.data).toString('base64') : null };
}

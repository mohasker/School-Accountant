import { NotFoundException } from '@nestjs/common';
import { db } from '../../common/db';
import { D } from '../../common/money';
import { id, parse } from '../../common/validation';
import { loadPolicy } from '../../core/policy';
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
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

async function readCase(tenantId: string, school: string, caseId: string, action?: string) {
  const c = await getCase(db, school, caseId);
  if (action === 'report-print') {
    if (c.evaluationHtml) return { html: c.evaluationHtml };
    // Before approval the report is a live preview so the principal can review it before signing.
    if (c.origin === 'SCHOOL' && c.state === 'EVALUATED') return { html: await renderQuoteReport(db, c, tenantId), preview: true };
    throw new NotFoundException('يصدر تقرير الدراسة بعد اختيار العرض');
  }
  if (action === 'order-print') {
    if (!c.orderHtml) throw new NotFoundException('يصدر كتاب التكليف بعد الإصدار');
    return { html: c.orderHtml };
  }
  if (action) throw new NotFoundException();
  return { ...c, checklist: checklist(c) };
}

export async function readDashboard({ s, school, query }: ReadCtx) {
  const year = await ownedYear(school, query.year);
  const where = { schoolId: school, yearId: year.id };
  const [recent, budgets, imprests, counts, certificates, policy] = await Promise.all([
    db.case.findMany({ where, include: { supplier: true, erp: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.budget.findMany({ where, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    db.imprest.findMany({ where, include: { expenses: { where: { settlementId: null } } } }),
    db.case.groupBy({ by: ['state'], where, _count: true }),
    db.certificate.count({ where: { case: where } }),
    loadPolicy(db, s.user.tenantId),
  ]);
  // Petty imprests that reached the replenishment threshold are highlighted for action.
  const alerts = imprests
    .filter((a) => !a.closed && a.type === 'PETTY' && a.amount.gt(0))
    .map((a) => {
      const unsettled = a.expenses.reduce((v, e) => v.plus(e.amount), new D(0));
      return { id: a.id, name: a.name, unsettled, amount: a.amount, ratio: unsettled.div(a.amount).toNumber() };
    })
    .filter((a) => a.ratio >= Number(policy.pettyReplenishPct));
  const lateOrders = await db.case.findMany({
    where: { ...where, state: { in: ['ORDERED', 'PARTIAL'] }, dueDate: { lt: new Date() } },
    select: { id: true, number: true, subject: true, dueDate: true, supplier: { select: { name: true } } },
    take: 20,
  });
  return {
    counts,
    budgets,
    imprests: imprests.map(({ expenses, ...a }) => a),
    cases: recent,
    certificates,
    total: counts.reduce((n, c) => n + c._count, 0),
    alerts: { replenish: alerts, lateOrders },
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

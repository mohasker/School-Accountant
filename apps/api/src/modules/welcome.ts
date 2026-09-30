import { db } from '../common/db';
import { isoDay, today } from '../common/dates';
import { D, num } from '../common/money';
import type { Identity } from '../core/identity';
import { loadPolicy } from '../core/policy';

const OPEN = ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED'];
const NEXT: Record<string, string> = {
  DRAFT: 'إكمال تقرير عروض الأسعار',
  EVALUATED: 'اعتماد تقرير العروض',
  APPROVED: 'إصدار كتاب التكليف',
  ORDERED: 'إصدار شهادة الإنجاز والتغطية',
  PARTIAL: 'استكمال التوريد ثم الشهادة',
  DELIVERED: 'إصدار شهادة الإنجاز والتغطية',
};
const days = (from: Date) => Math.max(0, Math.floor((Date.now() - from.getTime()) / 86400000));

/**
 * The reminder shown after signing in: for every school the user works in, the files that are not
 * finished (with the next document each needs and how long it has waited), late assignments, petty
 * imprests that reached replenishment, replenishments not yet received, and finished files not yet
 * recorded in ERP. Schools with nothing pending are only counted.
 */
export async function welcome(s: Identity) {
  const schools = s.user.memberships.filter((m) => m.school.active).map((m) => m.school);
  const ids = schools.map((x) => x.id);
  const now = today();
  const [cases, erp, imprests, policy] = await Promise.all([
    db.case.findMany({
      where: { schoolId: { in: ids }, state: { in: OPEN }, year: { closed: false } },
      select: {
        id: true,
        schoolId: true,
        number: true,
        subject: true,
        state: true,
        total: true,
        createdAt: true,
        issueDate: true,
        dueDate: true,
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.case.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids }, state: { in: ['CERTIFIED', 'COMPLETE'] } }, _count: true }),
    db.imprest.findMany({
      where: { schoolId: { in: ids }, closed: false },
      select: {
        id: true,
        schoolId: true,
        name: true,
        type: true,
        amount: true,
        expenses: { where: { settlementId: null }, select: { amount: true } },
        settlements: { where: { type: 'REPLENISH', replenished: false }, select: { id: true, amount: true } },
      },
    }),
    loadPolicy(db, s.user.tenantId),
  ]);
  const rows = schools.map((sc) => {
    const own = cases.filter((c) => c.schoolId === sc.id);
    const late = own.filter((c) => ['ORDERED', 'PARTIAL'].includes(c.state) && c.dueDate && isoDay(c.dueDate) < now);
    const stage = (states: string[]) => own.filter((c) => states.includes(c.state));
    const im = imprests.filter((a) => a.schoolId === sc.id);
    const replenish = im
      .filter((a) => a.type === 'PETTY' && a.amount.gt(0))
      .map((a) => ({ name: a.name, unsettled: a.expenses.reduce((v, e) => v.plus(e.amount), new D(0)), amount: a.amount }))
      .filter((a) => a.unsettled.div(a.amount).gte(policy.pettyReplenishPct))
      .map((a) => ({ name: a.name, unsettled: num(a.unsettled) }));
    const awaiting = im.flatMap((a) => a.settlements.map((x) => ({ name: a.name, amount: num(x.amount) })));
    const items = own.map((c) => ({
      id: c.id,
      number: c.number,
      subject: c.subject,
      supplier: c.supplier?.name ?? '',
      total: num(c.total),
      next: NEXT[c.state],
      waiting: days(c.issueDate ?? c.createdAt),
      late: late.some((x) => x.id === c.id),
    }));
    const erpCount = erp.find((x) => x.schoolId === sc.id)?._count ?? 0;
    return {
      id: sc.id,
      name: sc.name,
      pending: own.length,
      value: num(own.reduce((v, c) => v.plus(c.total), new D(0))),
      stages: {
        report: stage(['DRAFT', 'EVALUATED']).length,
        order: stage(['APPROVED']).length,
        certificate: stage(['ORDERED', 'PARTIAL', 'DELIVERED']).length,
      },
      late: late.length,
      replenish,
      awaiting,
      erp: erpCount,
      // Late ones first, then the longest waiting.
      items: items.sort((a, b) => Number(b.late) - Number(a.late) || b.waiting - a.waiting).slice(0, 6),
      attention: own.length + replenish.length + awaiting.length + erpCount,
    };
  });
  const busy = rows.filter((r) => r.attention > 0).sort((a, b) => b.late - a.late || b.attention - a.attention);
  return {
    name: s.user.name,
    totals: {
      schools: rows.length,
      pending: rows.reduce((n, r) => n + r.pending, 0),
      late: rows.reduce((n, r) => n + r.late, 0),
      replenish: rows.reduce((n, r) => n + r.replenish.length, 0),
      awaiting: rows.reduce((n, r) => n + r.awaiting.length, 0),
      erp: rows.reduce((n, r) => n + r.erp, 0),
    },
    schools: busy,
    clear: rows.length - busy.length,
  };
}

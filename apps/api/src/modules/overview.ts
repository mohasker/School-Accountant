import { NotFoundException } from '@nestjs/common';
import { db } from '../common/db';
import { today } from '../common/dates';
import { D, num } from '../common/money';
import { id, parse } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { pendingBySchool } from './welcome';

/** A line with less than this share of its approved amount left is flagged as nearly used up. */
const LOW = 0.1;
/** Files waiting longer than this are listed for follow-up. */
export const STALE_DAYS = 14;

/**
 * The general position of all the schools of one accountant: for each school the budget of its
 * current fiscal year, the warnings (lines used up or nearly used up, budget not entered, late
 * assignments, imprests needing action) and the pending files. The accountant sees their own schools;
 * the system administrator may ask for any account (`?user=`).
 */
export async function schoolsOverview(s: Identity, query: Record<string, any>) {
  const tenantId = s.user.tenantId;
  let user = { id: s.user.id, name: s.user.name };
  let schools: { id: string; name: string; code: string; erpCode: string; active: boolean }[];
  if (query.user && query.user !== s.user.id) {
    requireTenantAdmin(s);
    const u = await db.user.findFirst({ where: { id: parse(id, query.user), tenantId }, include: { memberships: true } });
    if (!u) throw new NotFoundException();
    user = { id: u.id, name: u.name };
    schools = await db.school.findMany({
      where: { tenantId, OR: [{ id: { in: u.memberships.map((m) => m.schoolId) } }, { createdBy: u.id }] },
      orderBy: { name: 'asc' },
    });
  } else schools = s.user.memberships.map((m) => m.school).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  schools = schools.filter((x) => x.active);
  const ids = schools.map((x) => x.id);
  const now = today();
  const [years, pending] = await Promise.all([
    db.fiscalYear.findMany({ where: { schoolId: { in: ids } }, orderBy: { startDate: 'desc' } }),
    pendingBySchool(tenantId, schools),
  ]);
  // The fiscal year shown: the open one containing today, else the latest open one, else the latest.
  const yearOf = (school: string) => {
    const own = years.filter((y) => y.schoolId === school);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return own.find((y) => !y.closed && day(y.startDate) <= now && day(y.endDate) >= now) ?? own.find((y) => !y.closed) ?? own[0] ?? null;
  };
  const chosen = schools.map((x) => ({ school: x, year: yearOf(x.id) }));
  const budgets = await db.budget.findMany({
    where: { OR: chosen.filter((c) => c.year).map((c) => ({ schoolId: c.school.id, yearId: c.year!.id })) },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  const rows = chosen.map(({ school, year }) => {
    const lines = budgets.filter((b) => b.schoolId === school.id && b.yearId === year?.id);
    const sum = (k: 'approved' | 'committed' | 'spent') => lines.reduce((v, b) => v.plus(b[k]), new D(0));
    const approved = sum('approved'),
      committed = sum('committed'),
      spent = sum('spent');
    const available = approved.minus(committed).minus(spent);
    const p = pending.find((x) => x.id === school.id)!;
    const warnings: { level: 'danger' | 'warn' | 'info'; text: string }[] = [];
    if (!year) warnings.push({ level: 'info', text: 'لا يوجد عام مالي' });
    else if (approved.eq(0)) warnings.push({ level: 'info', text: 'لم تُدخل مبالغ الموازنة المعتمدة بعد' });
    for (const b of lines.filter((b) => b.approved.gt(0))) {
      const left = b.approved.minus(b.committed).minus(b.spent);
      if (left.lte(0)) warnings.push({ level: 'danger', text: `نفد رصيد البند ${b.code} — ${b.name}` });
      else if (left.div(b.approved).lt(LOW))
        warnings.push({ level: 'warn', text: `قارب رصيد البند ${b.code} — ${b.name} على النفاد (المتبقي ${num(left)} ر.ق)` });
    }
    if (p.late) warnings.push({ level: 'danger', text: `${p.late} تكليف تجاوز موعد التنفيذ` });
    for (const r of p.replenish) warnings.push({ level: 'warn', text: `${r.name} بلغت حد الاستعاضة` });
    for (const a of p.awaiting) warnings.push({ level: 'info', text: `${a.name}: استعاضة ${a.amount} ر.ق لم يُؤكد استلامها` });
    if (p.oldest > STALE_DAYS) warnings.push({ level: 'warn', text: `معاملة تنتظر منذ ${p.oldest} يوماً` });
    return {
      id: school.id,
      name: school.name,
      code: school.code,
      erpCode: school.erpCode,
      year: year ? { id: year.id, label: year.label, closed: year.closed } : null,
      approved: num(approved),
      committed: num(committed),
      spent: num(spent),
      available: num(available),
      used: approved.gt(0) ? committed.plus(spent).div(approved).toNumber() : 0,
      pending: p.pending,
      stages: p.stages,
      late: p.late,
      erp: p.erp,
      oldest: p.oldest,
      warnings,
    };
  });
  const total = (k: 'approved' | 'committed' | 'spent' | 'available') => num(rows.reduce((v, r) => v.plus(r[k]), new D(0)));
  return {
    user,
    totals: {
      schools: rows.length,
      approved: total('approved'),
      committed: total('committed'),
      spent: total('spent'),
      available: total('available'),
      pending: rows.reduce((n, r) => n + r.pending, 0),
      warnings: rows.reduce((n, r) => n + r.warnings.filter((w) => w.level !== 'info').length, 0),
    },
    schools: rows,
  };
}

/** Administrator follow-up: per account, the unfinished files waiting more than two weeks and the late assignments. */
export async function followUp(s: Identity) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  const limit = new Date(Date.now() - STALE_DAYS * 86400000);
  const [users, cases] = await Promise.all([
    db.user.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, username: true } }),
    db.case.findMany({
      where: {
        school: { tenantId, active: true },
        state: { in: ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED'] },
        year: { closed: false },
        OR: [{ createdAt: { lt: limit } }, { dueDate: { lt: new Date(today()) } }],
      },
      select: {
        id: true,
        createdBy: true,
        createdAt: true,
        issueDate: true,
        dueDate: true,
        state: true,
        number: true,
        subject: true,
        school: { select: { name: true } },
      },
    }),
  ]);
  const t = today();
  return users
    .map((u) => {
      const own = cases.filter((c) => c.createdBy === u.id);
      const stale = own.filter((c) => (c.issueDate ?? c.createdAt) < limit);
      const late = own.filter((c) => ['ORDERED', 'PARTIAL'].includes(c.state) && c.dueDate && c.dueDate.toISOString().slice(0, 10) < t);
      const oldest = own.reduce((m, c) => Math.max(m, Math.floor((Date.now() - (c.issueDate ?? c.createdAt).getTime()) / 86400000)), 0);
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        stale: stale.length,
        late: late.length,
        oldest,
        items: [...new Map([...late, ...stale].map((c) => [c.id, c])).values()]
          .slice(0, 8)
          .map((c) => ({ id: c.id, number: c.number, subject: c.subject, school: c.school.name })),
      };
    })
    .filter((u) => u.stale || u.late)
    .sort((a, b) => b.late - a.late || b.oldest - a.oldest);
}

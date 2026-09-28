import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { D, num } from '../common/money';
import { date, fail, id, parse, text } from '../common/validation';
import { passwordHash, requireTenantAdmin, type Identity } from '../core/identity';
import { dateHtml, esc, money, num as numHtml, printDocument } from '../print/layout';

/** Case states counted as completed work; cancelled cases are reported separately. */
const DONE = ['COMPLETE', 'REGISTERED'];
const OPEN = ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED', 'CERTIFIED'];

const STATE_NAMES: Record<string, string> = {
  DRAFT: 'مسودة',
  EVALUATED: 'بانتظار الاعتماد',
  APPROVED: 'معتمد للتكليف',
  ORDERED: 'قيد التوريد',
  PARTIAL: 'توريد جزئي',
  DELIVERED: 'مستلم بالكامل',
  CERTIFIED: 'صدرت الشهادة',
  COMPLETE: 'جاهزة لـ ERP',
  REGISTERED: 'مسجلة في ERP',
  CANCELLED: 'ملغاة',
};
const ROLE_NAMES: Record<string, string> = {
  ACCOUNTANT: 'محاسب',
  REVIEWER: 'مراجع',
  APPROVER: 'معتمد',
  ERP: 'مسجل ERP',
  AUDITOR: 'مدقق',
  ADMIN: 'مسؤول المدرسة',
};

const sumOf = (rows: { _sum: Record<string, any> }[], key: string) => rows.reduce((a, r) => a.plus(r._sum[key] ?? 0), new D(0));

/**
 * System administrator console: every account with its completed and in-progress work, and every
 * school with its activity, budget and imprest position.
 */
export async function adminOverview(s: Identity) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  const schools = await db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  const schoolIds = schools.map((x) => x.id);
  const inTenant = { schoolId: { in: schoolIds } };
  const [users, cases, approvals, certs, expenses, settlements, activity, budgets, imprests, certsBySchool] = await Promise.all([
    db.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        username: true,
        active: true,
        isTenantAdmin: true,
        lastLoginAt: true,
        memberships: { select: { schoolId: true, roles: true } },
      },
      orderBy: { name: 'asc' },
    }),
    db.case.groupBy({ by: ['createdBy', 'schoolId', 'state'], where: inTenant, _count: true, _sum: { total: true } }),
    db.case.groupBy({ by: ['evaluationBy'], where: { ...inTenant, evaluationBy: { not: null } }, _count: true }),
    db.certificate.groupBy({ by: ['issuedBy'], where: { case: inTenant }, _count: true, _sum: { net: true } }),
    db.expense.groupBy({ by: ['createdBy'], where: inTenant, _count: true, _sum: { amount: true } }),
    db.settlement.groupBy({ by: ['actor'], where: { imprest: inTenant }, _count: true, _sum: { amount: true } }),
    db.audit.groupBy({ by: ['actor'], where: { OR: [inTenant, { tenantId }] }, _count: true, _max: { createdAt: true } }),
    db.budget.groupBy({
      by: ['schoolId'],
      where: { ...inTenant, year: { closed: false } },
      _sum: { approved: true, committed: true, spent: true },
    }),
    db.imprest.groupBy({ by: ['schoolId'], where: { ...inTenant, closed: false }, _count: true, _sum: { balance: true } }),
    db.certificate.findMany({ where: { case: inTenant }, select: { case: { select: { schoolId: true } } } }),
  ]);
  const accounts = users.map((u) => {
    const mine = cases.filter((c) => c.createdBy === u.id);
    const count = (states: string[]) => mine.filter((c) => states.includes(c.state)).reduce((n, c) => n + c._count, 0);
    const value = (states: string[]) =>
      sumOf(
        mine.filter((c) => states.includes(c.state)),
        'total',
      );
    return {
      ...u,
      schools: u.memberships.map((m) => ({ ...m, name: schools.find((x) => x.id === m.schoolId)?.name ?? '' })),
      cases: {
        done: count(DONE),
        doneValue: num(value(DONE)),
        open: count(OPEN),
        openValue: num(value(OPEN)),
        cancelled: count(['CANCELLED']),
      },
      approvals: approvals.find((a) => a.evaluationBy === u.id)?._count ?? 0,
      certificates: certs.find((c) => c.issuedBy === u.id)?._count ?? 0,
      pettyInvoices: expenses.find((e) => e.createdBy === u.id)?._count ?? 0,
      pettyAmount: num(expenses.find((e) => e.createdBy === u.id)?._sum.amount ?? 0),
      settlements: settlements.find((x) => x.actor === u.id)?._count ?? 0,
      actions: activity.find((a) => a.actor === u.id)?._count ?? 0,
      lastActivity: activity.find((a) => a.actor === u.id)?._max.createdAt ?? null,
    };
  });
  const schoolRows = schools.map((sc) => {
    const own = cases.filter((c) => c.schoolId === sc.id);
    const count = (states: string[]) => own.filter((c) => states.includes(c.state)).reduce((n, c) => n + c._count, 0);
    const b = budgets.find((x) => x.schoolId === sc.id)?._sum;
    const im = imprests.find((x) => x.schoolId === sc.id);
    return {
      id: sc.id,
      code: sc.code,
      name: sc.name,
      principal: sc.principal,
      active: sc.active,
      users: users.filter((u) => u.memberships.some((m) => m.schoolId === sc.id)).length,
      casesDone: count(DONE),
      casesOpen: count(OPEN),
      certificates: certsBySchool.filter((c) => c.case.schoolId === sc.id).length,
      approved: num(b?.approved ?? 0),
      committed: num(b?.committed ?? 0),
      spent: num(b?.spent ?? 0),
      openImprests: im?._count ?? 0,
      imprestBalance: num(im?._sum.balance ?? 0),
    };
  });
  return {
    totals: {
      schools: schools.length,
      users: users.length,
      activeUsers: users.filter((u) => u.active).length,
      casesDone: accounts.reduce((n, a) => n + a.cases.done, 0),
      casesOpen: accounts.reduce((n, a) => n + a.cases.open, 0),
      certificates: certsBySchool.length,
      openImprests: imprests.reduce((n, i) => n + i._count, 0),
    },
    accounts,
    schools: schoolRows,
  };
}

/** Detailed report of one account: prepared cases (completed / in progress), approvals, certificates, imprest work and activity. */
export async function userReport(s: Identity, userId: string, query: Record<string, any>) {
  requireTenantAdmin(s);
  const user = await db.user.findFirst({
    where: { id: parse(id, userId), tenantId: s.user.tenantId },
    include: { memberships: { include: { school: true } } },
  });
  if (!user) throw new NotFoundException();
  const from = query.from ? parse(date, query.from) : undefined,
    to = query.to ? parse(date, query.to) : undefined;
  const period = (field: string) =>
    from || to
      ? {
          [field]: {
            ...(from ? { gte: new Date(from + 'T00:00:00+03:00') } : {}),
            ...(to ? { lt: new Date(new Date(to + 'T00:00:00+03:00').getTime() + 86400000) } : {}),
          },
        }
      : {};
  const schools = { school: { tenantId: s.user.tenantId } };
  const [prepared, approved, certificates, expenses, settlements, actions] = await Promise.all([
    db.case.findMany({
      where: { createdBy: user.id, ...schools, ...period('createdAt') },
      include: { school: true, supplier: true, erp: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.case.findMany({
      where: { evaluationBy: user.id, ...schools, ...period('createdAt') },
      include: { school: true, supplier: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.certificate.findMany({
      where: { issuedBy: user.id, case: schools, ...period('createdAt') },
      include: { case: { include: { school: true, supplier: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.expense.groupBy({
      by: ['imprestId'],
      where: { createdBy: user.id, ...period('date') },
      _count: true,
      _sum: { amount: true },
    }),
    db.settlement.findMany({
      where: { actor: user.id, imprest: { schoolId: { in: user.memberships.map((m) => m.schoolId) } }, ...period('createdAt') },
      include: { imprest: { include: { year: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.audit.groupBy({ by: ['action'], where: { actor: user.id, ...period('createdAt') }, _count: true }),
  ]);
  const imprestRows = await db.imprest.findMany({ where: { id: { in: expenses.map((e) => e.imprestId) } }, include: { year: true } });
  const schoolName = async (schoolId: string) => (await db.school.findUnique({ where: { id: schoolId } }))?.name ?? '';
  const report = {
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      active: user.active,
      isTenantAdmin: user.isTenantAdmin,
      lastLoginAt: user.lastLoginAt,
      schools: user.memberships.map((m) => ({ name: m.school.name, roles: m.roles.map((r) => ROLE_NAMES[r] ?? r) })),
    },
    period: { from: from ?? null, to: to ?? null },
    summary: {
      done: prepared.filter((c) => DONE.includes(c.state)).length,
      open: prepared.filter((c) => OPEN.includes(c.state)).length,
      cancelled: prepared.filter((c) => c.state === 'CANCELLED').length,
      approvals: approved.length,
      certificates: certificates.length,
      pettyInvoices: expenses.reduce((n, e) => n + e._count, 0),
      pettyAmount: num(expenses.reduce((a, e) => a.plus(e._sum.amount ?? 0), new D(0))),
      settlements: settlements.length,
      actions: actions.reduce((n, a) => n + a._count, 0),
    },
    prepared: prepared.map((c) => ({
      id: c.id,
      number: c.number,
      school: c.school.name,
      subject: c.subject,
      supplier: c.supplier?.name ?? '',
      orderNumber: c.orderNumber ?? '',
      total: num(c.total),
      state: c.state,
      stateName: STATE_NAMES[c.state],
      status: DONE.includes(c.state) ? 'منجزة' : c.state === 'CANCELLED' ? 'ملغاة' : 'قيد الإعداد',
      createdAt: c.createdAt,
      erp: c.erp?.reference ?? '',
    })),
    approved: approved.map((c) => ({
      number: c.number,
      school: c.school.name,
      subject: c.subject,
      total: num(c.total),
      stateName: STATE_NAMES[c.state],
    })),
    certificates: certificates.map((c) => ({
      number: c.number,
      school: c.case.school.name,
      supplier: c.case.supplier?.name ?? '',
      kind: c.kind === 'FINAL' ? 'نهائية' : 'جزئية',
      net: num(c.net),
      fine: num(c.fine),
      createdAt: c.createdAt,
    })),
    imprests: await Promise.all(
      expenses.map(async (e) => {
        const im = imprestRows.find((x) => x.id === e.imprestId)!;
        return {
          name: im.name,
          school: await schoolName(im.schoolId),
          year: im.year.label,
          invoices: e._count,
          amount: num(e._sum.amount ?? 0),
        };
      }),
    ),
    settlements: await Promise.all(
      settlements.map(async (x) => ({
        imprest: x.imprest.name,
        school: await schoolName(x.imprest.schoolId),
        number: x.number,
        type: x.type === 'REPLENISH' ? 'استعاضة' : 'تسوية وإغلاق',
        amount: num(x.amount),
        createdAt: x.createdAt,
      })),
    ),
    activity: actions.map((a) => ({ action: a.action, count: a._count })).sort((a, b) => b.count - a.count),
  };
  if (query.format === 'print' || query.pdf === '1') return { html: userReportDocument(report) };
  if (query.format === 'xlsx') return userReportWorkbook(report);
  return report;
}

type Report = Record<string, any>;

function userReportDocument(r: Report) {
  const table = (heads: string[], rows: string[][]) =>
    rows.length
      ? `<table class="dense"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      : '<p class="muted">لا توجد سجلات.</p>';
  const s = r.summary;
  const body = `
<h1>تقرير أعمال الحساب</h1>
<table class="grid">
<tr><td class="k">الاسم</td><td>${esc(r.user.name)}</td><td class="k">اسم الدخول</td><td>${numHtml(r.user.username)}</td></tr>
<tr><td class="k">الحالة</td><td>${r.user.active ? 'فعال' : 'موقوف'}${r.user.isTenantAdmin ? ' — مسؤول النظام' : ''}</td><td class="k">آخر دخول</td><td>${r.user.lastLoginAt ? dateHtml(r.user.lastLoginAt) : '—'}</td></tr>
<tr><td class="k">الفترة</td><td colspan="3">${r.period.from || r.period.to ? `من ${dateHtml(r.period.from)} إلى ${dateHtml(r.period.to)}` : 'كل الفترات'}</td></tr>
<tr><td class="k">المدارس والصلاحيات</td><td colspan="3">${r.user.schools.map((m: any) => `${esc(m.name)} (${esc(m.roles.join('، '))})`).join('<br>') || '—'}</td></tr>
</table>
<h2>الملخص</h2>
<table><thead><tr><th>معاملات منجزة</th><th>قيد الإعداد</th><th>ملغاة</th><th>اعتمادات</th><th>شهادات أصدرها</th><th>فواتير عهد</th><th>تسويات عهد</th><th>عمليات مسجلة</th></tr></thead>
<tbody><tr><td>${s.done}</td><td>${s.open}</td><td>${s.cancelled}</td><td>${s.approvals}</td><td>${s.certificates}</td><td>${s.pettyInvoices} (${money(s.pettyAmount)})</td><td>${s.settlements}</td><td>${s.actions}</td></tr></tbody></table>
<h2>المعاملات التي أعدها</h2>
${table(
  ['الرقم', 'المدرسة', 'الموضوع', 'المورد', 'أمر الشراء', 'القيمة', 'الحالة', 'الوضع'],
  r.prepared.map((c: any) => [
    numHtml(c.number),
    esc(c.school),
    esc(c.subject),
    esc(c.supplier),
    numHtml(c.orderNumber),
    money(c.total),
    esc(c.stateName),
    `<b>${esc(c.status)}</b>`,
  ]),
)}
<h2>الاعتمادات</h2>
${table(
  ['الرقم', 'المدرسة', 'الموضوع', 'القيمة', 'الحالة'],
  r.approved.map((c: any) => [numHtml(c.number), esc(c.school), esc(c.subject), money(c.total), esc(c.stateName)]),
)}
<h2>شهادات الإنجاز الصادرة</h2>
${table(
  ['الشهادة', 'المدرسة', 'المورد', 'النوع', 'الغرامة', 'الصافي', 'التاريخ'],
  r.certificates.map((c: any) => [
    numHtml(c.number),
    esc(c.school),
    esc(c.supplier),
    esc(c.kind),
    money(c.fine),
    money(c.net),
    dateHtml(c.createdAt),
  ]),
)}
<h2>العهد</h2>
${table(
  ['العهدة', 'المدرسة', 'العام', 'عدد الفواتير', 'المبلغ'],
  r.imprests.map((x: any) => [esc(x.name), esc(x.school), numHtml(x.year), numHtml(x.invoices), money(x.amount)]),
)}
${table(
  ['العهدة', 'المدرسة', 'الكشف', 'النوع', 'المبلغ', 'التاريخ'],
  r.settlements.map((x: any) => [esc(x.imprest), esc(x.school), numHtml(x.number), esc(x.type), money(x.amount), dateHtml(x.createdAt)]),
)}`;
  return printDocument({ title: 'تقرير أعمال الحساب', ref: r.user.username, date: new Date(), body });
}

async function userReportWorkbook(r: Report) {
  const wb = new ExcelJS.Workbook();
  const add = (name: string, heads: string[], rows: unknown[][]) => {
    const sheet = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
    sheet.addRow(heads).font = { bold: true };
    for (const row of rows) sheet.addRow(row);
    sheet.columns.forEach((c) => (c.width = 22));
  };
  add(
    'المعاملات',
    ['الرقم', 'المدرسة', 'الموضوع', 'المورد', 'أمر الشراء', 'القيمة', 'الحالة', 'الوضع', 'ERP'],
    r.prepared.map((c: any) => [c.number, c.school, c.subject, c.supplier, c.orderNumber, Number(c.total), c.stateName, c.status, c.erp]),
  );
  add(
    'الاعتمادات',
    ['الرقم', 'المدرسة', 'الموضوع', 'القيمة', 'الحالة'],
    r.approved.map((c: any) => [c.number, c.school, c.subject, Number(c.total), c.stateName]),
  );
  add(
    'الشهادات',
    ['الشهادة', 'المدرسة', 'المورد', 'النوع', 'الغرامة', 'الصافي'],
    r.certificates.map((c: any) => [c.number, c.school, c.supplier, c.kind, Number(c.fine), Number(c.net)]),
  );
  add(
    'العهد',
    ['العهدة', 'المدرسة', 'العام', 'الفواتير', 'المبلغ'],
    r.imprests.map((x: any) => [x.name, x.school, x.year, x.invoices, Number(x.amount)]),
  );
  return {
    base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    name: `account-report-${r.user.username}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/** Account management: reset password, activate / deactivate, rename, grant or revoke system administration. */
export async function manageUser(s: Identity, t: Tx, userId: string | undefined, action: string | undefined, body: any) {
  requireTenantAdmin(s);
  const user = await t.user.findFirst({ where: { id: parse(id, userId), tenantId: s.user.tenantId } });
  if (!user) throw new NotFoundException();
  if (action === 'password') {
    const p = parse(z.object({ password: z.string().min(12).max(128) }).strict(), body);
    await t.session.deleteMany({ where: { userId: user.id } });
    await t.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash(p.password) } });
    return { id: user.id, passwordReset: true };
  }
  if (action === 'status') {
    const p = parse(z.object({ active: z.boolean() }).strict(), body);
    if (user.id === s.user.id && !p.active) fail('لا يمكنك إيقاف حسابك');
    if (!p.active) await t.session.deleteMany({ where: { userId: user.id } });
    return t.user.update({ where: { id: user.id }, data: { active: p.active }, select: { id: true, active: true } });
  }
  if (!action) {
    const p = parse(z.object({ name: text, isTenantAdmin: z.boolean() }).strict(), body);
    if (user.id === s.user.id && !p.isTenantAdmin) fail('لا يمكنك إلغاء صلاحية مسؤول النظام عن حسابك');
    return t.user.update({ where: { id: user.id }, data: p, select: { id: true, name: true, isTenantAdmin: true } });
  }
  throw new NotFoundException();
}

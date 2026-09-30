import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { STATE_NAMES } from '../core/documents';
import { db, type Tx } from '../common/db';
import { D, num } from '../common/money';
import { date, fail, id, parse, text } from '../common/validation';
import { deviceOf, nearestSchool } from '../core/geo';
import { setEmail } from './email';
import { passwordHash, requireTenantAdmin, type Identity } from '../core/identity';
import { dateHtml, esc, money, num as numHtml, printDocument } from '../print/layout';

/** Case states counted as completed work; cancelled cases are reported separately. */
const DONE = ['CERTIFIED', 'COMPLETE', 'REGISTERED'];
const OPEN = ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED'];

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
        email: true,
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
  const [direct, logins] = await Promise.all([
    db.directExpense.groupBy({ by: ['createdBy'], where: inTenant, _count: true, _sum: { amount: true } }),
    db.loginLog.groupBy({ by: ['userId'], where: { user: { tenantId } }, _count: true }),
  ]);
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? '';
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
      settledAmount: num(settlements.find((x) => x.actor === u.id)?._sum.amount ?? 0),
      directCount: direct.find((x) => x.createdBy === u.id)?._count ?? 0,
      directAmount: num(direct.find((x) => x.createdBy === u.id)?._sum.amount ?? 0),
      schoolCount: u.isTenantAdmin ? schools.length : u.memberships.length,
      schoolsAdded: schools.filter((x) => x.createdBy === u.id).length,
      totalCases: mine.reduce((n, c) => n + c._count, 0),
      logins: logins.find((l) => l.userId === u.id)?._count ?? 0,
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
      owner: nameOf(sc.createdBy),
      located: sc.lat != null,
      accountants: users
        .filter((u) => !u.isTenantAdmin && u.memberships.some((m) => m.schoolId === sc.id))
        .map((u) => u.name)
        .join('، '),
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
<table><thead><tr><th>معاملات منجزة</th><th>قيد الإعداد</th><th>ملغاة</th><th>تقارير عروض</th><th>شهادات أصدرها</th><th>فواتير عهد</th><th>تسويات عهد</th><th>عمليات مسجلة</th></tr></thead>
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
<h2>تقارير عروض الأسعار الصادرة</h2>
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
    'تقارير عروض الأسعار',
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
  if (!userId) {
    // A new account starts with no schools: the accountant adds their own schools (or the administrator assigns some).
    const p = parse(
      z
        .object({
          name: text,
          username: z
            .string()
            .trim()
            .regex(/^[a-zA-Z0-9_.-]{3,50}$/, 'اسم الدخول: حروف إنجليزية وأرقام فقط (3 على الأقل)'),
          password: z.string().min(8).max(128),
          isTenantAdmin: z.boolean().default(false),
        })
        .strict(),
      body,
    );
    if (await t.user.findUnique({ where: { username: p.username } })) fail('اسم الدخول مستخدم');
    const { password, ...data } = p;
    return t.user.create({
      data: { ...data, tenantId: s.user.tenantId, passwordHash: await passwordHash(password) },
      select: { id: true, name: true, username: true },
    });
  }
  const user = await t.user.findFirst({ where: { id: parse(id, userId), tenantId: s.user.tenantId } });
  if (!user) throw new NotFoundException();
  if (action === 'password') {
    const p = parse(z.object({ password: z.string().min(8).max(128) }).strict(), body);
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
  if (action === 'delete') {
    if (user.id === s.user.id) fail('لا يمكنك حذف حسابك');
    // Every recorded action is audited against its user; such an account is suspended instead.
    if (await t.audit.count({ where: { actor: user.id } })) fail('للحساب أعمال مسجلة؛ أوقف الحساب بدلاً من حذفه، أو احذف بياناته أولاً');
    await t.session.deleteMany({ where: { userId: user.id } });
    await t.membership.deleteMany({ where: { userId: user.id } });
    await t.user.delete({ where: { id: user.id } });
    return { id: user.id, deleted: true };
  }
  if (!action) {
    const p = parse(z.object({ name: text, isTenantAdmin: z.boolean(), email: z.string().max(200).optional() }).strict(), body);
    if (user.id === s.user.id && !p.isTenantAdmin) fail('لا يمكنك إلغاء صلاحية مسؤول النظام عن حسابك');
    const { email, ...data } = p;
    if (email !== undefined) await setEmail(t, user.id, email);
    return t.user.update({ where: { id: user.id }, data, select: { id: true, name: true, isTenantAdmin: true, email: true } });
  }
  throw new NotFoundException();
}

/**
 * Everything about one account for the administrator: the schools it works in with their full data
 * (entered by the accountant), the technical report (sign-ins, devices, sessions), sign-in locations
 * with the nearest school, and how the system is used.
 */
export async function accountProfile(s: Identity, userId: string) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  const user = await db.user.findFirst({
    where: { id: parse(id, userId), tenantId },
    select: { id: true, name: true, username: true, active: true, isTenantAdmin: true, lastLoginAt: true, memberships: true },
  });
  if (!user) throw new NotFoundException();
  const since = new Date(Date.now() - 365 * 86400000);
  const [allSchools, logins, sessions, actions, recent, docs] = await Promise.all([
    db.school.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    db.loginLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 500 }),
    db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, select: { lastSeen: true, createdAt: true } }),
    db.audit.groupBy({ by: ['action'], where: { actor: user.id }, _count: true, _max: { createdAt: true } }),
    db.audit.findMany({ where: { actor: user.id, createdAt: { gte: since } }, select: { createdAt: true } }),
    Promise.all([
      db.case.count({ where: { createdBy: user.id } }),
      db.case.count({ where: { evaluationBy: user.id } }),
      db.case.count({ where: { createdBy: user.id, issueDate: { not: null } } }),
      db.certificate.count({ where: { issuedBy: user.id } }),
      db.directExpense.count({ where: { createdBy: user.id } }),
      db.expense.count({ where: { createdBy: user.id } }),
      db.settlement.count({ where: { actor: user.id } }),
    ]),
  ]);
  const mine = user.isTenantAdmin
    ? allSchools
    : allSchools.filter((x) => x.createdBy === user.id || user.memberships.some((m) => m.schoolId === x.id));
  const ids = mine.map((x) => x.id);
  const [years, budgets, cases, imprests, suppliers] = await Promise.all([
    db.fiscalYear.findMany({ where: { schoolId: { in: ids } }, orderBy: { startDate: 'desc' } }),
    db.budget.groupBy({
      by: ['schoolId'],
      where: { schoolId: { in: ids }, year: { closed: false } },
      _sum: { approved: true, committed: true, spent: true },
    }),
    db.case.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: true, _sum: { total: true } }),
    db.imprest.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids }, closed: false }, _count: true }),
    db.supplier.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids } }, _count: true }),
  ]);
  const located = allSchools.filter((x) => x.lat != null);
  const months = new Map<string, number>();
  for (const r of recent) {
    const m = r.createdAt.toISOString().slice(0, 7);
    months.set(m, (months.get(m) ?? 0) + 1);
  }
  const devices = new Map<string, number>();
  for (const l of logins) devices.set(deviceOf(l.userAgent), (devices.get(deviceOf(l.userAgent)) ?? 0) + 1);
  const ips = [...new Set(logins.map((l) => l.ip))];
  return {
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      active: user.active,
      isTenantAdmin: user.isTenantAdmin,
      lastLoginAt: user.lastLoginAt,
    },
    schools: mine.map((x) => {
      const b = budgets.find((r) => r.schoolId === x.id)?._sum;
      const c = cases.find((r) => r.schoolId === x.id);
      const m = user.memberships.find((r) => r.schoolId === x.id);
      return {
        id: x.id,
        code: x.code,
        name: x.name,
        erpCode: x.erpCode,
        principal: x.principal,
        pettyCustodian: x.pettyCustodian,
        educationCustodian: x.educationCustodian,
        bookCustodian: x.bookCustodian,
        purchasingOfficer: x.purchasingOfficer,
        orderPrefix: x.orderPrefix,
        active: x.active,
        lat: x.lat,
        lng: x.lng,
        createdAt: x.createdAt,
        addedByAccount: x.createdBy === user.id,
        roles: (m?.roles ?? (user.isTenantAdmin ? ['ADMIN'] : [])).map((r) => ROLE_NAMES[r] ?? r),
        years: years.filter((y) => y.schoolId === x.id).map((y) => y.label + (y.closed ? ' (مغلق)' : '')),
        approved: num(b?.approved ?? 0),
        committed: num(b?.committed ?? 0),
        spent: num(b?.spent ?? 0),
        cases: c?._count ?? 0,
        casesValue: num(c?._sum.total ?? 0),
        openImprests: imprests.find((r) => r.schoolId === x.id)?._count ?? 0,
        suppliers: suppliers.find((r) => r.schoolId === x.id)?._count ?? 0,
      };
    }),
    technical: {
      logins: logins.length,
      firstLogin: logins.at(-1)?.createdAt ?? null,
      lastLogin: logins[0]?.createdAt ?? user.lastLoginAt,
      sharedLocation: logins.filter((l) => l.lat != null).length,
      activeSessions: sessions.length,
      lastSeen: sessions.reduce<Date | null>((a, x) => (!a || x.lastSeen > a ? x.lastSeen : a), null),
      ips: ips.slice(0, 20),
      devices: [...devices.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      actions: actions.reduce((n, a) => n + a._count, 0),
      lastActivity: actions.reduce<Date | null>((a, x) => (x._max.createdAt && (!a || x._max.createdAt > a) ? x._max.createdAt : a), null),
    },
    locations: logins
      .filter((l) => l.lat != null)
      .slice(0, 100)
      .map((l) => ({
        id: l.id,
        createdAt: l.createdAt,
        lat: l.lat,
        lng: l.lng,
        accuracy: l.accuracy,
        ip: l.ip,
        nearest: nearestSchool(l, located),
      })),
    usage: {
      documents: {
        cases: docs[0],
        quoteReports: docs[1],
        orders: docs[2],
        certificates: docs[3],
        direct: docs[4],
        invoices: docs[5],
        statements: docs[6],
      },
      byAction: actions.map((a) => ({ action: a.action, count: a._count })).sort((a, b) => b.count - a.count),
      monthly: [...months.entries()].sort().map(([month, count]) => ({ month, count })),
    },
  };
}

/** Totals of every account's transactions for a period: one row per accountant, printable and as Excel. */
export async function accountantsReport(s: Identity, query: Record<string, any>) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  const from = query.from ? parse(date, query.from) : undefined,
    to = query.to ? parse(date, query.to) : undefined;
  const range = (dateOnly = false) =>
    from || to
      ? {
          ...(from ? { gte: new Date(from + (dateOnly ? '' : 'T00:00:00+03:00')) } : {}),
          ...(to ? { lte: new Date(to + (dateOnly ? '' : 'T23:59:59.999+03:00')) } : {}),
        }
      : undefined;
  const at = (field: string, dateOnly = false) => (range(dateOnly) ? { [field]: range(dateOnly) } : {});
  const schools = await db.school.findMany({ where: { tenantId }, select: { id: true, createdBy: true } });
  const inTenant = { schoolId: { in: schools.map((x) => x.id) } };
  const [users, cases, orders, certs, direct, invoices, statements] = await Promise.all([
    db.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        username: true,
        active: true,
        isTenantAdmin: true,
        lastLoginAt: true,
        memberships: { select: { schoolId: true } },
      },
      orderBy: { name: 'asc' },
    }),
    db.case.groupBy({ by: ['createdBy', 'state'], where: { ...inTenant, ...at('createdAt') }, _count: true, _sum: { total: true } }),
    db.case.groupBy({
      by: ['createdBy'],
      where: { ...inTenant, issueDate: range(true) ?? { not: null } },
      _count: true,
      _sum: { total: true },
    }),
    db.certificate.groupBy({ by: ['issuedBy'], where: { case: inTenant, ...at('createdAt') }, _count: true, _sum: { net: true } }),
    db.directExpense.groupBy({ by: ['createdBy'], where: { ...inTenant, ...at('date', true) }, _count: true, _sum: { amount: true } }),
    db.expense.groupBy({ by: ['createdBy'], where: { ...inTenant, ...at('date', true) }, _count: true, _sum: { amount: true } }),
    db.settlement.groupBy({ by: ['actor'], where: { imprest: inTenant, ...at('createdAt') }, _count: true, _sum: { amount: true } }),
  ]);
  const only = query.user ? parse(id, query.user) : null;
  const rows = users
    .filter((u) => !only || u.id === only)
    .map((u) => {
      const own = cases.filter((c) => c.createdBy === u.id);
      const n = (states?: string[]) => own.filter((c) => !states || states.includes(c.state)).reduce((a, c) => a + c._count, 0);
      const o = orders.find((x) => x.createdBy === u.id),
        c = certs.find((x) => x.issuedBy === u.id),
        d = direct.find((x) => x.createdBy === u.id),
        i = invoices.find((x) => x.createdBy === u.id),
        st = statements.find((x) => x.actor === u.id);
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        active: u.active,
        isTenantAdmin: u.isTenantAdmin,
        schools: u.isTenantAdmin ? schools.length : u.memberships.length,
        schoolsAdded: schools.filter((x) => x.createdBy === u.id).length,
        cases: n(),
        done: n(DONE),
        open: n(OPEN),
        cancelled: n(['CANCELLED']),
        casesValue: num(
          sumOf(
            own.filter((x) => x.state !== 'CANCELLED'),
            'total',
          ),
        ),
        orders: o?._count ?? 0,
        ordersValue: num(o?._sum.total ?? 0),
        certificates: c?._count ?? 0,
        certificatesNet: num(c?._sum.net ?? 0),
        direct: d?._count ?? 0,
        directValue: num(d?._sum.amount ?? 0),
        invoices: i?._count ?? 0,
        invoicesValue: num(i?._sum.amount ?? 0),
        statements: st?._count ?? 0,
        statementsValue: num(st?._sum.amount ?? 0),
        lastLoginAt: u.lastLoginAt,
      };
    });
  const keys = [
    'schools',
    'schoolsAdded',
    'cases',
    'done',
    'open',
    'cancelled',
    'orders',
    'certificates',
    'direct',
    'invoices',
    'statements',
  ] as const;
  const money = ['casesValue', 'ordersValue', 'certificatesNet', 'directValue', 'invoicesValue', 'statementsValue'] as const;
  const totals: Record<string, any> = {};
  for (const k of keys) totals[k] = rows.reduce((a, r) => a + r[k], 0);
  for (const k of money) totals[k] = num(rows.reduce((a, r) => a.plus(r[k]), new D(0)));
  if (!only) totals.schools = schools.length;
  const report = { period: { from: from ?? null, to: to ?? null }, rows, totals };
  if (query.format === 'print' || query.pdf === '1') return { html: accountantsDocument(report) };
  if (query.format === 'xlsx') return accountantsWorkbook(report);
  return report;
}

const ACCOUNTANT_HEADS = [
  'المحاسب',
  'المدارس',
  'أضافها',
  'المعاملات',
  'منجزة',
  'قيد الإعداد',
  'ملغاة',
  'قيمة المعاملات',
  'التكليفات',
  'قيمة التكليفات',
  'الشهادات',
  'صافي الشهادات',
  'مصروفات مباشرة',
  'قيمتها',
  'فواتير العهد',
  'قيمتها',
  'كشوف التسوية',
  'قيمتها',
];
const accountantCells = (r: Report) => [
  r.schools,
  r.schoolsAdded,
  r.cases,
  r.done,
  r.open,
  r.cancelled,
  r.casesValue,
  r.orders,
  r.ordersValue,
  r.certificates,
  r.certificatesNet,
  r.direct,
  r.directValue,
  r.invoices,
  r.invoicesValue,
  r.statements,
  r.statementsValue,
];

function accountantsDocument(r: Report) {
  const cell = (v: unknown, i: number) => ([6, 8, 10, 12, 14, 16].includes(i) ? money(v as any) : numHtml(v as any));
  const body = `
<h1>تقرير إجمالي معاملات المحاسبين</h1>
<p>الفترة: ${r.period.from || r.period.to ? `من ${dateHtml(r.period.from)} إلى ${dateHtml(r.period.to)}` : 'كل الفترات'}</p>
<table class="dense"><thead><tr>${ACCOUNTANT_HEADS.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
${r.rows
  .map(
    (x: Report) =>
      `<tr><td>${esc(x.name)}${x.isTenantAdmin ? ' <small>(مدير النظام)</small>' : ''}${x.active ? '' : ' <small>(موقوف)</small>'}</td>${accountantCells(
        x,
      )
        .map((v, i) => `<td>${cell(v, i)}</td>`)
        .join('')}</tr>`,
  )
  .join('')}
<tr><th>الإجمالي</th>${accountantCells(r.totals)
    .map((v, i) => `<th>${cell(v, i)}</th>`)
    .join('')}</tr>
</tbody></table>
<p class="muted">المعاملات: ما أعده المحاسب في الفترة. التكليفات حسب تاريخ الإصدار، والمصروفات والفواتير حسب تاريخها، والشهادات والكشوف حسب تاريخ إصدارها. «المدارس»: المدارس التي يعمل بها، و«أضافها»: ما أضافه بنفسه.</p>`;
  return printDocument({
    title: 'تقرير إجمالي معاملات المحاسبين',
    ref: 'ACCOUNTANTS',
    date: new Date(),
    body,
    showRef: false,
    compact: true,
  });
}

async function accountantsWorkbook(r: Report) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('المحاسبون', { views: [{ rightToLeft: true }] });
  sheet.addRow(ACCOUNTANT_HEADS).font = { bold: true };
  for (const x of r.rows) sheet.addRow([x.name, ...accountantCells(x).map(Number)]);
  sheet.addRow(['الإجمالي', ...accountantCells(r.totals).map(Number)]).font = { bold: true };
  sheet.columns.forEach((c) => (c.width = 16));
  return {
    base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    name: 'accountants-totals.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

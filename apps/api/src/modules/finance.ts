import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { db } from '../common/db';
import { isoDay, today } from '../common/dates';
import { id, parse } from '../common/validation';
import { BUDGET_GROUPS } from '../print/budget';
import { financeReport, lineStatus, type FinanceData } from '../print/finance';
import { IMPREST_TYPES } from '../print/imprest';
import type { ReadCtx } from './context';

const n = (v: unknown) => Number(v ?? 0);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const inPeriod = (d: Date | string | null | undefined, from: string, to: string) => {
  if (!d) return false;
  const v = typeof d === 'string' ? d.slice(0, 10) : isoDay(d);
  return v >= from && v <= to;
};
const OPEN = ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED'];

/** Figures of the comprehensive financial report for a school, fiscal year and period. */
async function gather(s: ReadCtx['s'], school: string, query: Record<string, any>): Promise<FinanceData> {
  const year = await db.fiscalYear.findUnique({ where: { id: parse(id, query.year), schoolId: school }, include: { school: true } });
  if (!year) throw new NotFoundException();
  const from = DAY.test(String(query.from ?? '')) ? String(query.from) : isoDay(year.startDate);
  const to = DAY.test(String(query.to ?? '')) ? String(query.to) : isoDay(year.endDate);
  const where = { schoolId: school, yearId: year.id };
  const [budgets, cases, imprests] = await Promise.all([
    db.budget.findMany({ where, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    db.case.findMany({
      where,
      select: {
        state: true,
        total: true,
        reportDate: true,
        createdAt: true,
        evaluationHtml: true,
        issueDate: true,
        dueDate: true,
        supplier: { select: { name: true } },
        quotes: { select: { total: true, compliant: true, supplierId: true } },
        supplierId: true,
        certificates: { select: { net: true, fine: true, createdAt: true, details: true, coverHtml: true } },
      },
    }),
    db.imprest.findMany({ where, include: { expenses: true, settlements: { select: { amount: true } } }, orderBy: { createdAt: 'asc' } }),
  ]);

  const start = Date.parse(isoDay(year.startDate)),
    end = Date.parse(isoDay(year.endDate));
  const elapsed = Math.min(1, Math.max(0, (Date.parse(today()) - start) / (end - start || 1)));

  const keyOf = (g: string) => (BUDGET_GROUPS.some((x) => x.key === g) ? g : 'OTHER');
  const lines = budgets
    .filter((b) => b.approved.gt(0) || b.spent.gt(0) || b.committed.gt(0))
    .map((b) => ({
      key: b.id,
      code: b.code,
      name: b.name,
      group: keyOf(b.groupKey),
      approved: n(b.approved),
      spent: n(b.spent),
      committed: n(b.committed),
    }));
  const groups = [...BUDGET_GROUPS, { key: 'OTHER', ar: 'بنود أخرى' }]
    .map((g) => {
      const rows = lines.filter((l) => l.group === g.key);
      return {
        key: g.key,
        name: g.ar,
        approved: rows.reduce((v, l) => v + l.approved, 0),
        spent: rows.reduce((v, l) => v + l.spent, 0),
        committed: rows.reduce((v, l) => v + l.committed, 0),
      };
    })
    .filter((g) => g.approved > 0 || g.spent > 0);

  const certDate = (c: { createdAt: Date; details: any }) => String(c.details?.date ?? isoDay(c.createdAt));
  const reports = cases.filter((c) => c.evaluationHtml && inPeriod(c.reportDate ?? c.createdAt, from, to));
  const orders = cases.filter((c) => inPeriod(c.issueDate, from, to));
  const certs = cases.flatMap((c) => c.certificates.map((x) => ({ ...x, case: c }))).filter((x) => inPeriod(certDate(x), from, to));
  const expenses = imprests.flatMap((a) => a.expenses).filter((e) => inPeriod(e.date, from, to));

  // Competition savings: average of the compliant quotes received minus the awarded quote.
  let savings = 0;
  for (const c of reports) {
    const q = c.quotes.filter((x) => x.compliant);
    if (q.length < 2) continue;
    const avg = q.reduce((v, x) => v + n(x.total), 0) / q.length;
    const won = q.find((x) => x.supplierId === c.supplierId) ?? q.reduce((a, b) => (n(a.total) <= n(b.total) ? a : b));
    savings += Math.max(0, avg - n(won.total));
  }
  const leads = certs.filter((x) => x.case.issueDate).map((x) => (Date.parse(certDate(x)) - x.case.issueDate!.getTime()) / 86400000);
  const now = today();

  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7) && months.length < 24;) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const monthly = months.map((m) => ({
    month: m,
    orders: orders.filter((c) => isoDay(c.issueDate!).startsWith(m)).reduce((v, c) => v + n(c.total), 0),
    certificates: certs.filter((x) => certDate(x).startsWith(m)).reduce((v, x) => v + n(x.net), 0),
    imprests: expenses.filter((e) => isoDay(e.date).startsWith(m)).reduce((v, e) => v + n(e.amount), 0),
  }));

  const bySupplier = new Map<string, { name: string; value: number; count: number }>();
  for (const c of orders) {
    const name = c.supplier?.name ?? '—';
    const row = bySupplier.get(name) ?? { name, value: 0, count: 0 };
    row.value += n(c.total);
    row.count += 1;
    bySupplier.set(name, row);
  }
  const incomplete = cases.filter((c) => OPEN.includes(c.state));

  return {
    school: year.school.name,
    principal: year.school.principal,
    year: year.label,
    from,
    to,
    preparedBy: s.user.name,
    elapsed,
    groups,
    lines,
    docs: {
      reports: reports.length,
      reportsValue: reports.reduce((v, c) => v + n(c.total), 0),
      orders: orders.length,
      ordersValue: orders.reduce((v, c) => v + n(c.total), 0),
      certificates: certs.length,
      certificatesNet: certs.reduce((v, x) => v + n(x.net), 0),
      fines: certs.reduce((v, x) => v + n(x.fine), 0),
      covers: certs.filter((x) => x.coverHtml).length,
      avgQuotes: reports.length ? reports.reduce((v, c) => v + c.quotes.length, 0) / reports.length : 0,
      savings,
      avgLead: leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null,
      onTime: certs.length ? certs.filter((x) => !n((x.details as any)?.lateDays)).length / certs.length : null,
      incomplete: incomplete.length,
      incompleteValue: incomplete.reduce((v, c) => v + n(c.total), 0),
      late: cases.filter((c) => ['ORDERED', 'PARTIAL'].includes(c.state) && c.dueDate && isoDay(c.dueDate) < now).length,
    },
    monthly,
    suppliers: [...bySupplier.values()].sort((a, b) => b.value - a.value),
    imprests: imprests.map((a) => ({
      name: a.name,
      type: IMPREST_TYPES[a.type] ?? a.type,
      amount: n(a.amount),
      spent: a.expenses.reduce((v, e) => v + n(e.amount), 0),
      settled: a.settlements.reduce((v, x) => v + n(x.amount), 0),
      balance: n(a.balance),
      closed: a.closed,
    })),
  };
}

/** GET schools/:school/financial-report?year=&from=&to=[&format=xlsx] — printable report, PDF or Excel. */
export async function readFinancialReport({ s, school, query }: ReadCtx) {
  const d = await gather(s, school, query);
  if (query.format === 'xlsx') return { base64: await workbook(d), name: `financial-report-${d.year}.xlsx`, mime: XLSX };
  return { html: financeReport(d) };
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbook(d: FinanceData) {
  const wb = new ExcelJS.Workbook();
  const head = (ws: ExcelJS.Worksheet, cells: string[]) => {
    const r = ws.addRow(cells);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF861B3A' } }));
  };
  const pctFmt = '0.0%',
    moneyFmt = '#,##0.00';
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
  const plain = (html: string) =>
    html
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'");

  const sum = wb.addWorksheet('الملخص', { views: [{ rightToLeft: true }] });
  sum.addRow(['التقرير المالي الشامل']).font = { bold: true, size: 14 };
  sum.addRow(['المدرسة', d.school, 'مدير المدرسة', d.principal]);
  sum.addRow(['العام المالي', d.year, 'الفترة', `${d.from} — ${d.to}`]);
  sum.addRow(['إعداد', d.preparedBy, 'المنقضي من العام', d.elapsed]).getCell(4).numFmt = pctFmt;
  sum.addRow([]);
  head(sum, ['المجموعة', 'المعتمد', 'المنصرف الفعلي', 'الارتباطات', 'الرصيد', 'نسبة الصرف', 'الحالة']);
  for (const g of d.groups) {
    const r = sum.addRow([
      g.name,
      g.approved,
      g.spent,
      g.committed,
      g.approved - g.spent - g.committed,
      ratio(g.spent, g.approved),
      lineStatus(ratio(g.spent + g.committed, g.approved), d.elapsed).label,
    ]);
    [2, 3, 4, 5].forEach((i) => (r.getCell(i).numFmt = moneyFmt));
    r.getCell(6).numFmt = pctFmt;
  }
  const t = (k: 'approved' | 'spent' | 'committed') => d.groups.reduce((v, g) => v + g[k], 0);
  const total = sum.addRow([
    'الإجمالي',
    t('approved'),
    t('spent'),
    t('committed'),
    t('approved') - t('spent') - t('committed'),
    ratio(t('spent'), t('approved')),
  ]);
  total.font = { bold: true };
  [2, 3, 4, 5].forEach((i) => (total.getCell(i).numFmt = moneyFmt));
  total.getCell(6).numFmt = pctFmt;
  sum.columns.forEach((c, i) => (c.width = i === 1 ? 60 : 20));

  const lines = wb.addWorksheet('البنود', { views: [{ rightToLeft: true }] });
  head(lines, ['الرمز', 'البند', 'المجموعة', 'المعتمد', 'المنصرف', 'الارتباطات', 'الرصيد', 'نسبة الاستخدام', 'الحالة']);
  for (const l of d.lines) {
    const r = lines.addRow([
      l.code,
      l.name,
      d.groups.find((g) => g.key === l.group)?.name ?? '',
      l.approved,
      l.spent,
      l.committed,
      l.approved - l.spent - l.committed,
      ratio(l.spent + l.committed, l.approved),
      lineStatus(ratio(l.spent + l.committed, l.approved), d.elapsed).label,
    ]);
    [4, 5, 6, 7].forEach((i) => (r.getCell(i).numFmt = moneyFmt));
    r.getCell(8).numFmt = pctFmt;
  }
  lines.columns.forEach((c) => (c.width = 20));

  const monthly = wb.addWorksheet('شهري', { views: [{ rightToLeft: true }] });
  head(monthly, ['الشهر', 'التكليفات', 'شهادات الإنجاز (صافي)', 'مصروفات العهد']);
  d.monthly.forEach((m) =>
    monthly.addRow([m.month, m.orders, m.certificates, m.imprests]).eachCell((c, i) => i > 1 && (c.numFmt = moneyFmt)),
  );
  monthly.columns.forEach((c) => (c.width = 22));

  const sup = wb.addWorksheet('الموردون', { views: [{ rightToLeft: true }] });
  head(sup, ['المورد', 'عدد التكليفات', 'القيمة', 'الحصة']);
  const supTotal = d.suppliers.reduce((v, x) => v + x.value, 0);
  d.suppliers.forEach((x) => {
    const r = sup.addRow([x.name, x.count, x.value, ratio(x.value, supTotal)]);
    r.getCell(3).numFmt = moneyFmt;
    r.getCell(4).numFmt = pctFmt;
  });
  sup.columns.forEach((c, i) => (c.width = i ? 18 : 40));

  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

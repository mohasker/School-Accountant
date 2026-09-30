import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { isoDay, today } from '../common/dates';
import { D, num } from '../common/money';
import { fail, id, parse } from '../common/validation';
import { ACCOUNT, scope, type Identity } from '../core/identity';
import { posting, ZERO } from '../core/ledger';
import { audit, openYear } from '../core/transaction';
import { dateHtml, esc, money, printDocument } from '../print/layout';
import type { ReadCtx, WriteCtx } from './context';

/**
 * Monthly ERP expense report ↔ system. The PDF is read line by line; a line that carries the code of
 * a budget line gives that line's amounts. The system side is the actual expense recorded for the
 * same period (certificates, imprest invoices, direct expenses, by their own dates). A difference
 * where ERP shows more can be settled by a direct expense; one where the system shows more is listed
 * for the accountant to check (usually not yet recorded in ERP).
 */

// pdfjs is an ES module; this keeps a real dynamic import in the compiled CommonJS output.
const esm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
const DIGITS = (v: string) =>
  v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const NUMBER = /\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|\(?-?\d+(?:\.\d+)?\)?/g;

/** Text lines of the PDF (items on the same baseline joined left to right). */
export async function pdfLines(data: Buffer) {
  const pdfjs = await esm('pdfjs-dist/legacy/build/pdf.mjs');
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  } catch {
    fail('تعذر قراءة ملف PDF؛ تأكد أنه تقرير ERP الأصلي وليس صورة ممسوحة');
  }
  const lines: string[][] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 60); p++) {
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items
      .filter((i: any) => typeof i.str === 'string' && i.str.trim())
      .map((i: any) => ({ s: DIGITS(i.str.trim()), x: i.transform[4], y: i.transform[5] }))
      .sort((a: any, b: any) => b.y - a.y || a.x - b.x);
    let row: typeof items = [];
    for (const it of items) {
      if (row.length && Math.abs(row[0].y - it.y) > 3) {
        lines.push(row.sort((a: any, b: any) => a.x - b.x).map((r: any) => r.s));
        row = [];
      }
      row.push(it);
    }
    if (row.length) lines.push(row.sort((a: any, b: any) => a.x - b.x).map((r: any) => r.s));
  }
  await doc.destroy();
  return lines;
}

const amountOf = (raw: string) => {
  const neg = raw.startsWith('(') || raw.startsWith('-');
  const v = Number(raw.replace(/[(),-]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : NaN;
};

/** Actual expense per budget line recorded in the system between two days (inclusive). */
export async function systemSpend(t: Tx | typeof db, school: string, yearId: string, from: string, to: string) {
  const range = { gte: new Date(from), lte: new Date(to) };
  const [direct, invoices, ledger] = await Promise.all([
    t.directExpense.findMany({ where: { schoolId: school, yearId, date: range }, select: { budgetId: true, amount: true } }),
    t.expense.findMany({ where: { schoolId: school, yearId, date: range }, select: { budgetId: true, amount: true } }),
    t.ledger.findMany({
      where: { budget: { schoolId: school, yearId }, eventKey: { startsWith: 'certificate:' } },
      select: { budgetId: true, expense: true, source: true },
    }),
  ]);
  const certs = await t.certificate.findMany({
    where: { id: { in: [...new Set(ledger.map((l) => l.source))] } },
    select: { id: true, createdAt: true, details: true },
  });
  const dateOf = new Map(certs.map((c) => [c.id, String((c.details as any)?.date ?? isoDay(c.createdAt))]));
  const out = new Map<string, InstanceType<typeof D>>();
  const add = (b: string, v: unknown) => out.set(b, (out.get(b) ?? new D(0)).plus(v as any));
  for (const e of direct) add(e.budgetId, e.amount);
  for (const e of invoices) add(e.budgetId, e.amount);
  for (const l of ledger) {
    const d = dateOf.get(l.source);
    if (d && d >= from && d <= to) add(l.budgetId, l.expense);
  }
  return out;
}

const periodSchema = z.object({
  yearId: id,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'اختر الشهر'),
  mode: z.enum(['month', 'ytd']).default('month'),
});
function periodDays(y: { startDate: Date; endDate: Date }, period: string, mode: 'month' | 'ytd') {
  const [yy, mm] = period.split('-').map(Number);
  const last = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const from = mode === 'ytd' ? isoDay(y.startDate) : `${period}-01`;
  const to = [last, isoDay(y.endDate)].sort()[0];
  if (to < isoDay(y.startDate) || from > isoDay(y.endDate)) fail('الشهر خارج العام المالي');
  return { from: [from, isoDay(y.startDate)].sort()[1], to };
}

/** Reads the uploaded PDF and proposes the figures; nothing is saved. */
export async function parseErpReport(s: Identity, body: any) {
  scope(s, parse(id, body?.school), ACCOUNT);
  const p = parse(
    periodSchema.extend({ school: id, name: z.string().max(200).default('erp.pdf'), base64: z.string().min(10).max(14_000_000) }).strict(),
    body,
  );
  scope(s, p.school, ACCOUNT);
  const y = await db.fiscalYear.findUnique({ where: { id: p.yearId, schoolId: p.school } });
  if (!y) throw new NotFoundException();
  const data = Buffer.from(p.base64, 'base64');
  if (data.subarray(0, 5).toString() !== '%PDF-') fail('الملف ليس PDF');
  const lines = await pdfLines(data);
  if (!lines.length) fail('لا يوجد نص في الملف؛ يبدو أنه صورة ممسوحة. صدّر التقرير من ERP بصيغة PDF مباشرة');
  const budgets = await db.budget.findMany({
    where: { schoolId: p.school, yearId: p.yearId },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  const codeOf = new Map<string, string>();
  for (const b of budgets) {
    codeOf.set(b.code, b.id);
    if (b.assetCode) codeOf.set(b.assetCode, b.id);
  }
  const found = new Map<string, number[][]>();
  const unknown = new Set<string>();
  for (const parts of lines) {
    const text = parts.join(' ');
    const tokens = text.match(NUMBER) ?? [];
    const code = tokens.find((tk) => codeOf.has(tk));
    if (!code) {
      for (const tk of tokens) if (/^[1-9]\d{4,5}$/.test(tk) && /^[15]/.test(tk)) unknown.add(tk);
      continue;
    }
    const numbers = tokens
      .filter((tk) => tk !== code && !codeOf.has(tk) && !/^(19|20)\d{2}$/.test(tk))
      .map(amountOf)
      .filter((v) => Number.isFinite(v));
    const b = codeOf.get(code)!;
    found.set(b, [...(found.get(b) ?? []), numbers]);
  }
  const { from, to } = periodDays(y, p.period, p.mode);
  const system = await systemSpend(db, p.school, p.yearId, from, to);
  // The column (counted from the end of the line) and the way of combining several lines of one code
  // that best agree with the system are proposed; the accountant can change both and any amount.
  const pick = (col: number, agg: 'sum' | 'first') => (rows: number[][]) => {
    const vals = rows.map((r) => r[r.length - 1 - col]).filter((v) => v !== undefined);
    return agg === 'first' ? (vals[0] ?? 0) : vals.reduce((a, v) => a + v, 0);
  };
  let best = { col: 0, agg: 'sum' as 'sum' | 'first', score: Infinity };
  const widest = Math.min(4, Math.max(1, ...[...found.values()].flat().map((r) => r.length)));
  for (const agg of ['sum', 'first'] as const)
    for (let col = 0; col < widest; col++) {
      const f = pick(col, agg);
      // A column missing from a line counts as a poor match, so only real columns are proposed.
      const missing = [...found.values()].flat().filter((r) => r.length <= col).length;
      const score = missing * 1e12 + [...found.entries()].reduce((a, [b, rows]) => a + Math.abs(f(rows) - Number(system.get(b) ?? 0)), 0);
      if (score < best.score - 0.001) best = { col, agg, score };
    }
  return {
    period: { from, to, label: p.period, mode: p.mode },
    fileName: p.name,
    lineCount: lines.length,
    columns: best,
    rows: budgets
      .filter((b) => found.has(b.id) || system.get(b.id)?.gt(0))
      .map((b) => ({ budgetId: b.id, code: b.code, name: b.name, system: num(system.get(b.id) ?? 0), lines: found.get(b.id) ?? [] })),
    unknownCodes: [...unknown].slice(0, 30),
    sample: lines.slice(0, 25).map((l) => l.join(' ')),
  };
}

/** Saves the comparison and, when asked, settles the lines where ERP shows more expense than the system. */
export async function writeErpRecon({ s, school, t, body }: WriteCtx) {
  scope(s, school, ACCOUNT);
  const p = parse(
    periodSchema
      .extend({
        fileName: z.string().max(200).default('erp.pdf'),
        settle: z.boolean().default(false),
        rows: z.array(z.object({ budgetId: id, erp: z.number().min(-1e10).max(1e10) }).strict()).max(500),
      })
      .strict(),
    body,
  );
  const y = await openYear(t, school, p.yearId);
  const { from, to } = periodDays(y, p.period, p.mode);
  const system = await systemSpend(t, school, p.yearId, from, to);
  const budgets = new Map((await t.budget.findMany({ where: { schoolId: school, yearId: p.yearId } })).map((b) => [b.id, b]));
  let settled = 0;
  const rows = [];
  const settleDate = [to, today()].sort()[0];
  for (const r of p.rows) {
    const b = budgets.get(r.budgetId);
    if (!b) fail('بند غير معروف');
    const sys = system.get(b.id) ?? new D(0);
    const diff = new D(r.erp).minus(sys).toDecimalPlaces(2);
    let status = diff.abs().lt(0.01) ? 'MATCH' : diff.gt(0) ? 'ERP_MORE' : 'SYSTEM_MORE';
    if (p.settle && status === 'ERP_MORE') {
      const e = await t.directExpense.create({
        data: {
          schoolId: school,
          yearId: p.yearId,
          budgetId: b.id,
          date: new Date(settleDate),
          description: `تسوية مع تقرير ERP — ${p.mode === 'ytd' ? 'حتى نهاية' : 'شهر'} ${p.period}`,
          reference: `ERP ${p.period}`,
          amount: diff,
          source: 'ERP',
          note: p.fileName,
          createdBy: s.user.id,
        },
      });
      await posting(t, b.id, ZERO, diff, 'direct:' + e.id, e.id, s.user.id);
      status = 'SETTLED';
      settled++;
    }
    rows.push({ budgetId: b.id, code: b.code, name: b.name, erp: num(new D(r.erp)), system: num(sys), diff: num(diff), status });
  }
  const rec = await t.erpRecon.create({
    data: { schoolId: school, yearId: p.yearId, period: p.period, mode: p.mode, fileName: p.fileName, rows, settled, createdBy: s.user.id },
  });
  await audit(t, s, school, 'ERP_RECON', rec.id, {
    period: p.period,
    mode: p.mode,
    settled,
    differences: rows.filter((r) => r.status !== 'MATCH').length,
  });
  return { id: rec.id, settled, differences: rows.filter((r) => !['MATCH', 'SETTLED'].includes(r.status)).length };
}

const STATUS: Record<string, string> = {
  MATCH: 'مطابق',
  ERP_MORE: 'ERP أعلى — يحتاج تسجيلاً في النظام',
  SYSTEM_MORE: 'النظام أعلى — راجع التسجيل في ERP',
  SETTLED: 'سُوّي في النظام',
};

export async function readErpRecon({ school, rid, query }: ReadCtx) {
  if (!rid) {
    return db.erpRecon.findMany({
      where: { schoolId: school, ...(query.year ? { yearId: parse(id, query.year) } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, period: true, mode: true, fileName: true, settled: true, createdAt: true, rows: true },
    });
  }
  const r = await db.erpRecon.findFirst({ where: { id: parse(id, rid), schoolId: school } });
  if (!r) throw new NotFoundException();
  const school_ = await db.school.findUniqueOrThrow({ where: { id: school } });
  const rows = r.rows as any[];
  const diffs = query.all === '1' ? rows : rows.filter((x) => x.status !== 'MATCH');
  const title = `فروق المطابقة مع تقرير ERP — ${r.mode === 'ytd' ? 'حتى نهاية' : 'شهر'} ${r.period}`;
  if (query.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('الفروق', { views: [{ rightToLeft: true }] });
    ws.addRow([title, school_.name]).font = { bold: true };
    ws.addRow(['رمز البند', 'البند', 'تقرير ERP', 'النظام', 'الفرق', 'الحالة']).font = { bold: true };
    for (const x of diffs) ws.addRow([x.code, x.name, Number(x.erp), Number(x.system), Number(x.diff), STATUS[x.status]]);
    ws.columns.forEach((c) => (c.width = 22));
    return {
      base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      name: `erp-differences-${r.period}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  const body = `<h1>${esc(title)}</h1>
<p>المدرسة: <b>${esc(school_.name)}</b> — الملف: ${esc(r.fileName)} — تاريخ المطابقة ${dateHtml(r.createdAt)}</p>
${
  diffs.length
    ? `<table class="dense"><thead><tr><th>رمز البند</th><th>البند</th><th>تقرير ERP</th><th>النظام</th><th>الفرق</th><th>الحالة</th></tr></thead><tbody>${diffs
        .map(
          (x) =>
            `<tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td>${money(x.erp)}</td><td>${money(x.system)}</td><td><b>${money(x.diff)}</b></td><td>${esc(STATUS[x.status])}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>لا توجد فروق — النظام مطابق لتقرير ERP.</p>'
}`;
  return { html: printDocument({ title, ref: 'ERP ' + r.period, date: r.createdAt, body, showRef: false }) };
}

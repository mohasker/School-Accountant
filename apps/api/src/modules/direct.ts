import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db } from '../common/db';
import { inYear, isoDay, today } from '../common/dates';
import { D, num, sum } from '../common/money';
import { date, fail, id, money, optionalText, parse, text } from '../common/validation';
import { ACCOUNT, scope } from '../core/identity';
import { posting, ZERO } from '../core/ledger';
import { audit, openYear } from '../core/transaction';
import type { ReadCtx, WriteCtx } from './context';

/**
 * Direct expenses: amounts paid straight from the budget (not through an imprest) or entered from
 * earlier records when a school starts using the system. Each one posts to its budget line at once.
 * They can be typed one by one or loaded from the Excel template (`direct-expenses/template`).
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEADS = ['التاريخ (YYYY-MM-DD)', 'رمز البند', 'البيان', 'المورد', 'رقم الفاتورة / المرجع', 'المبلغ', 'ملاحظات'];

export async function readDirectExpenses({ s, school, rid, query }: ReadCtx) {
  const yearId = parse(id, query.year);
  const year = await db.fiscalYear.findUnique({ where: { id: yearId, schoolId: school }, include: { school: true } });
  if (!year) throw new NotFoundException();
  if (rid === 'template') return template(year);
  const rows = await db.directExpense.findMany({
    where: { schoolId: school, yearId },
    include: { budget: { select: { code: true, name: true } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 3000,
  });
  return { rows, total: num(sum(rows.map((r) => r.amount))), canDelete: s.user.isTenantAdmin };
}

/** Excel template with the school's budget codes on a second sheet, so the codes can be copied exactly. */
async function template(year: { id: string; label: string; schoolId: string; school: { name: string } }) {
  const lines = await db.budget.findMany({
    where: { schoolId: year.schoolId, yearId: year.id },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المصروفات', { views: [{ rightToLeft: true }] });
  const head = ws.addRow(HEADS);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF861B3A' } }));
  ws.addRow([
    today(),
    lines[0]?.code ?? '510401',
    'مثال: شراء مستلزمات تعليمية',
    'اسم المورد',
    'INV-1001',
    1250.5,
    'يُحذف هذا الصف المثال',
  ]);
  ws.columns.forEach((c, i) => (c.width = [16, 12, 40, 28, 22, 14, 30][i]));
  ws.getColumn(1).numFmt = '@';
  ws.getColumn(2).numFmt = '@';
  const codes = wb.addWorksheet('رموز البنود', { views: [{ rightToLeft: true }] });
  codes.addRow(['رمز البند', 'اسم البند']).font = { bold: true };
  lines.forEach((l) => codes.addRow([l.code, l.name]));
  codes.columns.forEach((c, i) => (c.width = i ? 40 : 14));
  const how = wb.addWorksheet('التعليمات', { views: [{ rightToLeft: true }] });
  [
    `المدرسة: ${year.school.name} — العام المالي ${year.label}`,
    'اكتب كل مصروف في صف من ورقة «المصروفات»: التاريخ بصيغة سنة-شهر-يوم، ورمز البند كما في ورقة «رموز البنود».',
    'المبلغ رقم بالريال القطري (يقبل كسور). الأعمدة: المورد والمرجع والملاحظات اختيارية.',
    'احذف صف المثال ثم احفظ الملف وارفعه من شاشة الموازنة ← «استيراد مصروفات من Excel».',
    'لا يُحفظ أي صف إذا كان في الملف خطأ؛ يذكر النظام رقم الصف والسبب.',
  ].forEach((t) => how.addRow([t]));
  how.getColumn(1).width = 110;
  return {
    base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    name: `direct-expenses-template-${year.label}.xlsx`,
    mime: XLSX,
  };
}

const rowSchema = z
  .object({
    budgetId: id.optional(),
    code: z.string().trim().max(20).optional(),
    date,
    vendor: optionalText(150),
    reference: optionalText(100),
    description: text,
    amount: money,
    note: optionalText(300),
  })
  .strict();

export async function writeDirectExpenses(ctx: WriteCtx) {
  const { s, school, t, body, rid, method } = ctx;
  scope(s, school, ACCOUNT);
  if (rid && rid !== 'import' && method === 'DELETE') {
    if (!s.user.isTenantAdmin) fail('حذف المصروف لمسؤول النظام فقط');
    const e = await t.directExpense.findFirst({ where: { id: parse(id, rid), schoolId: school } });
    if (!e) throw new NotFoundException();
    await posting(t, e.budgetId, ZERO, new D(e.amount).neg(), 'direct-reverse:' + e.id, e.id, s.user.id);
    await audit(t, s, school, 'DIRECT_EXPENSE_DELETE', e.id, { amount: e.amount, budgetId: e.budgetId });
    return t.directExpense.delete({ where: { id: e.id } });
  }
  const yearId = parse(id, body?.yearId);
  const y = await openYear(t, school, yearId);
  const budgets = await t.budget.findMany({ where: { schoolId: school, yearId } });
  const byId = new Map(budgets.map((b) => [b.id, b])),
    byCode = new Map(budgets.map((b) => [b.code, b]));

  const record = async (input: unknown, source: 'MANUAL' | 'IMPORT') => {
    const p = parse(rowSchema, input);
    const budget = p.budgetId ? byId.get(p.budgetId) : p.code ? byCode.get(p.code) : undefined;
    if (!budget) fail(`بند الموازنة غير معروف${p.code ? ` (${p.code})` : ''}`);
    inYear(y, p.date);
    if (p.date > today()) fail('تاريخ المصروف في المستقبل');
    if (new D(p.amount).lte(0)) fail('المبلغ يجب أن يكون أكبر من صفر');
    const { budgetId: _b, code: _c, ...fields } = p;
    const e = await t.directExpense.create({
      data: { ...fields, date: new Date(p.date), budgetId: budget.id, schoolId: school, yearId, source, createdBy: s.user.id },
    });
    await posting(t, budget.id, ZERO, new D(p.amount), 'direct:' + e.id, e.id, s.user.id);
    return e;
  };

  if (rid === 'import') {
    const p = parse(z.object({ yearId: id, base64: z.string().min(10).max(12_000_000) }).strict(), body);
    const rows = await parseWorkbook(Buffer.from(p.base64, 'base64'));
    if (!rows.length) fail('الملف لا يحتوي صفوفاً');
    const created = [];
    for (const [i, r] of rows.entries()) {
      try {
        created.push(await record(r, 'IMPORT'));
      } catch (e: any) {
        if (e?.status === 400 || e?.getStatus?.() === 400) fail(`الصف ${i + 2}: ${e.message}`);
        throw e;
      }
    }
    await audit(t, s, school, 'DIRECT_EXPENSE_IMPORT', yearId, { count: created.length, total: num(sum(created.map((c) => c.amount))) });
    return { count: created.length, total: num(sum(created.map((c) => c.amount))) };
  }
  const { yearId: _y, ...row } = body;
  return record(row, 'MANUAL');
}

/** Rows of the «المصروفات» sheet (or the first sheet) as plain strings; empty rows and the example row are skipped. */
async function parseWorkbook(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    fail('تعذر قراءة الملف؛ يجب أن يكون ملف Excel (xlsx) من النموذج');
  }
  const ws = wb.getWorksheet('المصروفات') ?? wb.worksheets[0];
  if (!ws) fail('الملف فارغ');
  const cell = (r: ExcelJS.Row, i: number) => {
    const v = r.getCell(i).value as any;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return isoDay(v);
    if (typeof v === 'object') return String(v.result ?? v.text ?? v.richText?.map((x: any) => x.text).join('') ?? '').trim();
    return String(v).trim();
  };
  const rows: Record<string, string>[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const values = [1, 2, 3, 4, 5, 6, 7].map((i) => cell(r, i));
    if (!values.some(Boolean)) return;
    if (values[6] === 'يُحذف هذا الصف المثال') return;
    const amount = values[5].replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/,/g, '');
    rows.push({
      date: values[0].slice(0, 10),
      code: values[1],
      description: values[2],
      vendor: values[3],
      reference: values[4],
      amount: /^\d+$/.test(amount) ? amount : Number(amount).toFixed(2),
      note: values[6],
    });
  });
  return rows;
}

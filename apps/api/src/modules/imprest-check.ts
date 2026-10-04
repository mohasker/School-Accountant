import { NotFoundException } from '@nestjs/common';
import { db } from '../common/db';
import { isoDay, today } from '../common/dates';
import { fail, id, parse } from '../common/validation';
import { DOC_TYPES, type Extraction, type UploadedFile } from '../core/file-check/extract';
import { compareNames, refKey, sameAmount, sameRef, showAmount, showDate } from '../core/file-check/normalize';
import { readingPrompt } from '../core/file-check/prompt';
import { verdict, type Finding } from '../core/file-check/rules';
import { scope, WORK, type Identity } from '../core/identity';
import { loadPolicy } from '../core/policy';
import { imprestCheckReport } from '../print/file-check';
import type { ReadCtx } from './context';
import { extractInput, tenantSettings } from './file-check';

/**
 * The same paper-file check for an imprest settlement statement: every invoice recorded on the
 * statement is in the file with the same number, supplier, date and amount; no invoice in the file is
 * missing from the statement; the petty-invoice limit; dates inside the year and not after the
 * statement; the supplier's stamp or signature; and the total.
 */

const TYPE_NAMES: Record<string, string> = {
  PETTY: 'العهدة النثرية',
  EDUCATION: 'عهدة يوم التعليم',
  BOOK: 'عهدة معرض الكتاب',
  OTHER: 'عهدة خاصة',
};

type ImprestExpected = {
  school: string;
  imprest: string;
  type: string;
  number: number;
  date: string;
  total: number;
  limit: number | null;
  year: { start: string; end: string };
  invoices: { invoice: string; vendor: string; date: string; amount: number }[];
};

async function loadSettlement(s: Identity, school: string, settlementId: string) {
  scope(s, school);
  const st = await db.settlement.findFirst({
    where: { id: parse(id, settlementId), imprest: { schoolId: school } },
    include: { expenses: { orderBy: { date: 'asc' } }, imprest: { include: { year: { include: { school: true } } } } },
  });
  if (!st) throw new NotFoundException('كشف التسوية غير موجود');
  const a = st.imprest;
  const policy = await loadPolicy(db, s.user.tenantId, isoDay(st.createdAt));
  const x: ImprestExpected = {
    school: a.year.school.name,
    imprest: a.name || TYPE_NAMES[a.type] || 'عهدة',
    type: a.type,
    number: st.number,
    date: isoDay(st.createdAt),
    total: Number(st.amount),
    limit: a.type === 'PETTY' ? Number(policy.singleQuoteLimit) : null,
    year: { start: isoDay(a.year.startDate), end: isoDay(a.year.endDate) },
    invoices: st.expenses.map((e) => ({ invoice: e.invoice, vendor: e.vendor, date: isoDay(e.date), amount: Number(e.amount) })),
  };
  return { st, x };
}

export function imprestRules(x: ImprestExpected, e: Extraction): Finding[] {
  const out: Finding[] = [];
  const add = (level: Finding['level'], area: Finding['area'], page: number | null, text: string) => out.push({ level, area, page, text });
  if (e.mode === 'TEXT') {
    const refs = e.pages.flatMap((p) => p.tokens?.refs ?? []);
    const amounts = e.pages.flatMap((p) => p.tokens?.amounts ?? []);
    if (e.unread)
      add('WARN', 'READ', null, `${e.unread} صفحة صورة أو ممسوحة لا يمكن قراءتها في هذا الوضع؛ استخدم Claude / ChatGPT أو راجعها بالعين.`);
    for (const inv of x.invoices) {
      if (inv.invoice && refs.length && !refs.some((r) => sameRef(r, inv.invoice)))
        add('WARN', 'REF', null, `الفاتورة ${inv.invoice} (${inv.vendor}) لا يظهر رقمها في الملف.`);
      if (amounts.length && !amounts.some((a) => sameAmount(a, inv.amount)))
        add('WARN', 'AMOUNT', null, `مبلغ الفاتورة ${inv.invoice || inv.vendor} ${showAmount(inv.amount)} لا يظهر في الملف.`);
    }
    add('NOTE', 'READ', null, 'قراءة نص PDF فقط: أسماء الموردين والأختام والتواريخ على الفواتير الممسوحة تُراجع يدوياً.');
    return sort(out);
  }
  const invoices = e.pages.filter((p) => p.docType === 'INVOICE');
  const used = new Set<number>();
  for (const inv of x.invoices) {
    const match =
      invoices.find((p) => !used.has(p.page) && inv.invoice && p.invoiceNumber && sameRef(p.invoiceNumber, inv.invoice)) ??
      invoices.find(
        (p) =>
          !used.has(p.page) &&
          p.amounts.total != null &&
          sameAmount(p.amounts.total, inv.amount) &&
          compareNames(p.supplierName, inv.vendor) !== 'different',
      );
    if (!match) {
      add(
        'ERROR',
        'COMPLETE',
        null,
        `الفاتورة المسجلة ${inv.invoice || '(بدون رقم)'} — ${inv.vendor} — ${showAmount(inv.amount)} غير موجودة في الملف.`,
      );
      continue;
    }
    used.add(match.page);
    if (match.amounts.total == null) add('WARN', 'AMOUNT', match.page, `فاتورة (ص ${match.page}): لا يظهر المبلغ.`);
    else if (!sameAmount(match.amounts.total, inv.amount))
      add(
        'ERROR',
        'AMOUNT',
        match.page,
        `فاتورة (ص ${match.page}): المبلغ ${showAmount(match.amounts.total)} والمسجل ${showAmount(inv.amount)}.`,
      );
    if (match.documentDate && match.documentDate !== inv.date)
      add('WARN', 'DATE', match.page, `فاتورة (ص ${match.page}): التاريخ ${showDate(match.documentDate)} والمسجل ${showDate(inv.date)}.`);
    if (inv.vendor && match.supplierName && compareNames(match.supplierName, inv.vendor) === 'different')
      add('ERROR', 'SUPPLIER', match.page, `فاتورة (ص ${match.page}): المورد «${match.supplierName}» والمسجل «${inv.vendor}».`);
    if (match.signatures && !match.stamp && !match.signatures.some((s) => s.signed))
      add('WARN', 'SIGN', match.page, `فاتورة (ص ${match.page}): بلا ختم أو توقيع المورد.`);
  }
  for (const p of invoices.filter((p) => !used.has(p.page)))
    add(
      'ERROR',
      'REF',
      p.page,
      `فاتورة في الملف (ص ${p.page}) ${p.invoiceNumber ?? ''} ${p.supplierName ?? ''} ${showAmount(p.amounts.total)} غير مسجلة في الكشف.`,
    );
  for (const p of invoices) {
    if (x.limit && p.amounts.total != null && p.amounts.total - x.limit > 0.01)
      add(
        'ERROR',
        'AMOUNT',
        p.page,
        `فاتورة (ص ${p.page}) ${showAmount(p.amounts.total)} تتجاوز حد النثرية ${showAmount(x.limit)} للفاتورة.`,
      );
    const d = p.documentDate;
    if (d && d > today()) add('ERROR', 'DATE', p.page, `فاتورة (ص ${p.page}): تاريخ مستقبلي ${showDate(d)}.`);
    else if (d && d > x.date)
      add('ERROR', 'DATE', p.page, `فاتورة (ص ${p.page}): تاريخها ${showDate(d)} بعد تاريخ الكشف ${showDate(x.date)}.`);
    else if (d && (d < x.year.start || d > x.year.end))
      add('WARN', 'DATE', p.page, `فاتورة (ص ${p.page}): التاريخ ${showDate(d)} خارج العام المالي.`);
    if (p.legible === 'low') add('WARN', 'READ', p.page, `فاتورة (ص ${p.page}) غير واضحة؛ أعد تصويرها.`);
  }
  const seen = new Map<string, number>();
  for (const p of invoices) {
    const k = refKey(p.invoiceNumber) + '|' + (p.amounts.total ?? '');
    if (p.invoiceNumber && seen.has(k))
      add('ERROR', 'REF', p.page, `الفاتورة ${p.invoiceNumber} مكررة في الملف (ص ${seen.get(k)} و ص ${p.page}).`);
    seen.set(k, p.page);
  }
  const paperTotal = invoices.reduce((v, p) => v + (p.amounts.total ?? 0), 0);
  if (invoices.length && invoices.every((p) => p.amounts.total != null) && !sameAmount(paperTotal, x.total))
    add('ERROR', 'AMOUNT', null, `إجمالي الفواتير في الملف ${showAmount(paperTotal)} وإجمالي الكشف ${showAmount(x.total)}.`);
  for (const p of e.pages.filter((p) => p.docType !== 'INVOICE' && p.docType !== 'OTHER'))
    add('NOTE', 'COMPLETE', p.page, `ص ${p.page}: ${DOC_TYPES[p.docType as keyof typeof DOC_TYPES] ?? 'مستند'}.`);
  return sort(out);
}
const sort = (f: Finding[]) =>
  f.sort(
    (a, b) => ({ ERROR: 0, WARN: 1, NOTE: 2 })[a.level] - { ERROR: 0, WARN: 1, NOTE: 2 }[b.level] || (a.page ?? 999) - (b.page ?? 999),
  );

export async function runImprestCheck(
  s: Identity,
  school: string,
  settlementId: string,
  input: { files: UploadedFile[] } | { pasted: string },
) {
  scope(s, school, WORK);
  const { st, x } = await loadSettlement(s, school, settlementId);
  const settings = await tenantSettings(s.user.tenantId);
  const { extraction, fileList } = await extractInput(s, settings, input, []);
  const findings = imprestRules(x, extraction);
  const checklist =
    extraction.mode === 'TEXT'
      ? [
          'كل فاتورة مسجلة في الكشف موجودة في الملف بنفس الرقم والمورد والتاريخ والمبلغ',
          'الفواتير مختومة أو موقعة من المورد',
          x.limit ? `لا فاتورة تتجاوز ${showAmount(x.limit)} ر.ق` : 'المبالغ مطابقة لإجمالي الكشف',
        ]
      : [];
  const v = verdict(findings);
  const at = new Date();
  const html = imprestCheckReport({
    findings,
    checklist,
    result: v.result,
    counts: v,
    mode: extraction.mode,
    source: 'WEB',
    files: fileList.map((f) => ({ name: f.name, pages: 0 })),
    pages: extraction.pages.length,
    by: s.user.name,
    at,
    school: x.school,
    imprest: x.imprest,
    number: x.number,
    total: showAmount(x.total),
    invoices: x.invoices.length,
  });
  const row = await db.$transaction(async (t) => {
    const saved = await t.fileCheck.create({
      data: {
        schoolId: school,
        kind: 'IMPREST',
        caseId: st.id,
        source: 'WEB',
        mode: extraction.mode,
        files: fileList,
        pages: extraction.pages.length,
        facts: JSON.parse(JSON.stringify({ pages: extraction.pages, checklist })),
        findings,
        result: v.result,
        errors: v.errors,
        warnings: v.warnings,
        notes: v.notes,
        html,
        createdBy: s.user.id,
        byName: s.user.name,
        createdAt: at,
      },
    });
    await t.audit.create({
      data: {
        schoolId: school,
        actor: s.user.id,
        action: 'imprest-check',
        entity: st.id,
        detail: { check: saved.id, mode: extraction.mode, result: v.result, files: fileList.map((f) => f.sha256) },
      },
    });
    return saved;
  });
  return { id: row.id, ...v, mode: extraction.mode, pages: extraction.pages.length, findings, checklist };
}

/** GET schools/:school/imprest-check-prompt/:settlement — the prompts for the accountant's own Claude / ChatGPT. */
export async function readImprestPrompt({ s, school, rid }: ReadCtx) {
  scope(s, school, WORK);
  const settings = await tenantSettings(s.user.tenantId);
  if (!settings.prompt) fail('أوقف مسؤول النظام الفحص عبر Claude / ChatGPT خارج النظام');
  const { x } = await loadSettlement(s, school, rid ?? '');
  const review = [
    'أنت مدقق مالي للعهد في المدارس الحكومية بدولة قطر. المرفق فواتير كشف تسوية واحد.',
    'قارن كل فاتورة بالمسجل أدناه، واذكر كل فاتورة ناقصة أو زائدة أو مختلفة في الرقم أو المورد أو التاريخ أو المبلغ، وكل فاتورة بلا ختم أو توقيع المورد. لا تخمّن.',
    `المدرسة: ${x.school} — ${x.imprest} — كشف رقم ${x.number} بتاريخ ${showDate(x.date)} — الإجمالي ${showAmount(x.total)} ر.ق${x.limit ? ` — حد الفاتورة ${showAmount(x.limit)} ر.ق` : ''}.`,
    'الفواتير المسجلة:',
    ...x.invoices.map((i, n) => `${n + 1}. رقم ${i.invoice || '—'} — ${i.vendor} — ${showDate(i.date)} — ${showAmount(i.amount)} ر.ق`),
    'أجب في صفحة واحدة: النتيجة، ثم الأخطاء، ثم التنبيهات، ثم جدول بالفواتير (موجودة / ناقصة / مختلفة) ورقم الصفحة.',
  ].join('\n');
  return { reading: readingPrompt([]), review };
}

import { isoDay } from '../../common/dates';
import { DOC_TYPES, type DocType, type Extraction, type PageFacts } from './extract';
import { compareNames, nameKey, refKey, sameAmount, sameRef, showAmount, showDate } from './normalize';

/**
 * The fixed rules of the paper-file check. They compare what was read from the pages with what the
 * system recorded for the same file, so the same file always gives the same result. Nothing here
 * calls an outside service.
 */

export type Level = 'ERROR' | 'WARN' | 'NOTE';
export type Finding = {
  level: Level;
  area: 'COMPLETE' | 'SCHOOL' | 'SUPPLIER' | 'REF' | 'DATE' | 'AMOUNT' | 'SIGN' | 'RULE' | 'READ';
  page: number | null;
  text: string;
};

/** What the system holds for the file, in plain values. */
export type Expected = {
  caseNumber: string;
  school: string;
  otherSchools: string[];
  supplier: { names: string[] } | null;
  origin: 'SCHOOL' | 'MINISTRY';
  year: { start: string; end: string };
  today: string;
  report: { date: string; quotes: { supplier: string; reference: string; total: number; date: string | null }[] } | null;
  order: { number: string; date: string; total: number; dueDate: string | null } | null;
  deliveries: { date: string; invoice: string; value: number }[];
  certificates: {
    date: string;
    invoice: string;
    orderNumber: string;
    gross: number;
    fine: number;
    net: number;
    addressee: string;
    coverDate: string | null;
    deliveryDate: string | null;
  }[];
  rules: { id: string; text: string; level: 'ERROR' | 'WARN'; docType: DocType | '' }[];
};

/** Builds the expected values from a case loaded with getCase (and its certificates' details). */
export function expectedFrom(c: any, otherSchools: string[], cardNames: string[], rules: Expected['rules'], today: string): Expected {
  const day = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : isoDay(d)) : null);
  const supplier = (c.supplierSnapshot ?? c.supplier) as { name?: string } | null;
  const values = new Map<string, number>();
  for (const d of c.deliveries ?? [])
    values.set(
      d.id,
      (d.portions ?? []).reduce((v: number, p: any) => v + Number(p.value), 0),
    );
  return {
    caseNumber: c.number,
    school: c.school.name,
    otherSchools: otherSchools.filter((n) => nameKey(n) !== nameKey(c.school.name)),
    supplier: supplier?.name ? { names: [supplier.name, ...cardNames].filter(Boolean) } : null,
    origin: c.origin,
    year: { start: day(c.year.startDate)!, end: day(c.year.endDate)! },
    today,
    report:
      c.origin === 'SCHOOL' && c.reportDate
        ? {
            date: day(c.reportDate)!,
            quotes: (c.quotes ?? []).map((q: any) => ({
              supplier: q.supplier?.name ?? '',
              reference: q.reference,
              total: Number(q.total),
              date: day(q.quoteDate),
            })),
          }
        : null,
    order: c.issueDate ? { number: c.orderNumber ?? '', date: day(c.issueDate)!, total: Number(c.total), dueDate: day(c.dueDate) } : null,
    deliveries: (c.deliveries ?? []).map((d: any) => ({ date: day(d.date)!, invoice: d.invoice, value: values.get(d.id) ?? 0 })),
    certificates: (c.certificates ?? []).map((x: any) => {
      const d = (x.details ?? x.snapshot ?? {}) as any;
      return {
        date: String(d.date ?? day(x.createdAt)),
        invoice: String(d.invoice ?? ''),
        orderNumber: String(d.orderNumber ?? c.orderNumber ?? ''),
        gross: Number(x.gross),
        fine: Number(x.fine),
        net: Number(x.net),
        addressee: typeof d.addressee === 'string' ? d.addressee : '',
        coverDate: d.cover?.date ?? (x.coverHtml ? String(d.date ?? '') : null),
        deliveryDate: d.deliveryDate ?? null,
      };
    }),
    rules,
  };
}

const label = (t: DocType | 'UNKNOWN') => (t === 'UNKNOWN' ? 'صفحة' : DOC_TYPES[t]);
const at = (p: PageFacts) => `${label(p.docType)} (ص ${p.page})`;

/** All findings for the file, most serious first. */
export function evaluate(x: Expected, e: Extraction): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, area: Finding['area'], page: number | null, text: string) => out.push({ level, area, page, text });
  if (e.mode === 'AI') aiRules(x, e, add);
  else textRules(x, e, add);
  const order = { ERROR: 0, WARN: 1, NOTE: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.page ?? 999) - (b.page ?? 999));
}

type Add = (level: Level, area: Finding['area'], page: number | null, text: string) => void;

/** The documents the file must contain at its current stage. */
function required(x: Expected): DocType[] {
  const need: DocType[] = [];
  if (x.report) need.push('QUOTE_REPORT');
  if (x.order) need.push('ORDER');
  if (x.deliveries.length) need.push('INVOICE', 'RECEIPT');
  if (x.certificates.length) need.push('CERTIFICATE');
  if (x.certificates.some((c) => c.coverDate)) need.push('COVER');
  return need;
}

/** System signature places per document; a missing one is an error, an unreadable one a warning. */
const MUST_SIGN: Partial<Record<DocType, string>> = {
  QUOTE_REPORT: 'توقيعات اللجنة / المدير',
  ORDER: 'توقيع مدير المدرسة',
  CERTIFICATE: 'توقيعات المدير والمحاسب',
  COVER: 'توقيع مدير المدرسة',
  RECEIPT: 'توقيع المستلم',
  INVOICE: 'ختم أو توقيع المورد',
};

function aiRules(x: Expected, e: Extraction, add: Add) {
  const pages = e.pages;
  const of = (t: DocType) => pages.filter((p) => p.docType === t);

  // 1. Completeness.
  for (const t of required(x)) if (!of(t).length) add('ERROR', 'COMPLETE', null, `لا يوجد في الملف: ${DOC_TYPES[t]}.`);
  if (x.report && x.report.quotes.length > 1 && of('QUOTE').length < x.report.quotes.length)
    add('WARN', 'COMPLETE', null, `عروض الأسعار المرفقة ${of('QUOTE').length} من ${x.report.quotes.length} مسجلة في التقرير.`);
  for (const p of pages) {
    if (p.legible === 'low') add('WARN', 'READ', p.page, `${at(p)} غير واضحة؛ أعد تصويرها أو راجعها بالعين.`);
    if (p.docType === 'OTHER') add('NOTE', 'COMPLETE', p.page, `ص ${p.page}: مستند غير مصنف${p.remarks ? ` — ${p.remarks}` : ''}.`);
    else if (p.remarks) add('NOTE', 'READ', p.page, `${at(p)}: ${p.remarks}`);
  }

  // 2. The school's name on every page, identical everywhere.
  for (const p of pages) {
    if (p.docType === 'OTHER') continue;
    const fromSchool = ['QUOTE_REPORT', 'ORDER', 'CERTIFICATE', 'COVER'].includes(p.docType);
    if (!p.schoolName) {
      add(fromSchool ? 'ERROR' : 'WARN', 'SCHOOL', p.page, `${at(p)}: لا يظهر اسم المدرسة.`);
      continue;
    }
    const other = x.otherSchools.find((n) => compareNames(p.schoolName, n) === 'same');
    const cmp = compareNames(p.schoolName, x.school);
    if (other && cmp !== 'same') add('ERROR', 'SCHOOL', p.page, `${at(p)}: اسم مدرسة أخرى «${p.schoolName}» بدلاً من «${x.school}».`);
    else if (cmp === 'different') add('ERROR', 'SCHOOL', p.page, `${at(p)}: اسم المدرسة «${p.schoolName}» لا يطابق «${x.school}».`);
    else if (cmp === 'close') add('WARN', 'SCHOOL', p.page, `${at(p)}: اختلاف في كتابة اسم المدرسة «${p.schoolName}» عن «${x.school}».`);
  }

  // 3. The supplier's name on its documents.
  if (x.supplier)
    for (const p of pages) {
      if (!['ORDER', 'INVOICE', 'RECEIPT', 'CERTIFICATE', 'COVER'].includes(p.docType)) continue;
      if (!p.supplierName) {
        if (p.docType !== 'RECEIPT') add('WARN', 'SUPPLIER', p.page, `${at(p)}: لا يظهر اسم المورد.`);
        continue;
      }
      const cmp = compareNames(p.supplierName, ...x.supplier.names);
      if (cmp === 'different')
        add('ERROR', 'SUPPLIER', p.page, `${at(p)}: المورد «${p.supplierName}» غير مورد المعاملة «${x.supplier.names[0]}».`);
      else if (cmp === 'close') add('WARN', 'SUPPLIER', p.page, `${at(p)}: اختلاف في كتابة اسم المورد «${p.supplierName}».`);
    }

  // 4. Reference numbers.
  const invoices = x.deliveries.map((d) => d.invoice).filter(Boolean);
  for (const p of pages) {
    if (x.order?.number && ['ORDER', 'CERTIFICATE', 'COVER', 'INVOICE'].includes(p.docType)) {
      if (!p.orderNumber) {
        if (p.docType !== 'COVER')
          add(p.docType === 'INVOICE' ? 'WARN' : 'ERROR', 'REF', p.page, `${at(p)}: لا يظهر رقم التكليف ${x.order.number}.`);
      } else if (!sameRef(p.orderNumber, x.order.number))
        add('ERROR', 'REF', p.page, `${at(p)}: رقم التكليف «${p.orderNumber}» والمسجل ${x.order.number}.`);
    }
    if (p.docType === 'INVOICE') {
      if (!p.invoiceNumber) add('ERROR', 'REF', p.page, `${at(p)}: لا يظهر رقم الفاتورة.`);
      else if (invoices.length && !invoices.some((i) => sameRef(p.invoiceNumber, i)))
        add('ERROR', 'REF', p.page, `${at(p)}: الفاتورة رقم «${p.invoiceNumber}» غير مسجلة في المعاملة (المسجل: ${invoices.join('، ')}).`);
    }
    if (p.docType === 'CERTIFICATE' && p.invoiceNumber && invoices.length && !invoices.some((i) => sameRef(p.invoiceNumber, i)))
      add('ERROR', 'REF', p.page, `${at(p)}: رقم الفاتورة في الشهادة «${p.invoiceNumber}» لا يطابق ${invoices.join('، ')}.`);
    if (p.docType === 'QUOTE' && x.report && p.quoteReference && !x.report.quotes.some((q) => sameRef(p.quoteReference, q.reference)))
      add('WARN', 'REF', p.page, `${at(p)}: مرجع العرض «${p.quoteReference}» غير وارد في التقرير.`);
  }
  // The same invoice number on two invoice pages of different amounts is suspicious.
  const seen = new Map<string, PageFacts>();
  for (const p of of('INVOICE')) {
    const k = refKey(p.invoiceNumber);
    if (!k) continue;
    const prev = seen.get(k);
    if (prev && prev.amounts.total != null && p.amounts.total != null && !sameAmount(prev.amounts.total, p.amounts.total))
      add('ERROR', 'REF', p.page, `الفاتورة «${p.invoiceNumber}» مكررة بقيمتين مختلفتين (ص ${prev.page} و ص ${p.page}).`);
    seen.set(k, p);
  }

  // 5. Dates: each document's date as recorded, and the documents in order.
  const dated = (p: PageFacts) => p.documentDate;
  const certDates = x.certificates.map((c) => c.date);
  const coverDates = x.certificates.map((c) => c.coverDate).filter((d): d is string => !!d);
  for (const p of pages) {
    const d = dated(p);
    for (const dd of [d, ...p.otherDates.map((o) => o.date)].filter((v): v is string => !!v)) {
      if (dd > x.today) add('ERROR', 'DATE', p.page, `${at(p)}: تاريخ مستقبلي ${showDate(dd)}.`);
      else if (dd < x.year.start || dd > x.year.end) add('WARN', 'DATE', p.page, `${at(p)}: التاريخ ${showDate(dd)} خارج العام المالي.`);
    }
    if (!d) {
      if (p.docType !== 'OTHER' && p.docType !== 'QUOTE') add('ERROR', 'DATE', p.page, `${at(p)}: بلا تاريخ.`);
      continue;
    }
    const expect: Partial<Record<DocType, string[]>> = {
      QUOTE_REPORT: x.report ? [x.report.date] : [],
      ORDER: x.order ? [x.order.date] : [],
      CERTIFICATE: certDates,
      COVER: coverDates,
      RECEIPT: x.deliveries.map((v) => v.date),
    };
    const want = expect[p.docType as DocType];
    if (want && want.length && !want.includes(d))
      add('ERROR', 'DATE', p.page, `${at(p)}: التاريخ ${showDate(d)} والمسجل ${want.map(showDate).join(' أو ')}.`);
  }
  const first = (t: DocType) =>
    of(t)
      .map(dated)
      .filter((v): v is string => !!v)
      .sort()[0] ?? null;
  const last = (t: DocType) =>
    of(t)
      .map(dated)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;
  const chain: [DocType, DocType, string][] = [
    ['QUOTE', 'QUOTE_REPORT', 'عرض السعر بعد تقرير العروض'],
    ['QUOTE_REPORT', 'ORDER', 'تقرير العروض بعد كتاب التكليف'],
    ['ORDER', 'RECEIPT', 'كتاب التكليف بعد سند الاستلام'],
    ['ORDER', 'INVOICE', 'الفاتورة قبل كتاب التكليف'],
    ['RECEIPT', 'CERTIFICATE', 'سند الاستلام بعد شهادة الإنجاز'],
    ['INVOICE', 'CERTIFICATE', 'الفاتورة بعد شهادة الإنجاز'],
    ['CERTIFICATE', 'COVER', 'شهادة الإنجاز بعد كتاب التغطية'],
  ];
  for (const [a, b, text] of chain) {
    const before = last(a),
      after = first(b);
    if (before && after && before > after)
      add('ERROR', 'DATE', of(b)[0]?.page ?? null, `تسلسل التواريخ: ${text} (${showDate(before)} > ${showDate(after)}).`);
  }
  // Late delivery on paper without a penalty on the certificate.
  const received = last('RECEIPT');
  if (x.order?.dueDate && received && received > x.order.dueDate)
    for (const p of of('CERTIFICATE'))
      if (p.amounts.fine === 0 || (p.amounts.fine == null && p.amounts.gross != null && sameAmount(p.amounts.gross, p.amounts.net)))
        add(
          'ERROR',
          'AMOUNT',
          p.page,
          `${at(p)}: الاستلام ${showDate(received)} بعد آخر موعد ${showDate(x.order.dueDate)} ولا توجد غرامة تأخير.`,
        );

  // 6. Amounts.
  for (const p of pages) {
    const a = p.amounts;
    if (p.docType === 'ORDER' && x.order) {
      if (a.total == null) add('ERROR', 'AMOUNT', p.page, `${at(p)}: لا تظهر قيمة التكليف.`);
      else if (!sameAmount(a.total, x.order.total))
        add('ERROR', 'AMOUNT', p.page, `${at(p)}: القيمة ${showAmount(a.total)} والمسجل ${showAmount(x.order.total)}.`);
    }
    if (p.docType === 'INVOICE' && a.total != null) {
      const rec = x.deliveries.find((d) => p.invoiceNumber && sameRef(p.invoiceNumber, d.invoice));
      if (x.order && a.total - x.order.total > 0.01)
        add('ERROR', 'AMOUNT', p.page, `${at(p)}: الفاتورة ${showAmount(a.total)} أكبر من قيمة التكليف ${showAmount(x.order.total)}.`);
      else if (rec && rec.value && !sameAmount(a.total, rec.value))
        add('WARN', 'AMOUNT', p.page, `${at(p)}: قيمة الفاتورة ${showAmount(a.total)} والمستلم المسجل عليها ${showAmount(rec.value)}.`);
    }
    if (p.docType === 'CERTIFICATE' || p.docType === 'COVER') {
      if (a.gross != null && a.fine != null && a.net != null && !sameAmount(a.gross - a.fine, a.net))
        add('ERROR', 'AMOUNT', p.page, `${at(p)}: الصافي ${showAmount(a.net)} لا يساوي ${showAmount(a.gross)} − ${showAmount(a.fine)}.`);
      const c =
        x.certificates.find((v) => (a.net != null && sameAmount(a.net, v.net)) || p.documentDate === v.date) ?? x.certificates.at(-1);
      if (c) {
        if (p.docType === 'CERTIFICATE') {
          if (a.gross != null && !sameAmount(a.gross, c.gross))
            add('ERROR', 'AMOUNT', p.page, `${at(p)}: المستحق ${showAmount(a.gross)} والمسجل ${showAmount(c.gross)}.`);
          if (a.fine != null && !sameAmount(a.fine, c.fine))
            add('ERROR', 'AMOUNT', p.page, `${at(p)}: الغرامة ${showAmount(a.fine)} والمسجل ${showAmount(c.fine)}.`);
        }
        const net = a.net ?? (p.docType === 'COVER' ? a.total : null);
        if (net == null) add('ERROR', 'AMOUNT', p.page, `${at(p)}: لا يظهر صافي المستحق.`);
        else if (!sameAmount(net, c.net))
          add('ERROR', 'AMOUNT', p.page, `${at(p)}: الصافي ${showAmount(net)} والمسجل ${showAmount(c.net)}.`);
      }
    }
    if (p.docType === 'QUOTE' && x.report && a.total != null) {
      const q = x.report.quotes.find(
        (v) => (p.quoteReference && sameRef(p.quoteReference, v.reference)) || compareNames(p.supplierName, v.supplier) !== 'different',
      );
      if (q && !sameAmount(a.total, q.total))
        add('WARN', 'AMOUNT', p.page, `${at(p)}: إجمالي العرض ${showAmount(a.total)} والمسجل في التقرير ${showAmount(q.total)}.`);
    }
  }

  // 7. Signatures and stamps.
  for (const p of pages) {
    const need = MUST_SIGN[p.docType as DocType];
    if (!need || !p.signatures) continue;
    const unsigned = p.signatures.filter((s) => !s.signed).map((s) => s.role || 'غير محدد');
    if (p.docType === 'INVOICE') {
      if (!p.stamp && !p.signatures.some((s) => s.signed)) add('ERROR', 'SIGN', p.page, `${at(p)}: بلا ختم أو توقيع المورد.`);
      continue;
    }
    if (!p.signatures.length) add('ERROR', 'SIGN', p.page, `${at(p)}: لا توجد توقيعات (${need}).`);
    else if (unsigned.length) add('ERROR', 'SIGN', p.page, `${at(p)}: غير موقّع من: ${unsigned.join('، ')}.`);
    if (['ORDER', 'CERTIFICATE', 'COVER'].includes(p.docType) && p.stamp === false)
      add('WARN', 'SIGN', p.page, `${at(p)}: بلا ختم المدرسة.`);
  }

  // 8. The administration's requirements (read by the service, to be confirmed by the accountant).
  for (const r of x.rules) {
    const a = e.rules.find((v) => v.id === r.id);
    if (!a || a.met === 'unknown') add('WARN', 'RULE', a?.page ?? null, `متطلب الإدارة «${r.text}»: تعذر التحقق آلياً؛ راجعه يدوياً.`);
    else if (a.met === 'no') add(r.level, 'RULE', a.page, `متطلب الإدارة غير مستوفى: «${r.text}»${a.evidence ? ` — ${a.evidence}` : ''}.`);
  }
}

/** Without the reading service: only references, digits and dates of PDF text layers. */
function textRules(x: Expected, e: Extraction, add: Add) {
  const all = e.pages.flatMap((p) => (p.tokens ? [p] : []));
  const refs = all.flatMap((p) => p.tokens!.refs.map((r) => ({ r, page: p.page })));
  const dates = all.flatMap((p) => p.tokens!.dates.map((d) => ({ d, page: p.page })));
  const amounts = all.flatMap((p) => p.tokens!.amounts.map((a) => ({ a, page: p.page })));
  const readable = all.filter((p) => !p.scanned).length;
  if (e.unread) add('WARN', 'READ', null, `${e.unread} صفحة صورة أو ممسوحة لا يمكن قراءتها دون تفعيل القراءة الآلية؛ راجعها بالعين.`);
  if (!readable) return;
  const need = required(x);
  if (e.pages.length < need.length)
    add(
      'WARN',
      'COMPLETE',
      null,
      `عدد الصفحات ${e.pages.length} أقل من المستندات المطلوبة (${need.length}): ${need.map((t) => DOC_TYPES[t]).join('، ')}.`,
    );
  const found = (v: string) => refs.find((r) => sameRef(r.r, v));
  if (x.order?.number && !found(x.order.number)) add('ERROR', 'REF', null, `رقم التكليف ${x.order.number} لا يظهر في الملف.`);
  for (const d of x.deliveries)
    if (d.invoice && !found(d.invoice)) add('ERROR', 'REF', null, `رقم الفاتورة ${d.invoice} لا يظهر في الملف.`);
  for (const r of refs) {
    const looksOrder = /^[A-Z][A-Z0-9]*\/\d{4}\/\d+$/.test(refKey(r.r));
    if (looksOrder && x.order?.number && !sameRef(r.r, x.order.number))
      add('ERROR', 'REF', r.page, `ص ${r.page}: رقم تكليف «${r.r}» غير رقم المعاملة ${x.order.number}.`);
  }
  const dateHit = (v: string) => dates.some((d) => d.d === v);
  const check: [string | null | undefined, string][] = [
    [x.report?.date, 'تقرير العروض'],
    [x.order?.date, 'كتاب التكليف'],
    ...x.certificates.map((c) => [c.date, 'شهادة الإنجاز'] as [string, string]),
    ...x.certificates.map((c) => [c.coverDate, 'كتاب التغطية'] as [string | null, string]),
  ];
  for (const [d, what] of check) if (d && !dateHit(d)) add('WARN', 'DATE', null, `تاريخ ${what} المسجل ${showDate(d)} لا يظهر في الملف.`);
  for (const d of dates) {
    if (d.d > x.today) add('ERROR', 'DATE', d.page, `ص ${d.page}: تاريخ مستقبلي ${showDate(d.d)}.`);
    else if (d.d < x.year.start || d.d > x.year.end)
      add('WARN', 'DATE', d.page, `ص ${d.page}: التاريخ ${showDate(d.d)} خارج العام المالي.`);
  }
  const amountHit = (v: number) => amounts.some((a) => sameAmount(a.a, v));
  if (x.order && !amountHit(x.order.total)) add('WARN', 'AMOUNT', null, `قيمة التكليف ${showAmount(x.order.total)} لا تظهر في الملف.`);
  for (const c of x.certificates) if (!amountHit(c.net)) add('WARN', 'AMOUNT', null, `صافي الشهادة ${showAmount(c.net)} لا يظهر في الملف.`);
  add(
    'NOTE',
    'READ',
    null,
    'القراءة الآلية غير مفعّلة: الأسماء والتوقيعات والأختام ومتطلبات الإدارة في قائمة المراجعة اليدوية أسفل التقرير.',
  );
}

/** Items the accountant confirms by hand: what the chosen reading cannot see, plus the administration's requirements. */
export function manualChecklist(x: Expected, e: Extraction): string[] {
  const list: string[] = [];
  if (e.mode === 'TEXT') {
    list.push(`اسم المدرسة «${x.school}» مكتوب بنفس الصيغة في كل ورقة`);
    if (x.supplier) list.push(`اسم المورد «${x.supplier.names[0]}» في التكليف والفاتورة والشهادة والتغطية`);
    list.push('كل التوقيعات المطلوبة موجودة، والختم على التكليف والشهادة والتغطية');
    list.push('الفاتورة مختومة من المورد وتطابق الأصناف والكميات، وسند الاستلام موقّع من المستلم');
    for (const r of x.rules) list.push(`متطلب الإدارة: ${r.text}`);
  }
  return list;
}

export function verdict(findings: Finding[]) {
  const errors = findings.filter((f) => f.level === 'ERROR').length,
    warnings = findings.filter((f) => f.level === 'WARN').length,
    notes = findings.length - errors - warnings;
  return { errors, warnings, notes, result: errors ? 'FIX' : warnings ? 'REVIEW' : 'READY' } as const;
}

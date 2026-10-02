import { isoDay } from '../../common/dates';
import { COVER_ATTACHMENTS } from '../documents';
import { DOC_TYPES, EVIDENCE_DOC, type DocType, type Extraction, type PageFacts } from './extract';
import { compareNames, nameKey, refKey, sameAmount, sameRef, showAmount, showDate } from './normalize';

/**
 * The fixed rules of the paper-file check. They compare what was read from the pages with what the
 * system recorded for the same file, so the same file always gives the same result. Nothing here
 * calls an outside service.
 */

export type Level = 'ERROR' | 'WARN' | 'NOTE';
export type Finding = {
  level: Level;
  area: 'COMPLETE' | 'SCHOOL' | 'SUPPLIER' | 'REF' | 'DATE' | 'AMOUNT' | 'ITEMS' | 'SIGN' | 'BANK' | 'CR' | 'RULE' | 'READ';
  page: number | null;
  text: string;
};

/** Documents the administrator requires in every file at the payment stage (when not chosen otherwise). */
export const DEFAULT_REQUIRED: DocType[] = ['QUOTE', 'CR', 'DELIVERY_NOTE', 'RECEIPT', 'INVOICE', 'IBAN', 'UNDERTAKING'];

/** What the system holds for the file, in plain values. */
export type Expected = {
  caseNumber: string;
  school: string;
  otherSchools: string[];
  supplier: { names: string[]; cr: string; iban: string } | null;
  origin: 'SCHOOL' | 'MINISTRY';
  method: string | null;
  year: { start: string; end: string };
  today: string;
  report: { date: string; quotes: { supplier: string; reference: string; total: number; date: string | null }[] } | null;
  order: { number: string; date: string; total: number; dueDate: string | null } | null;
  items: { name: string; qty: number; unitPrice: number; accepted: number }[];
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
  /** Every document the file must contain, with the reason (stage, certificate, covering letter, administration). */
  required: { type: DocType; why: string }[];
  rules: { id: string; text: string; level: 'ERROR' | 'WARN'; docType: DocType | '' }[];
};

/** Builds the expected values from a case loaded with getCase. */
export function expectedFrom(
  c: any,
  otherSchools: string[],
  card: { legalName?: string; nameEn?: string; iban?: string; cr?: string } | null,
  rules: Expected['rules'],
  alwaysRequired: DocType[],
  today: string,
): Expected {
  const day = (d: Date | string | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : isoDay(d)) : null);
  const supplier = (c.supplierSnapshot ?? c.supplier) as { name?: string; iban?: string; cr?: string } | null;
  const values = new Map<string, number>();
  for (const d of c.deliveries ?? [])
    values.set(
      d.id,
      (d.portions ?? []).reduce((v: number, p: any) => v + Number(p.value), 0),
    );
  const certificates = (c.certificates ?? []).map((x: any) => {
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
      attachments: Array.isArray(d.attachments) ? (d.attachments as number[]) : [],
      cover: Array.isArray(d.cover?.attachments) ? (d.cover.attachments as string[]) : [],
    };
  });
  const report =
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
      : null;

  // The documents the file must contain.
  const required = new Map<DocType, string>();
  const need = (t: DocType, why: string) => required.has(t) || required.set(t, why);
  if (report) need('QUOTE_REPORT', 'صدر تقرير العروض');
  if (c.issueDate) need('ORDER', 'صدر كتاب التكليف');
  if ((c.deliveries ?? []).length) {
    need('INVOICE', 'سُجل التوريد');
    need('RECEIPT', 'سُجل التوريد');
  }
  for (const cert of certificates) {
    need('CERTIFICATE', 'صدرت شهادة الإنجاز');
    if (cert.coverDate) need('COVER', 'صدر كتاب التغطية');
    for (const code of cert.attachments) if (EVIDENCE_DOC[code]) need(EVIDENCE_DOC[code], 'مؤشر عليه في شهادة الإنجاز');
    for (const key of cert.cover) {
      const ev = COVER_ATTACHMENTS.find((a) => a.key === key)?.evidence;
      if (ev && EVIDENCE_DOC[ev]) need(EVIDENCE_DOC[ev], 'مذكور في مرفقات كتاب التغطية');
    }
  }
  if (certificates.length)
    for (const t of alwaysRequired) {
      if (c.origin === 'MINISTRY' && ['QUOTE', 'CR', 'QUOTE_REPORT', 'INVITATION'].includes(t)) continue;
      need(t, 'مطلوب دائماً من الإدارة');
    }

  return {
    caseNumber: c.number,
    school: c.school.name,
    otherSchools: otherSchools.filter((n) => nameKey(n) !== nameKey(c.school.name)),
    supplier: supplier?.name
      ? {
          names: [supplier.name, card?.legalName ?? '', card?.nameEn ?? ''].filter(Boolean),
          cr: String(supplier.cr ?? card?.cr ?? ''),
          iban: String(card?.iban || supplier.iban || ''),
        }
      : null,
    origin: c.origin,
    method: c.method ?? null,
    year: { start: day(c.year.startDate)!, end: day(c.year.endDate)! },
    today,
    report,
    order: c.issueDate ? { number: c.orderNumber ?? '', date: day(c.issueDate)!, total: Number(c.total), dueDate: day(c.dueDate) } : null,
    items: (c.items ?? []).map((i: any) => ({
      name: i.name,
      qty: Number(i.qty),
      unitPrice: Number(i.unitPrice),
      accepted: Number(i.acceptedQty ?? 0),
    })),
    deliveries: (c.deliveries ?? []).map((d: any) => ({ date: day(d.date)!, invoice: d.invoice, value: values.get(d.id) ?? 0 })),
    certificates: certificates.map(({ attachments: _a, cover: _c, ...rest }: any) => rest),
    required: [...required].map(([type, why]) => ({ type, why })),
    rules,
  };
}

const label = (t: DocType | 'UNKNOWN') => (t === 'UNKNOWN' ? 'صفحة' : DOC_TYPES[t]);
const at = (p: PageFacts) => `${label(p.docType)} (ص ${p.page})`;

/** All findings for the file, most serious first. */
export function evaluate(x: Expected, e: Extraction): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, area: Finding['area'], page: number | null, text: string) => out.push({ level, area, page, text });
  if (e.mode === 'TEXT') textRules(x, e, add);
  else pageRules(x, e, add);
  const order = { ERROR: 0, WARN: 1, NOTE: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level] || (a.page ?? 999) - (b.page ?? 999));
}

type Add = (level: Level, area: Finding['area'], page: number | null, text: string) => void;

/** Who must sign each document, and whether its stamp is required. */
const SIGNS: Partial<Record<DocType, { must: string; stamp?: 'ERROR' | 'WARN'; party: 'SCHOOL' | 'SUPPLIER' }>> = {
  QUOTE_REPORT: { must: 'توقيعات اللجنة / المدير', party: 'SCHOOL' },
  ORDER: { must: 'توقيع مدير المدرسة', stamp: 'WARN', party: 'SCHOOL' },
  RECEIPT: { must: 'توقيع المستلم في المدرسة', party: 'SCHOOL' },
  CERTIFICATE: { must: 'توقيعات المدير والمحاسب', stamp: 'WARN', party: 'SCHOOL' },
  COVER: { must: 'توقيع مدير المدرسة', stamp: 'WARN', party: 'SCHOOL' },
  INVOICE: { must: 'ختم أو توقيع المورد', party: 'SUPPLIER' },
  DELIVERY_NOTE: { must: 'ختم أو توقيع المورد', party: 'SUPPLIER' },
  UNDERTAKING: { must: 'توقيع وختم المورد', stamp: 'ERROR', party: 'SUPPLIER' },
  QUOTE: { must: 'ختم أو توقيع الشركة', party: 'SUPPLIER' },
};

function pageRules(x: Expected, e: Extraction, add: Add) {
  const pages = e.pages;
  const of = (t: DocType) => pages.filter((p) => p.docType === t);

  // 1. Completeness: every required document, a quotation and a commercial registration per company.
  for (const r of x.required) if (!of(r.type).length) add('ERROR', 'COMPLETE', null, `لا يوجد في الملف: ${DOC_TYPES[r.type]} (${r.why}).`);
  if (x.report && x.required.some((r) => r.type === 'QUOTE') && of('QUOTE').length && of('QUOTE').length < x.report.quotes.length)
    add('ERROR', 'COMPLETE', null, `عروض الأسعار المرفقة ${of('QUOTE').length} من ${x.report.quotes.length} مسجلة في التقرير.`);
  if (x.required.some((r) => r.type === 'CR')) {
    const companies = x.report?.quotes.map((q) => q.supplier).filter(Boolean) ?? (x.supplier ? [x.supplier.names[0]] : []);
    for (const company of companies.length ? companies : x.supplier ? [x.supplier.names[0]] : []) {
      const cr = of('CR').find((p) => compareNames(p.supplierName, company) !== 'different');
      if (!cr) {
        if (of('CR').length) add('ERROR', 'CR', null, `لا يوجد السجل التجاري لشركة «${company}».`);
        continue;
      }
      const when = x.report?.date ?? x.order?.date ?? x.today;
      if (!cr.validUntil) add('WARN', 'CR', cr.page, `${at(cr)}: لا يظهر تاريخ انتهاء السجل التجاري لشركة «${company}».`);
      else if (cr.validUntil < when)
        add(
          'ERROR',
          'CR',
          cr.page,
          `${at(cr)}: السجل التجاري لشركة «${company}» منتهٍ في ${showDate(cr.validUntil)} قبل ${showDate(when)}.`,
        );
    }
  }
  if (x.supplier?.cr)
    for (const cr of of('CR'))
      if (
        cr.crNumber &&
        compareNames(cr.supplierName, ...x.supplier.names) !== 'different' &&
        refKey(cr.crNumber) !== refKey(x.supplier.cr)
      )
        add('WARN', 'CR', cr.page, `${at(cr)}: رقم السجل «${cr.crNumber}» والمسجل للمورد ${x.supplier.cr}.`);
  for (const p of pages) {
    if (p.legible === 'low') add('WARN', 'READ', p.page, `${at(p)} غير واضحة؛ أعد تصويرها أو راجعها بالعين.`);
    if (p.docType === 'OTHER') add('NOTE', 'COMPLETE', p.page, `ص ${p.page}: مستند غير مصنف${p.remarks ? ` — ${p.remarks}` : ''}.`);
    else if (p.remarks) add('NOTE', 'READ', p.page, `${at(p)}: ${p.remarks}`);
  }

  // 2. The school's name, identical on every page that carries it.
  const SCHOOL_DOCS: DocType[] = ['QUOTE_REPORT', 'ORDER', 'RECEIPT', 'CERTIFICATE', 'COVER'];
  for (const p of pages) {
    if (
      ['OTHER', 'CR', 'IBAN', 'UNDERTAKING', 'INVITATION', 'BENEFICIARIES', 'DEPT_APPROVAL', 'PROCUREMENT_APPROVAL'].includes(p.docType) &&
      !p.schoolName
    )
      continue;
    if (!p.schoolName) {
      add(SCHOOL_DOCS.includes(p.docType as DocType) ? 'ERROR' : 'WARN', 'SCHOOL', p.page, `${at(p)}: لا يظهر اسم المدرسة.`);
      continue;
    }
    const other = x.otherSchools.find((n) => compareNames(p.schoolName, n) === 'same');
    const cmp = compareNames(p.schoolName, x.school);
    if (other && cmp !== 'same') add('ERROR', 'SCHOOL', p.page, `${at(p)}: اسم مدرسة أخرى «${p.schoolName}» بدلاً من «${x.school}».`);
    else if (cmp === 'different') add('ERROR', 'SCHOOL', p.page, `${at(p)}: اسم المدرسة «${p.schoolName}» لا يطابق «${x.school}».`);
    else if (cmp === 'close') add('WARN', 'SCHOOL', p.page, `${at(p)}: اختلاف في كتابة اسم المدرسة «${p.schoolName}» عن «${x.school}».`);
  }

  // 3. The awarded supplier on its documents.
  if (x.supplier)
    for (const p of pages) {
      if (!['ORDER', 'INVOICE', 'DELIVERY_NOTE', 'RECEIPT', 'CERTIFICATE', 'COVER', 'IBAN', 'UNDERTAKING'].includes(p.docType)) continue;
      if (!p.supplierName) {
        if (['ORDER', 'INVOICE', 'CERTIFICATE', 'UNDERTAKING', 'IBAN'].includes(p.docType))
          add('WARN', 'SUPPLIER', p.page, `${at(p)}: لا يظهر اسم المورد.`);
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
    if (x.order?.number && ['ORDER', 'CERTIFICATE', 'COVER', 'INVOICE', 'DELIVERY_NOTE'].includes(p.docType)) {
      if (!p.orderNumber) {
        if (['ORDER', 'CERTIFICATE'].includes(p.docType)) add('ERROR', 'REF', p.page, `${at(p)}: لا يظهر رقم التكليف ${x.order.number}.`);
        else if (p.docType === 'INVOICE') add('WARN', 'REF', p.page, `${at(p)}: لا يظهر رقم التكليف ${x.order.number}.`);
      } else if (!sameRef(p.orderNumber, x.order.number))
        add('ERROR', 'REF', p.page, `${at(p)}: رقم التكليف «${p.orderNumber}» والمسجل ${x.order.number}.`);
    }
    if (p.docType === 'INVOICE') {
      if (!p.invoiceNumber) add('ERROR', 'REF', p.page, `${at(p)}: لا يظهر رقم الفاتورة.`);
      else if (invoices.length && !invoices.some((i) => sameRef(p.invoiceNumber, i)))
        add('ERROR', 'REF', p.page, `${at(p)}: الفاتورة رقم «${p.invoiceNumber}» غير مسجلة في المعاملة (المسجل: ${invoices.join('، ')}).`);
    }
    if (
      ['CERTIFICATE', 'DELIVERY_NOTE', 'RECEIPT'].includes(p.docType) &&
      p.invoiceNumber &&
      invoices.length &&
      !invoices.some((i) => sameRef(p.invoiceNumber, i))
    )
      add('ERROR', 'REF', p.page, `${at(p)}: رقم الفاتورة «${p.invoiceNumber}» لا يطابق ${invoices.join('، ')}.`);
    if (p.docType === 'QUOTE' && x.report && p.quoteReference && !x.report.quotes.some((q) => sameRef(p.quoteReference, q.reference)))
      add('WARN', 'REF', p.page, `${at(p)}: مرجع العرض «${p.quoteReference}» غير وارد في التقرير.`);
  }
  const seen = new Map<string, PageFacts>();
  for (const p of of('INVOICE')) {
    const k = refKey(p.invoiceNumber);
    if (!k) continue;
    const prev = seen.get(k);
    if (prev && prev.amounts.total != null && p.amounts.total != null && !sameAmount(prev.amounts.total, p.amounts.total))
      add('ERROR', 'REF', p.page, `الفاتورة «${p.invoiceNumber}» مكررة بقيمتين مختلفتين (ص ${prev.page} و ص ${p.page}).`);
    seen.set(k, p);
  }

  // 5. Dates: each document's date as recorded, and the documents in their order.
  const certDates = x.certificates.map((c) => c.date);
  const coverDates = x.certificates.map((c) => c.coverDate).filter((d): d is string => !!d);
  const UNDATED_OK: DocType[] = ['OTHER', 'QUOTE', 'CR', 'IBAN', 'BENEFICIARIES'];
  for (const p of pages) {
    const d = p.documentDate;
    for (const dd of [d, ...p.otherDates.map((o) => o.date)].filter((v): v is string => !!v)) {
      if (dd > x.today) add('ERROR', 'DATE', p.page, `${at(p)}: تاريخ مستقبلي ${showDate(dd)}.`);
      else if (p.docType !== 'CR' && p.docType !== 'IBAN' && (dd < x.year.start || dd > x.year.end))
        add('WARN', 'DATE', p.page, `${at(p)}: التاريخ ${showDate(dd)} خارج العام المالي.`);
    }
    if (!d) {
      if (!UNDATED_OK.includes(p.docType as DocType)) add('ERROR', 'DATE', p.page, `${at(p)}: بلا تاريخ.`);
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
  const dates = (t: DocType) =>
    of(t)
      .map((p) => p.documentDate)
      .filter((v): v is string => !!v)
      .sort();
  const chain: [DocType, DocType, string][] = [
    ['INVITATION', 'QUOTE', 'دعوة الشركات بعد عرض السعر'],
    ['QUOTE', 'QUOTE_REPORT', 'عرض السعر بعد تقرير العروض'],
    ['QUOTE_REPORT', 'ORDER', 'تقرير العروض بعد كتاب التكليف'],
    ['PROCUREMENT_APPROVAL', 'ORDER', 'موافقة المشتريات بعد كتاب التكليف'],
    ['ORDER', 'DELIVERY_NOTE', 'كتاب التكليف بعد إذن التسليم'],
    ['ORDER', 'RECEIPT', 'كتاب التكليف بعد إذن الاستلام'],
    ['ORDER', 'INVOICE', 'الفاتورة قبل كتاب التكليف'],
    ['DELIVERY_NOTE', 'RECEIPT', 'إذن الاستلام قبل إذن التسليم'],
    ['RECEIPT', 'CERTIFICATE', 'إذن الاستلام بعد شهادة الإنجاز'],
    ['INVOICE', 'CERTIFICATE', 'الفاتورة بعد شهادة الإنجاز'],
    ['CERTIFICATE', 'COVER', 'شهادة الإنجاز بعد كتاب التغطية'],
  ];
  for (const [a, b, text] of chain) {
    const before = dates(a).at(-1),
      after = dates(b)[0];
    if (before && after && before > after)
      add('ERROR', 'DATE', of(b)[0]?.page ?? null, `تسلسل التواريخ: ${text} (${showDate(before)} > ${showDate(after)}).`);
  }
  const received = dates('RECEIPT').at(-1) ?? dates('DELIVERY_NOTE').at(-1);
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

  // 7. Items: count, names, quantities and prices on the order, the awarded quotation, the invoice and both receipts.
  if (x.items.length) {
    const single = x.deliveries.length === 1;
    for (const p of pages) {
      const kind = p.docType;
      const awarded = kind === 'QUOTE' && x.supplier && compareNames(p.supplierName, ...x.supplier.names) !== 'different';
      if (!(['ORDER', 'INVOICE', 'DELIVERY_NOTE', 'RECEIPT'].includes(kind) || awarded) || !p.items.length) continue;
      const delivered = ['INVOICE', 'DELIVERY_NOTE', 'RECEIPT'].includes(kind);
      if ((kind === 'ORDER' || awarded || (delivered && single)) && p.items.length !== x.items.length)
        add('ERROR', 'ITEMS', p.page, `${at(p)}: عدد الأصناف ${p.items.length} والمسجل ${x.items.length}.`);
      for (const it of p.items) {
        const match = x.items.find((s) => compareNames(it.name, s.name) !== 'different');
        if (!match) {
          add(kind === 'ORDER' ? 'ERROR' : 'WARN', 'ITEMS', p.page, `${at(p)}: الصنف «${it.name}» غير مطابق لأصناف التكليف.`);
          continue;
        }
        const wantQty = delivered ? (single ? match.accepted || match.qty : null) : match.qty;
        if (it.qty != null) {
          if (wantQty != null && Math.abs(it.qty - wantQty) > 0.0005)
            add('ERROR', 'ITEMS', p.page, `${at(p)}: كمية «${match.name}» ${it.qty} والمسجل ${wantQty}.`);
          else if (wantQty == null && it.qty - match.qty > 0.0005)
            add('ERROR', 'ITEMS', p.page, `${at(p)}: كمية «${match.name}» ${it.qty} أكبر من المكلف ${match.qty}.`);
        }
        if (it.unitPrice != null && match.unitPrice && (kind === 'INVOICE' || kind === 'ORDER')) {
          if (it.unitPrice - match.unitPrice > 0.005)
            add(
              'ERROR',
              'ITEMS',
              p.page,
              `${at(p)}: سعر «${match.name}» ${showAmount(it.unitPrice)} أعلى من سعر التكليف ${showAmount(match.unitPrice)}.`,
            );
          else if (match.unitPrice - it.unitPrice > 0.005)
            add(
              'WARN',
              'ITEMS',
              p.page,
              `${at(p)}: سعر «${match.name}» ${showAmount(it.unitPrice)} أقل من سعر التكليف ${showAmount(match.unitPrice)}.`,
            );
        }
      }
    }
  }

  // 8. The bank account.
  const recorded = x.supplier?.iban ? refKey(x.supplier.iban) : '';
  for (const p of pages) {
    if (!p.iban || !['IBAN', 'INVOICE', 'UNDERTAKING', 'COVER'].includes(p.docType)) continue;
    if (!recorded) add('NOTE', 'BANK', p.page, `${at(p)}: IBAN ${p.iban} وليس للمورد IBAN مسجل في النظام للمقارنة.`);
    else if (refKey(p.iban) !== recorded)
      add('ERROR', 'BANK', p.page, `${at(p)}: IBAN «${p.iban}» يختلف عن المسجل للمورد ${x.supplier!.iban}.`);
  }
  for (const p of of('IBAN')) if (!p.iban) add('ERROR', 'BANK', p.page, `${at(p)}: لا يظهر رقم IBAN.`);

  // 9. Signatures and stamps.
  for (const p of pages) {
    const need = SIGNS[p.docType as DocType];
    if (!need || !p.signatures) continue;
    if (need.party === 'SUPPLIER' && p.docType !== 'UNDERTAKING') {
      if (!p.stamp && !p.signatures.some((s) => s.signed))
        add(p.docType === 'QUOTE' ? 'WARN' : 'ERROR', 'SIGN', p.page, `${at(p)}: بلا ${need.must}.`);
      continue;
    }
    const unsigned = p.signatures.filter((s) => !s.signed).map((s) => s.role || 'غير محدد');
    if (!p.signatures.length || !p.signatures.some((s) => s.signed)) add('ERROR', 'SIGN', p.page, `${at(p)}: غير موقّع (${need.must}).`);
    else if (unsigned.length) add('ERROR', 'SIGN', p.page, `${at(p)}: غير موقّع من: ${unsigned.join('، ')}.`);
    if (need.stamp && p.stamp === false)
      add(need.stamp, 'SIGN', p.page, `${at(p)}: بلا ختم ${need.party === 'SCHOOL' ? 'المدرسة' : 'المورد'}.`);
  }

  // 10. The administration's requirements.
  for (const r of x.rules) {
    const a = e.rules.find((v) => v.id === r.id);
    if (!a || a.met === 'unknown') add('WARN', 'RULE', a?.page ?? null, `متطلب الإدارة «${r.text}»: تعذر التحقق آلياً؛ راجعه يدوياً.`);
    else if (a.met === 'no') add(r.level, 'RULE', a.page, `متطلب الإدارة غير مستوفى: «${r.text}»${a.evidence ? ` — ${a.evidence}` : ''}.`);
  }
}

/** Without any reading service: only references, digits and dates of PDF text layers. */
function textRules(x: Expected, e: Extraction, add: Add) {
  const all = e.pages.flatMap((p) => (p.tokens ? [p] : []));
  const refs = all.flatMap((p) => p.tokens!.refs.map((r) => ({ r, page: p.page })));
  const dates = all.flatMap((p) => p.tokens!.dates.map((d) => ({ d, page: p.page })));
  const amounts = all.flatMap((p) => p.tokens!.amounts.map((a) => ({ a, page: p.page })));
  const readable = all.filter((p) => !p.scanned).length;
  if (e.unread)
    add('WARN', 'READ', null, `${e.unread} صفحة صورة أو ممسوحة لا يمكن قراءتها في هذا الوضع؛ راجعها بالعين أو استخدم Claude / ChatGPT.`);
  if (!readable) return;
  if (e.pages.length < x.required.length)
    add('WARN', 'COMPLETE', null, `عدد الصفحات ${e.pages.length} أقل من المستندات المطلوبة (${x.required.length}).`);
  const found = (v: string) => refs.find((r) => sameRef(r.r, v));
  if (x.order?.number && !found(x.order.number)) add('ERROR', 'REF', null, `رقم التكليف ${x.order.number} لا يظهر في الملف.`);
  for (const d of x.deliveries)
    if (d.invoice && !found(d.invoice)) add('ERROR', 'REF', null, `رقم الفاتورة ${d.invoice} لا يظهر في الملف.`);
  for (const r of refs) {
    const k = refKey(r.r);
    if (/^[A-Z][A-Z0-9]*\/\d{4}\/\d+$/.test(k) && x.order?.number && !sameRef(r.r, x.order.number))
      add('ERROR', 'REF', r.page, `ص ${r.page}: رقم تكليف «${r.r}» غير رقم المعاملة ${x.order.number}.`);
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(k) && x.supplier?.iban && k !== refKey(x.supplier.iban))
      add('ERROR', 'BANK', r.page, `ص ${r.page}: IBAN «${r.r}» يختلف عن المسجل للمورد ${x.supplier.iban}.`);
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
  add('NOTE', 'READ', null, 'قراءة نص PDF فقط: الأسماء والأصناف والتوقيعات والمستندات المطلوبة في قائمة المراجعة اليدوية أسفل التقرير.');
}

/** Items the accountant confirms by hand: what the chosen reading cannot see, plus the administration's requirements. */
export function manualChecklist(x: Expected, e: Extraction): string[] {
  const list: string[] = [];
  if (e.mode === 'TEXT') {
    list.push(`المستندات كاملة: ${x.required.map((r) => DOC_TYPES[r.type]).join('، ')}`);
    list.push(
      `اسم المدرسة «${x.school}» بنفس الصيغة في كل ورقة، واسم المورد «${x.supplier?.names[0] ?? '—'}» في التكليف والفاتورة والشهادة`,
    );
    list.push(`الأصناف (${x.items.length}) وكمياتها متطابقة في التكليف والفاتورة وإذني التسليم والاستلام`);
    list.push('كل التوقيعات المطلوبة موجودة، والأختام على التكليف والشهادة والتغطية والتعهد');
    list.push(`السجل التجاري لكل شركة ساري، وIBAN مطابق${x.supplier?.iban ? ` (${x.supplier.iban})` : ''}، والتعهد موقّع ومختوم`);
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

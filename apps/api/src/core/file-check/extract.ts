import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';
import { fail } from '../../common/validation';
import { isoFrom, westernDigits } from './normalize';

/**
 * Reading the paper file. Two ways, chosen by the administrator's setting:
 * - AI: every page (PDF pages and photos) is read by Claude, which returns only what it sees on the
 *   page (document type, school, supplier, references, dates, amounts, signatures, stamp). It is not
 *   given the values recorded in the system, so it cannot «confirm» them; the comparison is done
 *   afterwards by fixed rules (rules.ts).
 * - TEXT: no data leaves the server. Only a PDF's text layer is read; it carries the Latin references,
 *   digits and dates reliably, while Arabic words of printed PDFs come out as broken glyphs, so names,
 *   signatures and stamps are left to the accountant's checklist.
 */

export const DOC_TYPES = {
  INVITATION: 'دعوة الشركات لتقديم العروض',
  QUOTE: 'عرض سعر',
  CR: 'سجل تجاري',
  QUOTE_REPORT: 'تقرير دراسة عروض الأسعار',
  PROCUREMENT_APPROVAL: 'موافقة إدارة المشتريات',
  DEPT_APPROVAL: 'موافقة القسم المختص',
  ORDER: 'كتاب التكليف',
  DELIVERY_NOTE: 'إذن التسليم من المورد',
  RECEIPT: 'إذن الاستلام من المدرسة',
  INVOICE: 'فاتورة',
  IBAN: 'إثبات الحساب البنكي (IBAN)',
  UNDERTAKING: 'تعهد عدم تبعية الشركة لمنسوبي الوزارة',
  BENEFICIARIES: 'كشوف المستفيدين',
  CERTIFICATE: 'شهادة إنجاز الأعمال',
  COVER: 'كتاب التغطية',
  OTHER: 'مستند آخر',
} as const;
export const DOC_KEYS = Object.keys(DOC_TYPES) as [DocType, ...DocType[]];
/** Supporting-document codes of the system (core/documents.ts) and the page type that proves each one. */
export const EVIDENCE_DOC: Record<number, DocType> = {
  1: 'INVITATION',
  2: 'QUOTE',
  3: 'CR',
  4: 'QUOTE_REPORT',
  5: 'ORDER',
  6: 'INVOICE',
  7: 'DELIVERY_NOTE',
  8: 'RECEIPT',
  9: 'UNDERTAKING',
  10: 'IBAN',
  11: 'DEPT_APPROVAL',
  12: 'BENEFICIARIES',
  15: 'PROCUREMENT_APPROVAL',
};
export type DocType = keyof typeof DOC_TYPES;

export type UploadedFile = { name: string; mime: 'application/pdf' | 'image/png' | 'image/jpeg'; data: Buffer };

export type PageFacts = {
  page: number;
  file: string;
  docType: DocType | 'UNKNOWN';
  schoolName: string | null;
  supplierName: string | null;
  documentDate: string | null;
  otherDates: { label: string; date: string }[];
  orderNumber: string | null;
  invoiceNumber: string | null;
  quoteReference: string | null;
  crNumber: string | null;
  validUntil: string | null;
  iban: string | null;
  amounts: { total: number | null; gross: number | null; fine: number | null; net: number | null };
  items: { name: string; qty: number | null; unitPrice: number | null; total: number | null }[];
  signatures: { role: string; signed: boolean }[] | null;
  stamp: boolean | null;
  legible: 'high' | 'medium' | 'low';
  remarks: string | null;
  /** TEXT mode: every date, reference-like token and amount on the page. */
  tokens?: { dates: string[]; refs: string[]; amounts: number[] };
  /** TEXT mode: the page has no text layer (a scan or a photo). */
  scanned?: boolean;
};

export type RuleAnswer = { id: string; met: 'yes' | 'no' | 'unknown'; page: number | null; evidence: string | null };

/** AI: read in the system; EXTERNAL: read by the accountant's own Claude / ChatGPT and pasted back; TEXT: PDF text layer only. */
export type Extraction = { mode: 'AI' | 'TEXT' | 'EXTERNAL'; pages: PageFacts[]; rules: RuleAnswer[]; unread: number };

/* ---------------- TEXT mode ---------------- */

const esm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
const DATE_RE = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/g;
const AMOUNT_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+\.\d{2}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const REF_RE = /\b[A-Z][A-Z0-9]{1,15}(?:[/-][A-Z0-9]{1,15}){1,4}\b|\b[A-Z]{2,}\d{2,}\b|\b\d{5,}\b/g;

const blank = (page: number, file: string): PageFacts => ({
  page,
  file,
  docType: 'UNKNOWN',
  schoolName: null,
  supplierName: null,
  documentDate: null,
  otherDates: [],
  orderNumber: null,
  invoiceNumber: null,
  quoteReference: null,
  crNumber: null,
  validUntil: null,
  iban: null,
  amounts: { total: null, gross: null, fine: null, net: null },
  items: [],
  signatures: null,
  stamp: null,
  legible: 'high',
  remarks: null,
});

/** Pages of the uploaded files as seen through the PDF text layer; photos count as unread pages. */
export async function readTextLayer(files: UploadedFile[]): Promise<Extraction> {
  const pages: PageFacts[] = [];
  let unread = 0;
  for (const f of files) {
    if (f.mime !== 'application/pdf') {
      const p = blank(pages.length + 1, f.name);
      p.scanned = true;
      p.legible = 'low';
      pages.push(p);
      unread++;
      continue;
    }
    const pdfjs = await esm('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(f.data), isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
    let doc: any;
    try {
      doc = await task.promise;
    } catch {
      await task.destroy().catch(() => {});
      fail(`تعذر قراءة الملف «${f.name}»؛ تأكد أنه PDF سليم`);
    }
    try {
      if (doc.numPages + pages.length > MAX_PAGES) fail(`عدد الصفحات أكبر من ${MAX_PAGES}؛ افحص المعاملة على دفعات`);
      for (let n = 1; n <= doc.numPages; n++) {
        const items = (await (await doc.getPage(n)).getTextContent()).items as { str: string }[];
        // Only clean characters: printed Arabic often comes out as broken glyphs and is ignored here.
        const text = westernDigits(items.map((i) => i.str.replace(/[^\x20-\x7E٠-٩]/g, ' ')).join(' '));
        const p = blank(pages.length + 1, f.name);
        const dates = [...new Set([...text.matchAll(DATE_RE)].map((m) => isoFrom(m[1])).filter((d): d is string => !!d))];
        const amounts = [...new Set([...text.matchAll(AMOUNT_RE)].map((m) => Number(m[0].replace(/,/g, ''))))];
        const refs = [...new Set([...text.matchAll(REF_RE)].map((m) => m[0]).filter((r) => !/^\d{4}[/-]\d{1,2}/.test(r)))];
        const ibans = [...new Set([...text.replace(/\s+(?=[A-Z0-9]{4}\b)/g, '').matchAll(IBAN_RE)].map((m) => m[0]))];
        p.tokens = { dates, amounts, refs: [...refs, ...ibans] };
        if (!text.trim()) {
          p.scanned = true;
          p.legible = 'low';
          unread++;
        }
        pages.push(p);
      }
    } finally {
      await task.destroy().catch(() => {});
    }
  }
  return { mode: 'TEXT', pages, rules: [], unread };
}

/* ---------------- AI mode ---------------- */

export const MAX_PAGES = 40;
const MODEL = 'claude-opus-5-5';

const nullableString = z.string().nullable();
export const PageSchema = z.object({
  page: z.number().int(),
  docType: z.enum(DOC_KEYS),
  schoolName: nullableString,
  supplierName: nullableString,
  documentDate: nullableString,
  otherDates: z.array(z.object({ label: z.string(), date: z.string() })),
  orderNumber: nullableString,
  invoiceNumber: nullableString,
  quoteReference: nullableString,
  crNumber: nullableString,
  validUntil: nullableString,
  iban: nullableString,
  amounts: z.object({
    total: z.number().nullable(),
    gross: z.number().nullable(),
    fine: z.number().nullable(),
    net: z.number().nullable(),
  }),
  items: z.array(
    z.object({ name: z.string(), qty: z.number().nullable(), unitPrice: z.number().nullable(), total: z.number().nullable() }),
  ),
  signatures: z.array(z.object({ role: z.string(), signed: z.boolean() })),
  stamp: z.boolean().nullable(),
  legible: z.enum(['high', 'medium', 'low']),
  remarks: nullableString,
});
export const OutputSchema = z.object({
  pages: z.array(PageSchema),
  rules: z.array(
    z.object({ id: z.string(), met: z.enum(['yes', 'no', 'unknown']), page: z.number().int().nullable(), evidence: nullableString }),
  ),
});
export type Output = z.infer<typeof OutputSchema>;

/** The reading instructions, shared by the in-system reading and the prompt the accountant copies to Claude / ChatGPT. */
export const READING_RULES = `You read scanned or photographed pages of a purchase file from a government school in Qatar (Ministry of Education and Higher Education). Pages are mostly Arabic; supplier documents may be English.
Report only what is visible on each page. Never guess, complete or correct a value: if a field is not on the page or cannot be read with confidence, return null (or an empty list) and say so in remarks.
Document types (docType):
${Object.entries(DOC_TYPES)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}
Hints: ORDER is the school's assignment letter («كتاب تكليف» / «الموضوع: تكليف»); DELIVERY_NOTE is issued by the supplier (Delivery Note / إذن تسليم); RECEIPT is issued and signed by the school (إذن / سند استلام); IBAN is a bank letter or certificate showing the company's account; UNDERTAKING is the supplier's declaration that the company is not owned by any Ministry employee; COVER requests payment («صرف مستحقات شركة»).
Field rules:
- page: pages are numbered 1, 2, 3… in the order they are attached; every PDF page counts as one page. Return one entry per page, in order.
- schoolName: the school's name exactly as written (without a leading «مدرسة»), or null.
- supplierName: the company's name exactly as written, or null.
- documentDate: the date of the document itself (letterhead date, invoice date, delivery date on a delivery note or receipt), as YYYY-MM-DD. Dates on these pages are written day/month/year.
- otherDates: other dates on the page with a short Arabic label, as YYYY-MM-DD.
- orderNumber: the assignment letter reference (e.g. «ABAF/2026/007») wherever it appears on the page.
- invoiceNumber: the supplier invoice number on this page, or the one cited by a certificate, delivery note or letter.
- quoteReference: a quotation's reference.
- crNumber / validUntil: on a commercial registration, its number and expiry date (YYYY-MM-DD).
- iban: an IBAN on the page (letters and digits, no spaces).
- amounts: numbers only, no currency. total = the main value (order value, invoice total, quotation total, or the amount requested in a covering letter); gross / fine / net = due amount, delay penalty and net payable on a certificate or letter.
- items: every line item on quotations, orders, invoices, delivery notes and receipts: name as written, quantity, unit price and line total (null when not shown). Empty list for other pages.
- signatures: every signature place on the page with the role printed next to it (e.g. «مدير المدرسة», «المحاسب», «مسؤول المشتريات», «المستلم», «أمين المخزن», «المورد»); signed = a handwritten signature is present.
- stamp: whether an official stamp or seal is present.
- legible: how clearly the page could be read (high, medium, low).
- remarks: a short Arabic note on anything an auditor should know (corrections, crossed-out values, missing parts, handwriting over print), or null.
The rules list asks whether the file meets requirements of the administration: answer each by id with yes, no or unknown, the page that shows it, and a short Arabic quote as evidence.`;

/** Builds the client; tests and private gateways may point it elsewhere with AI_API_BASE. */
function client(key: string) {
  return new Anthropic({
    apiKey: key,
    maxRetries: 2,
    timeout: 240_000,
    ...(process.env.AI_API_BASE ? { baseURL: process.env.AI_API_BASE } : {}),
  });
}

export async function readWithAi(key: string, files: UploadedFile[], rules: { id: string; text: string }[]): Promise<Extraction> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of files) {
    const data = f.data.toString('base64');
    content.push(
      f.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.name }
        : { type: 'image', source: { type: 'base64', media_type: f.mime, data } },
    );
  }
  content.push({
    type: 'text',
    text:
      `Read the ${files.length} attached file(s) in order and return the facts of every page.` +
      (rules.length
        ? `\nAdministration requirements to answer:\n${rules.map((r) => `- ${r.id}: ${r.text}`).join('\n')}`
        : '\nNo administration requirements: return an empty rules list.'),
  });
  let response;
  try {
    response = await client(key).messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(OutputSchema) },
      system: READING_RULES,
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) fail('مفتاح المساعد الذكي غير صالح؛ يراجعه مسؤول النظام');
    if (e instanceof Anthropic.RateLimitError) fail('خدمة القراءة الآلية مشغولة الآن؛ أعد المحاولة بعد دقيقة');
    if (e instanceof Anthropic.BadRequestError) fail('رفضت خدمة القراءة الآلية الملف؛ تأكد أن الصور واضحة وأن الحجم مناسب');
    if (e instanceof Anthropic.APIError) fail('تعذر الاتصال بخدمة القراءة الآلية؛ أعد المحاولة لاحقاً');
    throw e;
  }
  if (response.stop_reason === 'refusal') fail('تعذر على خدمة القراءة الآلية قراءة هذا الملف');
  if (response.stop_reason === 'max_tokens') fail('الملف طويل جداً للقراءة مرة واحدة؛ افحصه على دفعات');
  const out = response.parsed_output;
  if (!out) fail('تعذر فهم نتيجة القراءة الآلية؛ أعد المحاولة');
  const pages = normalisePages(out);
  return { mode: 'AI', pages, rules: out.rules, unread: pages.filter((p) => p.legible === 'low').length };
}

function normalisePages(out: Output): PageFacts[] {
  return [...out.pages]
    .sort((a, b) => a.page - b.page)
    .map((p): PageFacts => ({
      ...p,
      file: '',
      documentDate: isoFrom(p.documentDate),
      validUntil: isoFrom(p.validUntil),
      iban: p.iban ? p.iban.replace(/\s+/g, '').toUpperCase() : null,
      otherDates: p.otherDates.map((d) => ({ label: d.label, date: isoFrom(d.date) ?? '' })).filter((d) => d.date),
    }));
}

/**
 * The reply the accountant pasted from Claude / ChatGPT: the first JSON object in the text (code
 * fences and any words around it are ignored), checked against the same schema as the in-system reading.
 */
export function readPasted(text: string): Extraction {
  const start = text.indexOf('{'),
    end = text.lastIndexOf('}');
  if (start < 0 || end <= start) fail('لم أجد نتيجة JSON في النص الملصق؛ انسخ رد Claude / ChatGPT كاملاً');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    fail('النص الملصق ليس JSON سليماً؛ اطلب من Claude / ChatGPT إعادة الإخراج بصيغة JSON فقط');
  }
  // Older replies may lack the newer fields: they are filled as empty before checking.
  const fill = (v: any) => ({
    ...v,
    pages: Array.isArray(v?.pages)
      ? v.pages.map((p: any) => ({
          otherDates: [],
          orderNumber: null,
          invoiceNumber: null,
          quoteReference: null,
          crNumber: null,
          validUntil: null,
          iban: null,
          items: [],
          signatures: [],
          stamp: null,
          legible: 'medium',
          remarks: null,
          schoolName: null,
          supplierName: null,
          documentDate: null,
          amounts: { total: null, gross: null, fine: null, net: null },
          ...p,
        }))
      : v?.pages,
    rules: Array.isArray(v?.rules) ? v.rules : [],
  });
  const r = OutputSchema.safeParse(fill(raw));
  if (!r.success) {
    const issue = r.error.issues[0];
    fail(`الرد الملصق لا يطابق الصيغة المطلوبة (${issue.path.join('.')}: ${issue.message}). انسخ الأمر من النظام كما هو وأعد المحاولة.`);
  }
  if (!r.data.pages.length) fail('الرد الملصق لا يحتوي صفحات');
  if (r.data.pages.length > MAX_PAGES) fail(`عدد الصفحات أكبر من ${MAX_PAGES}؛ افحص المعاملة على دفعات`);
  const pages = normalisePages(r.data);
  return { mode: 'EXTERNAL', pages, rules: r.data.rules, unread: pages.filter((p) => p.legible === 'low').length };
}

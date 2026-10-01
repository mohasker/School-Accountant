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
  QUOTE: 'عرض سعر من شركة',
  QUOTE_REPORT: 'تقرير دراسة عروض الأسعار',
  ORDER: 'كتاب التكليف',
  INVOICE: 'فاتورة',
  RECEIPT: 'سند استلام / تسليم',
  CERTIFICATE: 'شهادة إنجاز الأعمال',
  COVER: 'كتاب التغطية',
  OTHER: 'مستند آخر',
} as const;
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
  amounts: { total: number | null; gross: number | null; fine: number | null; net: number | null };
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

export type Extraction = { mode: 'AI' | 'TEXT'; pages: PageFacts[]; rules: RuleAnswer[]; unread: number };

/* ---------------- TEXT mode ---------------- */

const esm = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
const DATE_RE = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})\b/g;
const AMOUNT_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b|\b\d+\.\d{2}\b/g;
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
  amounts: { total: null, gross: null, fine: null, net: null },
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
        p.tokens = { dates, amounts, refs };
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

const PageSchema = z.object({
  page: z.number().int(),
  docType: z.enum(['QUOTE', 'QUOTE_REPORT', 'ORDER', 'INVOICE', 'RECEIPT', 'CERTIFICATE', 'COVER', 'OTHER']),
  schoolName: z.string().nullable(),
  supplierName: z.string().nullable(),
  documentDate: z.string().nullable(),
  otherDates: z.array(z.object({ label: z.string(), date: z.string() })),
  orderNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  quoteReference: z.string().nullable(),
  amounts: z.object({
    total: z.number().nullable(),
    gross: z.number().nullable(),
    fine: z.number().nullable(),
    net: z.number().nullable(),
  }),
  signatures: z.array(z.object({ role: z.string(), signed: z.boolean() })),
  stamp: z.boolean().nullable(),
  legible: z.enum(['high', 'medium', 'low']),
  remarks: z.string().nullable(),
});
const OutputSchema = z.object({
  pages: z.array(PageSchema),
  rules: z.array(
    z.object({ id: z.string(), met: z.enum(['yes', 'no', 'unknown']), page: z.number().int().nullable(), evidence: z.string().nullable() }),
  ),
});

const SYSTEM = `You read scanned or photographed pages of a purchase file from a government school in Qatar (Ministry of Education and Higher Education). Pages are mostly Arabic; supplier invoices may be English.
Report only what is visible on each page. Never guess, complete or correct a value: if a field is not on the page or cannot be read with confidence, return null (or an empty list) and mention it in remarks.
Document types:
- QUOTE: a supplier's price quotation.
- QUOTE_REPORT: «تقرير دراسة عروض الأسعار» issued by the school.
- ORDER: the school's assignment letter to the supplier («كتاب تكليف» / «الموضوع: تكليف»).
- INVOICE: the supplier's invoice (فاتورة / Tax Invoice).
- RECEIPT: a delivery note or receipt (سند استلام، سند تسليم، إذن تسليم، Delivery Note).
- CERTIFICATE: «شهادة إنجاز أعمال».
- COVER: the covering letter requesting payment («صرف مستحقات شركة»).
- OTHER: anything else.
Field rules:
- page: pages are numbered 1, 2, 3… in the order they are attached; every PDF page counts as one page. Return one entry per page.
- schoolName: the school's name exactly as written on the page (without the word «مدرسة» if it precedes it), or null.
- supplierName: the company's name exactly as written, or null.
- documentDate: the date of the document itself (issue date in the letterhead or the invoice date), as YYYY-MM-DD. Dates on these pages are written day/month/year.
- otherDates: other dates with a short Arabic label (e.g. «تاريخ التوريد», «تاريخ التكليف», «تاريخ الاستلام»), as YYYY-MM-DD.
- orderNumber: the assignment letter reference (e.g. «ABAF/2026/007») wherever it appears on the page.
- invoiceNumber: the supplier's invoice number on this page, or the invoice number cited by a certificate or letter.
- quoteReference: the quotation reference on a quote.
- amounts: numbers only, no currency. total = the main value (order value, invoice total including any tax, quotation total, or the amount requested in a covering letter); gross / fine / net = the certificate's or letter's due amount, delay penalty and net payable.
- signatures: every signature place on the page with the role printed next to it (e.g. «مدير المدرسة», «المحاسب», «مسؤول المشتريات», «المستلم», «المورد»), signed = whether a handwritten signature is present.
- stamp: whether an official stamp/seal is present on the page.
- legible: how clearly you could read the page.
- remarks: short Arabic note about anything an auditor should know (corrections, crossed-out values, missing parts, handwriting over print), or null.
The rules list asks whether the file meets requirements of the administration; answer each by id with yes, no or unknown, the page that shows it, and a short Arabic evidence quote.`;

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
      system: SYSTEM,
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
  const pages = out.pages
    .sort((a, b) => a.page - b.page)
    .map((p): PageFacts => ({
      ...p,
      file: '',
      documentDate: isoFrom(p.documentDate),
      otherDates: p.otherDates.map((d) => ({ label: d.label, date: isoFrom(d.date) ?? '' })).filter((d) => d.date),
    }));
  return { mode: 'AI', pages, rules: out.rules, unread: pages.filter((p) => p.legible === 'low').length };
}

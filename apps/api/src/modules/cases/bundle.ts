import { NotFoundException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { db } from '../../common/db';
import { id, parse } from '../../common/validation';
import { EVIDENCE } from '../../core/documents';
import { htmlToPdf } from '../../core/pdf';
import { dateHtml, esc, num, printDocument } from '../../print/layout';
import { getCase } from './common';

/**
 * «ملف المعاملة المجمّع»: one PDF with an index page followed by every document of the case in the
 * order the auditors read it: the documents the system issued (as issued, unchanged) and the scans
 * attached to the case. The index is an internal page; the official documents are not altered.
 */

/** The auditors' order, by supporting-document code; 4, 5, 13 and 14 may also come from the system. */
const ORDER = [1, 2, 3, 4, 15, 11, 5, 7, 8, 6, 9, 10, 12, 13, 14];

type Part = { code: number; title: string; source: 'SYSTEM' | 'SIGNED' | 'ATTACHED'; pdf: Buffer | null; name: string };

const A4 = { w: 595.28, h: 841.89 };

async function toPdf(mime: string, data: Buffer): Promise<PDFDocument> {
  if (mime === 'application/pdf') return PDFDocument.load(data, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  const img = mime === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);
  const page = doc.addPage([A4.w, A4.h]);
  const scale = Math.min((A4.w - 40) / img.width, (A4.h - 40) / img.height, 1);
  const w = img.width * scale,
    h = img.height * scale;
  page.drawImage(img, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  return doc;
}

export async function caseBundle(school: string, caseId: string) {
  const c = await getCase(db, school, parse(id, caseId)).catch(() => null);
  if (!c) throw new NotFoundException();
  const files = await db.evidence.findMany({
    where: { caseId: c.id, status: { not: 'NA' }, data: { not: null } },
    orderBy: { createdAt: 'asc' },
  });
  const certs = await db.certificate.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'asc' } });
  const parts: Part[] = [];
  const fromHtml = async (html: string) => Buffer.from((await htmlToPdf(html)).base64, 'base64');
  for (const code of ORDER) {
    const attached = files.filter((f) => f.code === code);
    const title = EVIDENCE[code]?.name ?? 'مستند';
    // Signed scans of the certificate and covering letter replace the system copies when present.
    if (code === 4 && c.evaluationHtml && !attached.length)
      parts.push({ code, title, source: 'SYSTEM', pdf: await fromHtml(c.evaluationHtml), name: '' });
    if (code === 5 && c.orderHtml && !attached.length)
      parts.push({ code, title, source: 'SYSTEM', pdf: await fromHtml(c.orderHtml), name: '' });
    if (code === 13 && !attached.length)
      for (const x of certs) parts.push({ code, title: 'شهادة إنجاز الأعمال', source: 'SYSTEM', pdf: await fromHtml(x.html), name: '' });
    if (code === 14 && !attached.length)
      for (const x of certs)
        if (x.coverHtml) parts.push({ code, title: 'كتاب التغطية', source: 'SYSTEM', pdf: await fromHtml(x.coverHtml), name: '' });
    for (const f of attached)
      parts.push({
        code,
        title,
        source: code === 13 || code === 14 ? 'SIGNED' : 'ATTACHED',
        pdf: Buffer.from(f.data!),
        name: `${f.name}|${f.mime}`,
      });
  }
  const notApplicable = await db.evidence.findMany({ where: { caseId: c.id, status: 'NA' }, select: { code: true, reason: true } });

  // Build the documents first to know their page numbers, then the index in front.
  const body = await PDFDocument.create();
  const rows: { title: string; source: string; from: number; to: number; note: string }[] = [];
  for (const p of parts) {
    let src: PDFDocument;
    try {
      src = p.source === 'SYSTEM' ? await PDFDocument.load(p.pdf!) : await toPdf(p.name.split('|')[1], p.pdf!);
    } catch {
      rows.push({ title: p.title, source: 'مرفق', from: 0, to: 0, note: 'تعذر دمج الملف؛ يُطبع منفصلاً' });
      continue;
    }
    const from = body.getPageCount() + 2;
    for (const page of await body.copyPages(src, src.getPageIndices())) body.addPage(page);
    rows.push({
      title: p.title,
      source: p.source === 'SYSTEM' ? 'صادر من النظام' : p.source === 'SIGNED' ? 'نسخة موقعة مرفقة' : 'مرفق',
      from,
      to: body.getPageCount() + 1,
      note: p.name ? p.name.split('|')[0] : '',
    });
  }
  const present = new Set(parts.map((p) => p.code));
  const missing = ORDER.filter(
    (code) => !present.has(code) && ![11, 12, 15].includes(code) && !notApplicable.some((n) => n.code === code),
  ).map((code) => EVIDENCE[code]?.name ?? String(code));
  const supplier = ((c.supplierSnapshot ?? c.supplier) as { name?: string } | null)?.name ?? '';
  const index = printDocument({
    title: 'فهرس ملف المعاملة',
    ref: c.number,
    date: new Date(),
    compact: true,
    showRef: false,
    body: `<h1 style="font-size:13pt;margin:1mm 0">فهرس ملف المعاملة</h1>
<p>المدرسة: <b>${esc(c.school.name)}</b> — المعاملة ${num(c.number)}${c.orderNumber ? ` — التكليف ${num(c.orderNumber)}` : ''} — المورد: ${esc(supplier || '—')}</p>
<table style="width:100%;border-collapse:collapse;font-size:10pt"><tr style="background:#f3f0f1"><th style="border:1px solid #bbb;padding:1.5mm">م</th><th style="border:1px solid #bbb;padding:1.5mm">المستند</th><th style="border:1px solid #bbb;padding:1.5mm">المصدر</th><th style="border:1px solid #bbb;padding:1.5mm">الصفحات</th></tr>
${rows
  .map(
    (r, i) =>
      `<tr><td style="border:1px solid #bbb;padding:1.5mm">${num(i + 1)}</td><td style="border:1px solid #bbb;padding:1.5mm">${esc(r.title)}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td><td style="border:1px solid #bbb;padding:1.5mm">${esc(r.source)}</td><td style="border:1px solid #bbb;padding:1.5mm">${r.from ? num(r.from === r.to ? String(r.from) : `${r.from}–${r.to}`) : '—'}</td></tr>`,
  )
  .join('')}
</table>
${missing.length ? `<p style="margin-top:3mm"><b>غير مرفق في النظام:</b> ${esc(missing.join('، '))} — تأكد من وجودها في الملف الورقي.</p>` : ''}
${notApplicable.length ? `<p><b>لا ينطبق:</b> ${esc(notApplicable.map((n) => `${EVIDENCE[n.code]?.name ?? n.code} (${n.reason})`).join('، '))}</p>` : ''}
<p style="font-size:8.5pt;color:#555">صفحة داخلية لترتيب الملف؛ المستندات الرسمية مدرجة كما صدرت دون تعديل. أُعدّ ${dateHtml(new Date())}.</p>`,
  });
  const out = await PDFDocument.create();
  const indexPdf = await PDFDocument.load(Buffer.from((await htmlToPdf(index)).base64, 'base64'));
  for (const page of await out.copyPages(indexPdf, [0])) out.addPage(page);
  for (const page of await out.copyPages(body, body.getPageIndices())) out.addPage(page);
  const bytes = await out.save();
  return {
    base64: Buffer.from(bytes).toString('base64'),
    name: `ملف-${c.number}.pdf`,
    mime: 'application/pdf',
    pages: out.getPageCount(),
    documents: rows.length,
    missing,
  };
}

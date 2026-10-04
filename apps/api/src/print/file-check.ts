import type { Expected, Finding } from '../core/file-check/rules';
import { showAmount } from '../core/file-check/normalize';
import { dateHtml, esc, num, printDocument } from './layout';

/** Lines that fit one A4 page with the header, the checklist and the footer. */
const MAX_LINES = 22;

const RESULT = {
  READY: { text: 'جاهز للإرسال', cls: 'ok' },
  REVIEW: { text: 'جاهز بعد مراجعة التنبيهات', cls: 'warn' },
  FIX: { text: 'يحتاج تصحيحاً قبل الإرسال', cls: 'bad' },
} as const;

const SECTION = {
  ERROR: 'أخطاء تمنع الإرسال',
  WARN: 'تنبيهات تحتاج قراراً',
  NOTE: 'ملاحظات',
} as const;

type Mode = 'AI' | 'TEXT' | 'EXTERNAL';
const MODE_TEXT: Record<Mode, string> = {
  AI: 'قراءة آلية لكل صفحة (صور و PDF)',
  EXTERNAL: 'قراءة Claude / ChatGPT خارج النظام (رد ملصق)',
  TEXT: 'نص ملفات PDF فقط (بدون قراءة آلية)',
};

type Common = {
  findings: Finding[];
  checklist: string[];
  result: keyof typeof RESULT;
  counts: { errors: number; warnings: number; notes: number };
  mode: Mode;
  source: 'WEB' | 'TELEGRAM';
  files: { name: string; pages: number }[];
  pages: number;
  by: string;
  at: Date;
};

/** The one-page layout shared by the case check and the imprest settlement check. */
function checkPage(o: Common & { title: string; ref: string; head: [string, string][]; footer: string }) {
  const room = Math.max(4, MAX_LINES - o.checklist.length);
  const shown = o.findings.slice(0, room);
  const hidden = o.findings.length - shown.length;
  const sections = (['ERROR', 'WARN', 'NOTE'] as const)
    .map((level) => {
      const items = shown.filter((f) => f.level === level);
      if (!items.length) return '';
      return `<h3 class="fc-${level}">${SECTION[level]} (${num(o.findings.filter((f) => f.level === level).length)})</h3><ol>${items
        .map((f) => `<li>${esc(f.text)}</li>`)
        .join('')}</ol>`;
    })
    .join('');
  const res = RESULT[o.result];
  const rows: [string, string][] = [
    ...o.head,
    ['الملف', `${num(o.pages)} صفحة — ${esc(o.files.map((f) => f.name).join('، ')).slice(0, 120)}`],
    ['طريقة القراءة', MODE_TEXT[o.mode]],
    ['المصدر', o.source === 'TELEGRAM' ? 'بوت تليجرام' : 'شاشة النظام'],
  ];
  const table = [];
  for (let i = 0; i < rows.length; i += 2)
    table.push(
      `<tr>${rows
        .slice(i, i + 2)
        .map(([k, v]) => `<th>${esc(k)}</th><td>${v}</td>`)
        .join('')}</tr>`,
    );
  const body = `<style>
.fc-head{width:100%;border-collapse:collapse;font-size:9.5pt;margin:1mm 0 2mm}
.fc-head th,.fc-head td{border:1px solid #bbb;padding:1mm 2mm;text-align:right}
.fc-head th{background:#f3f0f1;width:18%}
.fc-result{margin:2mm 0;padding:2mm 3mm;border-radius:2mm;font-weight:700;font-size:11pt;display:flex;justify-content:space-between}
.fc-result.ok{background:#e6f4ea;color:#14532d}.fc-result.warn{background:#fff4e0;color:#7a4b00}.fc-result.bad{background:#fde8e8;color:#8a1c1c}
h3{font-size:10pt;margin:2mm 0 1mm}.fc-ERROR{color:#8a1c1c}.fc-WARN{color:#7a4b00}.fc-NOTE{color:#444}
ol,ul{margin:0 6mm 0 0;padding:0;font-size:9.5pt;line-height:1.45}
.fc-check li{list-style:none}.fc-check li:before{content:'☐ '}
.fc-foot{font-size:8.5pt;color:#555;margin-top:2mm}
</style>
<h1 style="font-size:13pt;margin:1mm 0">${esc(o.title)}</h1>
<table class="fc-head">${table.join('')}</table>
<div class="fc-result ${res.cls}"><span>النتيجة: ${res.text}</span><span>أخطاء ${num(o.counts.errors)} — تنبيهات ${num(o.counts.warnings)} — ملاحظات ${num(o.counts.notes)}</span></div>
${sections || '<p>لم تُرصد أي ملاحظة على الملف.</p>'}
${hidden > 0 ? `<p class="fc-foot">و ${num(hidden)} بنداً آخر محفوظة في النظام.</p>` : ''}
${o.checklist.length ? `<h3>مراجعة يدوية قبل الإرسال</h3><ul class="fc-check">${o.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
<p class="fc-foot">${o.mode !== 'TEXT' ? 'القيم مستخرجة آلياً من الصور ثم قورنت بقواعد ثابتة مع بيانات النظام؛ راجع أي رقم مذكور هنا على الورقة الأصلية قبل التصحيح. ' : ''}فحص: ${esc(o.by)} — ${dateHtml(o.at)} ${num(o.at.toISOString().slice(11, 16))}${o.footer ? ` — ${o.footer}` : ''}</p>`;
  return printDocument({ title: o.title, ref: o.ref, body, date: o.at, compact: true, showRef: false });
}

export type FileCheckReport = Common & { x: Expected; supplier: string; total: string };

/** «تقرير فحص المعاملة قبل الإرسال» — one A4 page; whatever does not fit is counted and kept in the system. */
export function fileCheckReport(r: FileCheckReport) {
  return checkPage({
    ...r,
    title: 'تقرير فحص المعاملة قبل الإرسال',
    ref: r.x.caseNumber,
    head: [
      ['المدرسة', esc(r.x.school)],
      ['رقم المعاملة', num(r.x.caseNumber)],
      ['المورد', esc(r.supplier || '—')],
      ['رقم التكليف', num(r.x.order?.number || '—')],
      ['قيمة التكليف', `${num(r.total)} ر.ق`],
    ],
    footer: `قيمة الصافي المسجل: ${num(showAmount(r.x.certificates.at(-1)?.net ?? null))} ر.ق`,
  });
}

/** «تقرير فحص كشف تسوية العهدة» — the same page for an imprest settlement and its invoices. */
export function imprestCheckReport(r: Common & { school: string; imprest: string; number: number; total: string; invoices: number }) {
  return checkPage({
    ...r,
    title: 'تقرير فحص كشف تسوية العهدة قبل الإرسال',
    ref: `${r.imprest}-${r.number}`,
    head: [
      ['المدرسة', esc(r.school)],
      ['العهدة', esc(r.imprest)],
      ['رقم الكشف', num(r.number)],
      ['إجمالي الكشف', `${num(r.total)} ر.ق`],
      ['عدد الفواتير المسجلة', num(r.invoices)],
    ],
    footer: '',
  });
}

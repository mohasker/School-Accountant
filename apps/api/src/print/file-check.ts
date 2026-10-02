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

export type FileCheckReport = {
  x: Expected;
  findings: Finding[];
  checklist: string[];
  result: keyof typeof RESULT;
  counts: { errors: number; warnings: number; notes: number };
  mode: 'AI' | 'TEXT' | 'EXTERNAL';
  source: 'WEB' | 'TELEGRAM';
  files: { name: string; pages: number }[];
  pages: number;
  by: string;
  at: Date;
  supplier: string;
  total: string;
};

/** «تقرير فحص المعاملة قبل الإرسال» — one A4 page; whatever does not fit is counted and kept in the system. */
export function fileCheckReport(r: FileCheckReport) {
  const room = Math.max(4, MAX_LINES - r.checklist.length);
  const shown = r.findings.slice(0, room);
  const hidden = r.findings.length - shown.length;
  const sections = (['ERROR', 'WARN', 'NOTE'] as const)
    .map((level) => {
      const items = shown.filter((f) => f.level === level);
      if (!items.length) return '';
      return `<h3 class="fc-${level}">${SECTION[level]} (${num(r.findings.filter((f) => f.level === level).length)})</h3><ol>${items
        .map((f) => `<li>${esc(f.text)}</li>`)
        .join('')}</ol>`;
    })
    .join('');
  const res = RESULT[r.result];
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
<h1 style="font-size:13pt;margin:1mm 0">تقرير فحص المعاملة قبل الإرسال</h1>
<table class="fc-head">
<tr><th>المدرسة</th><td>${esc(r.x.school)}</td><th>رقم المعاملة</th><td>${num(r.x.caseNumber)}</td></tr>
<tr><th>المورد</th><td>${esc(r.supplier || '—')}</td><th>رقم التكليف</th><td>${num(r.x.order?.number || '—')}</td></tr>
<tr><th>قيمة التكليف</th><td>${num(r.total)} ر.ق</td><th>الملف</th><td>${num(r.pages)} صفحة — ${esc(r.files.map((f) => f.name).join('، ')).slice(0, 120)}</td></tr>
<tr><th>طريقة القراءة</th><td>${r.mode === 'AI' ? 'قراءة آلية لكل صفحة (صور و PDF)' : r.mode === 'EXTERNAL' ? 'قراءة Claude / ChatGPT خارج النظام (رد ملصق)' : 'نص ملفات PDF فقط (بدون قراءة آلية)'}</td><th>المصدر</th><td>${r.source === 'TELEGRAM' ? 'بوت تليجرام' : 'شاشة النظام'}</td></tr>
</table>
<div class="fc-result ${res.cls}"><span>النتيجة: ${res.text}</span><span>أخطاء ${num(r.counts.errors)} — تنبيهات ${num(r.counts.warnings)} — ملاحظات ${num(r.counts.notes)}</span></div>
${sections || '<p>لم تُرصد أي ملاحظة على الملف.</p>'}
${hidden > 0 ? `<p class="fc-foot">و ${num(hidden)} بنداً آخر محفوظة في النظام (صفحة المعاملة ← فحص الملف).</p>` : ''}
${r.checklist.length ? `<h3>مراجعة يدوية قبل الإرسال</h3><ul class="fc-check">${r.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
<p class="fc-foot">${r.mode !== 'TEXT' ? 'القيم مستخرجة آلياً من الصور ثم قورنت بقواعد ثابتة مع بيانات النظام؛ راجع أي رقم مذكور هنا على الورقة الأصلية قبل التصحيح. ' : ''}فحص: ${esc(r.by)} — ${dateHtml(r.at)} ${num(r.at.toISOString().slice(11, 16))} — قيمة الصافي المسجل: ${num(showAmount(r.x.certificates.at(-1)?.net ?? null))} ر.ق</p>`;
  return printDocument({ title: 'تقرير فحص المعاملة', ref: r.x.caseNumber, body, date: r.at, compact: true, showRef: false });
}

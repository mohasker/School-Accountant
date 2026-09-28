/**
 * Shared A4 letterhead for all printed documents. Documents are stored as HTML snapshots when
 * issued, so a later change to supplier or school data never rewrites an archived document.
 * The logo is referenced by URL (served by the web app at /brand/moehe-logo.png).
 */
export const LOGO_URL = '/brand/moehe-logo.png';

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** dd/mm/yyyy for printed documents. */
export function fmtDate(v: Date | string | null | undefined) {
  if (!v) return '—';
  const d = typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

const STYLE = `
@page{size:A4;margin:14mm 16mm 16mm}
*{box-sizing:border-box}
body{font-family:"Traditional Arabic","Simplified Arabic","Sakkal Majalla",Tahoma,Arial,sans-serif;font-size:17px;line-height:1.85;color:#111;margin:0 auto;max-width:190mm;padding:8px}
.letterhead{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #8a1538;padding-bottom:8px;margin-bottom:14px}
.letterhead img{height:74px;width:auto}
.letterhead .meta{font-size:14px;text-align:left;color:#333;line-height:1.6}
h1{font-size:21px;text-align:center;margin:10px 0 14px;color:#000;text-decoration:underline;text-underline-offset:6px}
.to{font-weight:bold;display:flex;justify-content:space-between}
.subject{font-weight:bold;margin:10px 0;text-decoration:underline;text-underline-offset:5px}
p{margin:6px 0;text-align:justify}
.indent{text-indent:28px}
.center{text-align:center}
.bold{font-weight:bold}
table{border-collapse:collapse;width:100%;margin:10px 0}
td,th{border:1px solid #444;padding:4px 8px;text-align:center;vertical-align:middle}
th{background:#ececec;font-weight:bold}
table.dense td,table.dense th{font-size:14px;line-height:1.5;padding:3px 5px}
td.r,th.r{text-align:right}
.grid td{text-align:right}
.grid td.n{width:34px;text-align:center;font-weight:bold}
.grid td.k{width:44%;background:#f7f7f7;font-weight:bold}
.words{font-weight:bold;margin:4px 0 10px}
ol,ul{margin:4px 22px;padding:0}
.signs{display:flex;justify-content:space-between;gap:24px;margin-top:34px}
.signs>div{flex:1;text-align:center;line-height:2.1}
.signs .role{font-weight:bold}
.stamp{margin-top:36px;text-align:center;font-weight:bold}
.checks{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px;margin:6px 10px;font-size:15px}
.checks span:before{content:"☐ ";font-size:17px}
.checks span.on:before{content:"☒ "}
.rating td{font-size:15px}
.muted{color:#555;font-size:13px}
.demo{border:2px dashed #b00;color:#b00;text-align:center;padding:4px;margin:8px 0;font-weight:bold}
.footer{margin-top:24px;border-top:1px solid #bbb;padding-top:4px;font-size:12px;color:#555;display:flex;justify-content:space-between}
.page-break{page-break-before:always}
@media print{body{padding:0}.no-print{display:none}}
`;

export function printDocument(opts: { title: string; ref: string; body: string; date?: Date | string | null }) {
  const demo = process.env.DEMO_MODE === 'true';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>${STYLE}</style></head><body>
<div class="letterhead"><img src="${LOGO_URL}" alt="وزارة التربية والتعليم والتعليم العالي"><div class="meta">${opts.date ? `التاريخ: ${fmtDate(opts.date)}<br>` : ''}المرجع: ${esc(opts.ref)}</div></div>
${demo ? '<div class="demo">نسخة تجريبية — بيانات اختبار</div>' : ''}
${opts.body}
<div class="footer"><span>${esc(opts.title)} — ${esc(opts.ref)}</span><span>أُعد إلكترونياً بتاريخ ${fmtDate(new Date())}</span></div>
</body></html>`;
}

export function signatures(items: { role: string; name?: string | null; extra?: string }[]) {
  return `<div class="signs">${items
    .map(
      (i) =>
        `<div><div class="role">${esc(i.role)}</div>${i.extra ? `<div>${esc(i.extra)}</div>` : ''}<div>${esc(i.name || '')}</div><div>التوقيع / ....................</div></div>`,
    )
    .join('')}</div>`;
}

export const GREETING = '<p class="bold">السلام عليكم ورحمة الله وبركاته،،،</p>';
export const CLOSING = '<p class="center bold">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>';
export const FINANCE = 'إدارة الشؤون المالية والإدارية';

/** Addressees offered on the completion certificate (matches the Excel template choices). */
export const ADDRESSEES = ['إدارة الشؤون المالية', 'إدارة الخدمات العامة', 'إدارة المشتريات والمناقصات'];

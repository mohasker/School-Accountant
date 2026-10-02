import { amount } from '../common/money';

/**
 * Shared A4 letterhead and typography for every printed document. Documents are stored as HTML
 * snapshots when issued, so a later change to supplier or school data never rewrites an archived
 * document. Logo and fonts are served by the web app (/brand, /fonts) and embedded by the PDF renderer.
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

/** Numbers, dates and references keep left-to-right order inside Arabic sentences (e.g. «2%», «RYD/2026-0901»). */
export const num = (v: unknown) => `<span class="num">${esc(v)}</span>`;
export const money = (v: unknown) => num(amount(v));

/** Arabic counted noun for working days: يوم عمل واحد، يومي عمل، 5 أيام عمل، 15 يوم عمل. */
export function workingDays(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  if (n === 1) return 'يوم عمل واحد';
  if (n === 2) return 'يومي عمل';
  return `${num(n)} ${n % 100 >= 3 && n % 100 <= 10 ? 'أيام' : 'يوم'} عمل`;
}
export const dateHtml = (v: Date | string | null | undefined) => num(fmtDate(v));

/**
 * Report typeface: Calibri for Latin letters and digits, Arial for Arabic (Calibri has no Arabic
 * letters). The installed fonts are used when present (Windows); otherwise, e.g. on the PDF server,
 * the bundled open equivalents: Carlito (metric-compatible with Calibri) and Noto Sans Arabic.
 */
const face = (local: string[], file: string, weight: number, range: string) =>
  `@font-face{font-family:"Report";src:${local.map((n) => `local("${n}")`).join(',')},url(/fonts/${file}-${weight}-normal.woff2) format("woff2");font-weight:${weight};font-display:block;unicode-range:${range}}`;
const ARABIC = 'U+0600-06FF,U+0750-077F,U+0870-08FF,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const FONTS = [
  face(['Calibri'], 'carlito-latin', 400, LATIN),
  face(['Calibri Bold', 'Calibri-Bold'], 'carlito-latin', 700, LATIN),
  face(['Arial', 'ArialMT'], 'noto-sans-arabic-arabic', 400, ARABIC),
  face(['Arial Bold', 'Arial-BoldMT'], 'noto-sans-arabic-arabic', 700, ARABIC),
].join('');

const STYLE = `${FONTS}
@page{size:A4;margin:12mm 14mm 15mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Report,Calibri,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#1a1a1a;margin:0 auto;max-width:180mm;padding:0}
.letterhead{display:grid;grid-template-columns:1fr auto;align-items:end;gap:10mm;padding-bottom:3mm;border-bottom:1.6pt solid #8a1538;margin-bottom:1mm}
.letterhead img{height:21mm;width:auto}
.rule{border-top:.5pt solid #b98a98;margin-bottom:4mm}
.meta{border-collapse:collapse;width:auto;margin:0;font-size:10pt;line-height:1.5}
.meta th,.meta td{border:.6pt solid #9a9a9a;padding:1.2mm 3mm;text-align:right;background:none;color:#1a1a1a}
.meta th{background:#f6eef1;font-weight:700;color:#5c0f27}
h1{font-size:15pt;font-weight:700;text-align:center;margin:2mm auto 4mm;color:#1a1a1a;width:fit-content;padding:0 6mm 1.5mm;border-bottom:1.6pt solid #8a1538}
h2{font-size:12pt;font-weight:700;margin:5mm 0 2mm;color:#5c0f27}
.to{font-weight:700;display:flex;justify-content:space-between;margin-bottom:2mm}
.subject{font-weight:700;font-size:11.5pt;margin:3mm 0;padding:1.5mm 4mm;background:#f6eef1;border-right:3pt solid #8a1538}
p{margin:1.2mm 0;text-align:justify}
.indent{text-indent:8mm}
.center{text-align:center}
.bold{font-weight:700}
.num{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums lining-nums}
table{border-collapse:collapse;width:100%;margin:3mm 0;font-size:11pt;line-height:1.5}
thead{display:table-header-group}
tr{break-inside:avoid;page-break-inside:avoid}
td,th{border:.6pt solid #7a7a7a;padding:1.6mm 2.2mm;text-align:center;vertical-align:middle}
th{background:#f3e7eb;color:#4d0c20;font-weight:700;font-size:10pt}
tbody tr:nth-child(even) td{background:#fbf9fa}
td.r,th.r{text-align:right}
tr.total td{font-weight:700;background:#f3e7eb!important;border-top:1.2pt solid #4d0c20}
table.dense{font-size:9.5pt}
table.dense td,table.dense th{padding:1.2mm 1.5mm}
.grid td{text-align:right}
.grid td.n{width:9mm;text-align:center;font-weight:700;background:#f3e7eb;color:#4d0c20}
.grid td.k{width:42%;background:#faf6f7;font-weight:700}
.words{font-weight:700;margin:1mm 0 3mm;padding:2mm 3mm;border:.6pt dashed #8a1538;border-radius:1.5mm;background:#fffdfd}
ol,ul{margin:1mm 7mm;padding:0}
li{margin:.8mm 0}
.signs{display:flex;justify-content:space-around;align-items:stretch;gap:10mm;margin-top:6mm;break-inside:avoid;page-break-inside:avoid}
.signs>div{flex:1;max-width:75mm;text-align:center;line-height:1.7;display:flex;flex-direction:column}
.signs .role{font-weight:700;font-size:11pt}
.signs.single{justify-content:flex-end}
.signs.single>div{flex:0 0 75mm}
.signs .line{margin-top:auto;padding-top:10mm}
.signs .line span{display:block;border-top:.6pt solid #1a1a1a;padding-top:1mm;font-size:9.5pt;color:#555}
.checks{display:grid;grid-template-columns:1fr 1fr;gap:.5mm 8mm;margin:2mm 3mm;font-size:10.5pt}
.checks span:before{content:"☐";margin-left:2mm;font-size:12pt}
.checks span.on:before{content:"☒";color:#4d0c20}
.rating td{font-size:10.5pt}
.muted{color:#555;font-size:9.5pt}
.keep{break-inside:avoid;page-break-inside:avoid}
.watermark{position:fixed;top:45%;left:0;right:0;text-align:center;transform:rotate(-30deg);font-size:40pt;color:rgba(160,0,0,.08);pointer-events:none;z-index:0}
.doc-end{margin-top:6mm;border-top:.5pt solid #bbb;padding-top:1mm;font-size:8.5pt;color:#777;display:flex;justify-content:space-between}
@media screen{body{padding:10mm;background:#fff}}
/* One-page forms (completion certificate): tighter rhythm so the whole form fits a single A4 page. */
body.compact{font-size:10.5pt;line-height:1.4}
.compact .letterhead img{height:18mm}
.compact h1{margin:0 auto 2.5mm;font-size:14pt}
.compact p{margin:.8mm 0}
.compact table{margin:1.5mm 0;font-size:10pt;line-height:1.3}
.compact .signs>div{max-width:88mm;line-height:1.5}
.compact .grid td{padding:1mm 2mm}
.compact .grid .words{margin:1mm 0 0;padding:.8mm 2mm}
.compact h2,.compact .section{margin:2mm 0 1mm}
.compact .checks{font-size:9.5pt;gap:0 8mm}
.compact .signs{margin-top:3mm}
.compact .signs .line{padding-top:5mm}
.compact .signs .role{font-size:10pt}
.compact .letterhead{padding-bottom:2mm}
.compact .rule{margin-bottom:2.5mm}
.compact .rating td{padding:.8mm 2mm}
.compact .doc-end{margin-top:3mm}
/* Completion certificate (approved «Injaz» form): same rows and wording, tighter and clearer formatting. */
.cert td{padding:1.1mm 2.4mm}
.cert td.k{width:40%;font-size:9.8pt;color:#2a0a14}
.cert tr:nth-child(9) td{background:#fbf3f6}
.cert tr:nth-child(9) td b{font-size:11.5pt;color:#5c0f27}
.rating td.picked{background:#f3e7eb!important;font-weight:700;color:#4d0c20}
.rating td.r{width:42%;background:#faf6f7}
.compact .checks span{line-height:1.45}
.cert-small{font-size:8.8pt!important;margin:.6mm 0!important}
.cert-small td{padding:.5mm 1.6mm!important;font-size:8.8pt!important;line-height:1.25}
.cert-small.checks{grid-template-columns:1fr 1fr;gap:0 6mm;margin:.5mm 2mm!important}
.cert-small.checks span{line-height:1.3}
.cert-small.checks span:before{font-size:9.5pt;margin-left:1.2mm}
p.cert-head{font-size:9.5pt;margin:1.2mm 0 .4mm!important}
`;

export function printDocument(opts: {
  title: string;
  ref: string;
  body: string;
  date?: Date | string | null;
  compact?: boolean;
  /** false: the reference stays in the system (footer line) and is not printed in the letterhead box. */
  showRef?: boolean;
}) {
  const demo = process.env.DEMO_MODE === 'true';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(opts.title)} — ${esc(opts.ref)}</title><style>${STYLE}</style></head><body${opts.compact ? ' class="compact"' : ''}>
<header class="letterhead"><img src="${LOGO_URL}" alt="وزارة التربية والتعليم والتعليم العالي"><table class="meta"><tr><th>التاريخ</th><td>${dateHtml(opts.date ?? new Date())}</td></tr>${opts.showRef === false ? '' : `<tr><th>المرجع</th><td>${num(opts.ref)}</td></tr>`}</table></header>
<div class="rule"></div>
${demo ? '<div class="watermark">نسخة تجريبية — بيانات اختبار</div>' : ''}
${opts.body}
<div class="doc-end"><span>${esc(opts.title)}${opts.showRef === false ? '' : ` — ${num(opts.ref)}`}</span><span>أُعد إلكترونياً بتاريخ ${dateHtml(new Date())}</span></div>
</body></html>`;
}

export function signatures(items: { role: string; name?: string | null; extra?: string }[]) {
  return `<div class="signs${items.length === 1 ? ' single' : ''}">${items
    .map(
      (i) =>
        `<div><div class="role">${esc(i.role)}</div>${i.extra ? `<div>${esc(i.extra)}</div>` : ''}<div>${esc(i.name || '')}</div><div class="line"><span>التوقيع</span></div></div>`,
    )
    .join('')}</div>`;
}

export const GREETING = '<p class="bold">السلام عليكم ورحمة الله وبركاته،،،</p>';
export const CLOSING = '<p class="center bold" style="margin-top:3mm">وتفضلوا بقبول فائق الاحترام والتقدير،،،</p>';
export const FINANCE = 'إدارة الشؤون المالية والإدارية';

/** Addressees offered on the completion certificate (matches the Excel template choices). */
export const ADDRESSEES = ['إدارة الشؤون المالية', 'إدارة الخدمات العامة', 'إدارة المشتريات والمناقصات'];

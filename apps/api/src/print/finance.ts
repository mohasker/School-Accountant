import { esc, fmtDate, money, num, printDocument, signatures } from './layout';

/**
 * Comprehensive financial report (financial-analyst view) for one school, fiscal year and period:
 * key figures, budget position by group and line, procurement activity, monthly trend,
 * suppliers and imprests — figures and charts only, computed from the records (no written commentary) — with SVG charts drawn in the document so
 * they print and export to PDF exactly as shown.
 */

export type Group = { key: string; name: string; approved: number; spent: number; committed: number };
export type Line = Group & { code: string; group: string };
export type FinanceData = {
  school: string;
  principal: string;
  year: string;
  from: string;
  to: string;
  preparedBy: string;
  elapsed: number;
  groups: Group[];
  lines: Line[];
  docs: {
    reports: number;
    reportsValue: number;
    orders: number;
    ordersValue: number;
    certificates: number;
    certificatesNet: number;
    fines: number;
    covers: number;
    avgQuotes: number;
    savings: number;
    avgLead: number | null;
    onTime: number | null;
    incomplete: number;
    incompleteValue: number;
    late: number;
  };
  monthly: { month: string; orders: number; certificates: number; imprests: number }[];
  suppliers: { name: string; value: number; count: number }[];
  imprests: { name: string; type: string; amount: number; spent: number; settled: number; balance: number; closed: boolean }[];
};

/** Series colours, in fixed order (validated for colour-vision deficiency on white): spent, commitments, approved. */
const C = {
  spent: '#b8325a',
  committed: '#2a78d6',
  approved: '#1baf7a',
  track: '#e6eaee',
  ink: '#1b2e3a',
  muted: '#66727c',
  grid: '#e4e7ea',
};
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthName = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1] ?? m;
const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('en-US')}%`;
const short = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : n0(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

function scale(max: number) {
  if (max <= 0) return { top: 1, ticks: [0] };
  const raw = max / 4,
    mag = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) };
}

const legend = (items: { label: string; color: string; line?: boolean }[]) =>
  `<div class="fr-legend">${items
    .map((i) => `<span><i style="background:${i.color}${i.line ? ';height:2px;border-radius:0' : ''}"></i>${esc(i.label)}</span>`)
    .join('')}</div>`;

/** Status of a budget line from its utilisation against the share of the year already elapsed. */
export function lineStatus(used: number, elapsed: number) {
  if (used >= 0.9) return { cls: 'crit', icon: '✖', label: 'حرج — قارب النفاد' };
  if (used > elapsed + 0.15) return { cls: 'warn', icon: '▲', label: 'صرف متسارع' };
  if (elapsed >= 0.3 && used < elapsed - 0.35) return { cls: 'slow', icon: '●', label: 'صرف بطيء' };
  return { cls: 'good', icon: '✔', label: 'ضمن المسار' };
}

/** Horizontal grouped bars growing right-to-left from the label column (approved, spent, commitments). */
function groupBars(groups: Group[]) {
  const W = 680,
    labelW = 150,
    row = 58,
    top = 8,
    H = top + groups.length * row + 22,
    plotW = W - labelW - 70;
  const max = Math.max(1, ...groups.map((g) => Math.max(g.approved, g.spent + g.committed)));
  const { top: axisTop, ticks } = scale(max);
  const x0 = W - labelW - 8;
  const w = (v: number) => (v / axisTop) * plotW;
  const bars = [
    { key: 'approved' as const, color: C.approved },
    { key: 'spent' as const, color: C.spent },
    { key: 'committed' as const, color: C.committed },
  ];
  return `<svg class="fr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="المعتمد والمصروف والارتباطات حسب المجموعات">
${ticks.map((t) => `<line x1="${x0 - w(t)}" x2="${x0 - w(t)}" y1="${top}" y2="${H - 20}" stroke="${C.grid}"/><text x="${x0 - w(t)}" y="${H - 6}" class="t" text-anchor="middle">${short(t)}</text>`).join('')}
${groups
  .map((g, i) => {
    const y = top + i * row + 6;
    return `<text x="${W - 4}" y="${y + 24}" class="l" text-anchor="end">${esc(g.name)}</text>
${bars
  .map((b, j) => {
    const v = g[b.key],
      len = Math.max(v > 0 ? 2 : 0, w(v)),
      by = y + j * 15;
    return `<rect x="${x0 - len}" y="${by}" width="${len}" height="12" rx="2" fill="${b.color}"/>${v > 0 ? `<text x="${x0 - len - 4}" y="${by + 10}" class="v" text-anchor="end">${n0(v)}</text>` : ''}`;
  })
  .join('')}`;
  })
  .join('')}
<line x1="${x0}" x2="${x0}" y1="${top}" y2="${H - 20}" stroke="${C.ink}" stroke-width="1"/>
</svg>`;
}

/** Share of actual spending by group — one hue, bars sorted by size, value and percentage labelled. */
function shareBars(groups: Group[]) {
  const total = groups.reduce((v, g) => v + g.spent, 0);
  const rows = [...groups].sort((a, b) => b.spent - a.spent);
  const W = 680,
    labelW = 150,
    row = 30,
    H = rows.length * row + 6,
    plotW = W - labelW - 150,
    x0 = W - labelW - 8;
  return `<svg class="fr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="توزيع الإنفاق الفعلي">
${rows
  .map((g, i) => {
    const s = ratio(g.spent, total),
      y = i * row + 6,
      len = Math.max(s > 0 ? 2 : 0, s * plotW);
    return `<text x="${W - 4}" y="${y + 13}" class="l" text-anchor="end">${esc(g.name)}</text>
<rect x="${x0 - plotW}" y="${y + 2}" width="${plotW}" height="14" rx="3" fill="${C.track}"/>
<rect x="${x0 - len}" y="${y + 2}" width="${len}" height="14" rx="3" fill="${C.spent}"/>
<text x="${x0 - plotW - 6}" y="${y + 13}" class="v" text-anchor="end">${pct(s)} · ${n0(g.spent)}</text>`;
  })
  .join('')}
</svg>`;
}

/** Monthly grouped columns (one unit: QAR) — assignments, certificates (net), imprest spending. */
function monthlyBars(rows: FinanceData['monthly']) {
  const series = [
    { key: 'orders' as const, color: C.spent },
    { key: 'certificates' as const, color: C.committed },
    { key: 'imprests' as const, color: C.approved },
  ];
  const W = 680,
    H = 220,
    left = 46,
    bottom = 26,
    plotH = H - bottom - 10;
  const max = Math.max(0, ...rows.flatMap((r) => series.map((s) => r[s.key])));
  const { top, ticks } = scale(max);
  const gw = (W - left - 6) / Math.max(rows.length, 1),
    bw = Math.max(4, Math.min(16, (gw - 10) / 3 - 2));
  const y = (v: number) => 10 + plotH - (v / top) * plotH;
  return `<svg class="fr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="القيم الشهرية">
${ticks.map((t) => `<line x1="${left}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}"/><text x="${left - 6}" y="${y(t) + 4}" class="t" text-anchor="end">${short(t)}</text>`).join('')}
${rows
  .map((r, gi) => {
    const gx = left + gi * gw,
      inner = 3 * (bw + 2) - 2;
    return (
      series
        .map((s, si) => {
          const v = r[s.key];
          if (v <= 0) return '';
          const x = gx + (gw - inner) / 2 + si * (bw + 2),
            h = Math.max(1.5, (v / top) * plotH);
          return `<rect x="${x}" y="${y(0) - h}" width="${bw}" height="${h}" rx="2" fill="${s.color}"/>`;
        })
        .join('') + `<text x="${gx + gw / 2}" y="${H - 8}" class="t" text-anchor="middle">${monthName(r.month)}</text>`
    );
  })
  .join('')}
<line x1="${left}" x2="${W - 4}" y1="${y(0)}" y2="${y(0)}" stroke="${C.ink}"/>
</svg>`;
}

/** Cumulative actual spending against the straight-line pace of the approved budget. */
function cumulativeLine(rows: FinanceData['monthly'], approved: number, elapsedMonths: number) {
  const W = 680,
    H = 220,
    left = 46,
    bottom = 26,
    right = 70,
    plotH = H - bottom - 10;
  let run = 0;
  const cum = rows.map((r) => (run += r.certificates + r.imprests));
  const pace = rows.map((_, i) => (approved * (i + 1)) / Math.max(rows.length, 1));
  const { top, ticks } = scale(Math.max(1, ...cum, ...pace));
  const step = (W - left - right) / Math.max(rows.length - 1, 1);
  const x = (i: number) => left + i * step,
    y = (v: number) => 10 + plotH - (v / top) * plotH;
  const shown = Math.min(rows.length, Math.max(1, elapsedMonths));
  const path = (vals: number[], n = vals.length) =>
    vals
      .slice(0, n)
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
  const last = shown - 1;
  return `<svg class="fr-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="الصرف التراكمي مقابل المسار المستهدف">
${ticks.map((t) => `<line x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}"/><text x="${left - 6}" y="${y(t) + 4}" class="t" text-anchor="end">${short(t)}</text>`).join('')}
${rows.map((r, i) => `<text x="${x(i)}" y="${H - 8}" class="t" text-anchor="middle">${monthName(r.month)}</text>`).join('')}
<path d="${path(pace)}" fill="none" stroke="${C.muted}" stroke-width="2" stroke-dasharray="5 4"/>
<path d="${path(cum, shown)}" fill="none" stroke="${C.spent}" stroke-width="2.4"/>
${cum
  .slice(0, shown)
  .map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.4" fill="${C.spent}" stroke="#fff" stroke-width="1.5"/>`)
  .join('')}
<text x="${x(last) + 6}" y="${y(cum[last] ?? 0) + 4}" class="v">${n0(cum[last] ?? 0)}</text>
<text x="${x(rows.length - 1) + 6}" y="${y(pace[rows.length - 1] ?? 0) + 4}" class="t">${n0(approved)}</text>
<line x1="${left}" x2="${W - right}" y1="${y(0)}" y2="${y(0)}" stroke="${C.ink}"/>
</svg>`;
}

/** Budget execution gauge: spent then commitments on one arc, with a tick at the elapsed share of the year. */
function gauge(spent: number, committed: number, approved: number, elapsed: number) {
  const p1 = Math.min(1, ratio(spent, approved)),
    p2 = Math.min(1 - p1, ratio(committed, approved));
  const L = Math.PI * 70;
  const arc = 'M20,92 A70,70 0 0 1 160,92';
  const a = Math.PI * elapsed;
  return `<svg class="fr-gauge" viewBox="0 0 180 104" role="img" aria-label="نسبة الصرف ${pct(p1)}">
<path d="${arc}" fill="none" stroke="${C.track}" stroke-width="13" stroke-linecap="round"/>
${p2 > 0 ? `<path d="${arc}" fill="none" stroke="${C.committed}" stroke-width="13" pathLength="${L}" stroke-dasharray="0 ${p1 * L} ${p2 * L} ${L}"/>` : ''}
${p1 > 0 ? `<path d="${arc}" fill="none" stroke="${C.spent}" stroke-width="13" pathLength="${L}" stroke-dasharray="${p1 * L} ${L}"/>` : ''}
<line x1="${90 - 62 * Math.cos(a)}" y1="${92 - 62 * Math.sin(a)}" x2="${90 - 82 * Math.cos(a)}" y2="${92 - 82 * Math.sin(a)}" stroke="${C.ink}" stroke-width="2"/>
<text x="90" y="80" text-anchor="middle" class="g">${pct(p1)}</text>
<text x="90" y="100" text-anchor="middle" class="t">نسبة الصرف من المعتمد</text>
</svg>`;
}

const kpi = (label: string, value: string, hint = '') =>
  `<div class="kpi"><span>${esc(label)}</span><b>${value}</b>${hint ? `<small>${hint}</small>` : ''}</div>`;

export function financeReport(d: FinanceData) {
  const approved = d.groups.reduce((v, g) => v + g.approved, 0),
    spent = d.groups.reduce((v, g) => v + g.spent, 0),
    committed = d.groups.reduce((v, g) => v + g.committed, 0),
    available = approved - spent - committed;
  const elapsedMonths = d.monthly.findIndex((m) => m.month > new Date().toISOString().slice(0, 7));
  const status = (g: Group) => {
    const st = lineStatus(ratio(g.spent + g.committed, g.approved), d.elapsed);
    return `<span class="st ${st.cls}">${st.icon} ${st.label}</span>`;
  };
  const meter = (g: Group) => {
    const a = Math.min(100, 100 * ratio(g.spent, g.approved)),
      b = Math.min(100 - a, 100 * ratio(g.committed, g.approved));
    return `<div class="meter"><i style="width:${a}%;background:${C.spent}"></i><i style="width:${b}%;background:${C.committed}"></i></div>`;
  };
  const groupRows = d.groups
    .map(
      (g) =>
        `<tr><td class="r">${esc(g.name)}</td><td>${money(g.approved)}</td><td>${money(g.spent)}</td><td>${money(g.committed)}</td><td>${money(g.approved - g.spent - g.committed)}</td><td>${num(pct(ratio(g.spent, g.approved)))}</td><td>${status(g)}</td></tr>`,
    )
    .join('');
  const lineRows = d.groups
    .map((g) => {
      const lines = d.lines.filter((l) => l.group === g.key);
      if (!lines.length) return '';
      return `<tr class="grp"><td colspan="7" class="r">${esc(g.name)}</td></tr>${lines
        .map(
          (l) =>
            `<tr><td class="num">${esc(l.code)}</td><td class="r">${esc(l.name)}</td><td>${money(l.approved)}</td><td>${money(l.spent)}</td><td>${money(l.approved - l.spent - l.committed)}</td><td>${meter(l)}<small>${num(pct(ratio(l.spent, l.approved)))}</small></td><td>${status(l)}</td></tr>`,
        )
        .join('')}`;
    })
    .join('');
  const supTotal = d.suppliers.reduce((v, s) => v + s.value, 0);
  const body = `<h1>التقرير المالي الشامل</h1>
<p class="center fr-sub">${esc(d.school)} · مدير المدرسة: ${esc(d.principal)} · العام المالي ${num(d.year)} · الفترة من ${num(fmtDate(d.from))} إلى ${num(fmtDate(d.to))}</p>

<h2>أولاً: المؤشرات الرئيسية</h2>
<div class="fr-top">
  <div class="fr-kpis">
    ${kpi('الموازنة المعتمدة', money(approved), 'ر.ق')}
    ${kpi('المنصرف الفعلي', money(spent), num(pct(ratio(spent, approved))) + ' من المعتمد')}
    ${kpi('الارتباطات القائمة', money(committed), 'تكليفات لم تُنجز')}
    ${kpi('الرصيد المتاح', money(available), num(pct(ratio(available, approved))) + ' من المعتمد')}
    ${kpi('المنقضي من العام', num(pct(d.elapsed)), 'حتى تاريخ التقرير')}
    ${kpi('معاملات غير مكتملة', num(d.docs.incomplete), money(d.docs.incompleteValue) + ' ر.ق')}
  </div>
  <div class="fr-gauge-box">${gauge(spent, committed, approved, d.elapsed)}${legend([
    { label: 'المصروف', color: C.spent },
    { label: 'الارتباطات', color: C.committed },
    { label: 'المنقضي من العام', color: C.ink, line: true },
  ])}</div>
</div>

<h2>ثانياً: الموقف المالي حسب مجموعات الموازنة</h2>
<table class="fr-table"><thead><tr><th class="r">المجموعة</th><th>المعتمد</th><th>المنصرف الفعلي</th><th>الارتباطات</th><th>الرصيد</th><th>نسبة الصرف</th><th>الحالة</th></tr></thead>
<tbody>${groupRows}<tr class="total"><td class="r">الإجمالي</td><td>${money(approved)}</td><td>${money(spent)}</td><td>${money(committed)}</td><td>${money(available)}</td><td>${num(pct(ratio(spent, approved)))}</td><td></td></tr></tbody></table>
<div class="fr-figure keep"><h3>شكل (1): مقارنة المعتمد بالمنصرف والارتباطات (ر.ق)</h3>${legend([
    { label: 'المعتمد', color: C.approved },
    { label: 'المنصرف', color: C.spent },
    { label: 'الارتباطات', color: C.committed },
  ])}${groupBars(d.groups)}</div>
<div class="fr-figure keep"><h3>شكل (2): توزيع الإنفاق الفعلي على المجموعات</h3>${shareBars(d.groups)}</div>

<h2>ثالثاً: تفصيل بنود الموازنة</h2>
<table class="fr-table dense"><thead><tr><th>الرمز</th><th class="r">البند</th><th>المعتمد</th><th>المنصرف</th><th>الرصيد</th><th>نسبة الاستخدام</th><th>الحالة</th></tr></thead><tbody>${lineRows}</tbody></table>
<p class="muted">نسبة الاستخدام: المنصرف (أحمر) والارتباطات (أزرق) من المعتمد. الحالة تقارن الاستخدام بنسبة المنقضي من العام: ✔ ضمن المسار · ▲ صرف متسارع · ● صرف بطيء · ✖ حرج (90% فأكثر).</p>

<h2>رابعاً: نشاط المشتريات خلال الفترة</h2>
<div class="fr-kpis six">
  ${kpi('تقارير عروض الأسعار', num(d.docs.reports), money(d.docs.reportsValue) + ' ر.ق')}
  ${kpi('التكليفات (أوامر الشراء)', num(d.docs.orders), money(d.docs.ordersValue) + ' ر.ق')}
  ${kpi('شهادات الإنجاز', num(d.docs.certificates), 'صافي ' + money(d.docs.certificatesNet) + ' ر.ق')}
  ${kpi('كتب التغطية', num(d.docs.covers), 'تصدر مع الشهادة')}
  ${kpi('غرامات التأخير', money(d.docs.fines), 'ر.ق')}
  ${kpi('متوسط عدد العروض', num(d.docs.avgQuotes.toFixed(1)), 'لكل تقرير')}
  ${kpi('وفر المنافسة التقديري', money(d.docs.savings), 'متوسط العروض − العرض المكلف')}
  ${kpi('متوسط مدة الإنجاز', d.docs.avgLead === null ? '—' : num(Math.round(d.docs.avgLead)) + ' يوم', 'من التكليف إلى الشهادة')}
  ${kpi('الإنجاز في الموعد', d.docs.onTime === null ? '—' : num(pct(d.docs.onTime)), `تكليفات متأخرة قائمة: ${num(d.docs.late)}`)}
</div>
<div class="fr-figure keep"><h3>شكل (3): القيم الشهرية (ر.ق)</h3>${legend([
    { label: 'التكليفات', color: C.spent },
    { label: 'شهادات الإنجاز (صافي)', color: C.committed },
    { label: 'مصروفات العهد', color: C.approved },
  ])}${monthlyBars(d.monthly)}</div>
<div class="fr-figure keep"><h3>شكل (4): الصرف التراكمي مقابل المسار المستهدف للموازنة (ر.ق)</h3>${legend([
    { label: 'الصرف التراكمي الفعلي (شهادات + فواتير العهد)', color: C.spent },
    { label: 'المسار المستهدف (توزيع خطي للمعتمد)', color: C.muted, line: true },
  ])}${cumulativeLine(d.monthly, approved, elapsedMonths < 0 ? d.monthly.length : elapsedMonths)}</div>

<h2>خامساً: الموردون وتركّز التعامل</h2>
${
  d.suppliers.length
    ? `<table class="fr-table"><thead><tr><th>م</th><th class="r">المورد</th><th>عدد التكليفات</th><th>القيمة</th><th>الحصة</th></tr></thead><tbody>${d.suppliers
        .slice(0, 10)
        .map(
          (s, i) =>
            `<tr><td>${num(i + 1)}</td><td class="r">${esc(s.name)}</td><td>${num(s.count)}</td><td>${money(s.value)}</td><td><div class="meter one"><i style="width:${100 * ratio(s.value, supTotal)}%;background:${C.spent}"></i></div><small>${num(pct(ratio(s.value, supTotal)))}</small></td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>لا توجد تكليفات خلال الفترة.</p>'
}

<h2>سادساً: العهد</h2>
${
  d.imprests.length
    ? `<table class="fr-table"><thead><tr><th class="r">العهدة</th><th>النوع</th><th>القيمة</th><th>المنصرف</th><th>المسوّى</th><th>الرصيد النقدي</th><th>الحالة</th></tr></thead><tbody>${d.imprests
        .map(
          (i) =>
            `<tr><td class="r">${esc(i.name)}</td><td>${esc(i.type)}</td><td>${money(i.amount)}</td><td>${money(i.spent)}</td><td>${money(i.settled)}</td><td>${money(i.balance)}</td><td>${i.closed ? 'مغلقة' : 'مفتوحة'}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>لا توجد عهد في هذا العام.</p>'
}

<p class="muted">أساس الأرقام: أرصدة البنود كما في تاريخ إعداد التقرير؛ المستندات والقيم الشهرية حسب تواريخ إصدارها خلال الفترة المختارة.</p>
${signatures([
  { role: 'المحاسب', name: d.preparedBy },
  { role: 'مدير المدرسة', name: d.principal },
])}
<style>
.fr-sub{font-size:10pt;color:#444}
h3{font-size:10.5pt;margin:0 0 1.5mm;color:#1b2e3a}
.fr-top{display:grid;grid-template-columns:1fr 62mm;gap:4mm;align-items:center}
.fr-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm}
.fr-kpis.six{grid-template-columns:repeat(3,1fr);margin-bottom:3mm}
.kpi{border:.6pt solid #d9c4cb;border-radius:2mm;padding:1.6mm 2.4mm;background:#fdfafb;break-inside:avoid}
.kpi>span{display:block;font-size:8.8pt;color:#5c0f27;font-weight:700}
.kpi b{display:block;font-size:12.5pt;line-height:1.3}
.kpi>small{display:block;font-size:8pt;color:#66727c}
.fr-gauge-box{text-align:center}
.fr-gauge{width:60mm;height:auto}
.fr-chart{width:100%;height:auto;direction:ltr;display:block}
svg text{font-family:Report,Calibri,Arial,sans-serif}
svg .t{font-size:10.5px;fill:#66727c}
svg .l{font-size:12.5px;fill:#1b2e3a;font-weight:700}
svg .v{font-size:11px;fill:#1b2e3a}
svg .g{font-size:24px;font-weight:700;fill:#1b2e3a}
.fr-legend{display:flex;gap:5mm;justify-content:center;flex-wrap:wrap;font-size:8.8pt;color:#333;margin:1mm 0}
.fr-legend i{display:inline-block;width:3mm;height:3mm;border-radius:.6mm;margin-left:1.2mm;vertical-align:middle}
.fr-figure{border:.6pt solid #e2d5da;border-radius:2mm;padding:2.5mm 3mm;margin:3mm 0}
.fr-table{font-size:9.8pt}
.fr-table td,.fr-table th{padding:1.2mm 1.8mm}
.fr-table tr.grp td{background:#f3e7eb!important;font-weight:700;color:#4d0c20}
.fr-table small{font-size:8pt;color:#444}
.meter{display:flex;height:2.2mm;background:#e6eaee;border-radius:1mm;overflow:hidden;min-width:18mm;margin-bottom:.6mm;direction:rtl}
.meter i{display:block;height:100%}
.st{font-size:8.6pt;font-weight:700;white-space:nowrap}
.st.good{color:#1b6b52}.st.warn{color:#9a5b00}.st.slow{color:#2a5d8a}.st.crit{color:#a3182f}
</style>`;
  return printDocument({ title: 'التقرير المالي الشامل', ref: 'FIN-' + d.year, body, date: new Date() });
}

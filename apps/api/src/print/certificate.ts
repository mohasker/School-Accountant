import { EVIDENCE, COVER_ATTACHMENTS, PRE_CERTIFICATE } from '../core/documents';
import { tafqeet } from '../core/tafqeet';
import { ADDRESSEES, CLOSING, GREETING, dateHtml, esc, money, printDocument, signatures, num, workingDays } from './layout';

export const RATINGS = { EXCELLENT: 'ممتاز', AVERAGE: 'متوسط', POOR: 'رديء' } as const;
export type Rating = keyof typeof RATINGS;

export type CertificateData = {
  number: string;
  kind: 'PARTIAL' | 'FINAL';
  date: string;
  addressee: number;
  school: string;
  principal: string;
  accountant: string;
  supplier: string;
  subject: string;
  orderNumber: string;
  orderDate: string;
  orderValue: string;
  invoice: string;
  deliveryDate: string;
  gross: string;
  hasFine: boolean;
  deliveryDays: number | null;
  lateDays: number;
  fine: string;
  finePct: string;
  net: string;
  priorFine: string;
  cumulativeFine: string;
  notes: string;
  ratings: { scope: Rating; time: Rating; supervision: Rating };
  attachments: number[];
};

/** شهادة إنجاز أعمال — template «Injaz», laid out in sections: file data, financial summary, rating, attachments. */
export function certificateDocument(d: CertificateData) {
  const cell = (label: string, value: string) => `<th>${esc(label)}</th><td>${value}</td>`;
  const late = d.hasFine ? workingDays(d.lateDays) : 'لا يوجد';
  const attachments = PRE_CERTIFICATE.map(
    (code) => `<span class="${d.attachments.includes(code) ? 'on' : ''}">${esc(EVIDENCE[code].print)}</span>`,
  ).join('');
  const rating = (label: string, value: Rating) =>
    `<tr><th>${esc(label)}</th>${(Object.keys(RATINGS) as Rating[])
      .map((k) => `<td class="${k === value ? 'picked' : ''}">${k === value ? '☒' : '☐'} ${RATINGS[k]}</td>`)
      .join('')}</tr>`;
  const body = `
<div class="to"><span>السادة / ${esc(ADDRESSEES[d.addressee - 1] ?? ADDRESSEES[0])}</span><span>المحترمين</span></div>
<div class="cert-title"><span>شهادة إنجاز أعمال${d.kind === 'PARTIAL' ? ' (جزئية)' : ''}</span><small>رقم ${num(d.number)}</small></div>
<p>تتقدم إليكم مدرسة <b>${esc(d.school)}</b> بأخلص التحيات، وتشهد بقيام شركة / <b>${esc(d.supplier)}</b> بتوريد الأصناف / تنفيذ الأعمال المنصوص عليها في أمر التوريد / كتاب التكليف الخاص بـ (<b>${esc(d.subject)}</b>) حسب البيانات التالية:</p>
<div class="cert-section">بيانات التكليف والتوريد</div>
<table class="cert-info">
<tr>${cell('رقم أمر التوريد / كتاب التكليف', esc(d.orderNumber))}${cell('رقم الفاتورة', esc(d.invoice))}</tr>
<tr>${cell('تاريخ أمر التوريد', dateHtml(d.orderDate))}${cell('تاريخ التوريد الفعلي', dateHtml(d.deliveryDate))}</tr>
<tr>${cell('مدة التوريد', d.deliveryDays ? workingDays(d.deliveryDays) : '—')}${cell('أيام التأخير', late)}</tr>
</table>
<div class="cert-section">الملخص المالي</div>
<div class="cert-money">
<div><span>قيمة التكليف الإجمالية</span><b>${money(d.orderValue)}</b></div>
<div><span>قيمة ما تم توريده فعلياً</span><b>${money(d.gross)}</b></div>
<div class="${d.hasFine ? 'fine' : ''}"><span>غرامة التأخير (${num(d.finePct + '%')})</span><b>${money(d.fine)}</b></div>
<div class="net"><span>الصافي المستحق بعد الخصم</span><b>${money(d.net)}</b></div>
</div>
<div class="words">${tafqeet(d.net)}</div>
${Number(d.priorFine) > 0 ? `<p class="muted">غرامات سابقة ${money(d.priorFine)} ر.ق، والغرامة المتراكمة ${money(d.cumulativeFine)} ر.ق.</p>` : ''}
${d.notes ? `<p><b>ملاحظات:</b> ${esc(d.notes)}</p>` : ''}
<div class="cert-section">تقييم المدرسة لأداء الشركة</div>
<table class="cert-rating">
${rating('الالتزام بنطاق العمل', d.ratings.scope)}
${rating('الالتزام بالمدة الزمنية للعقد', d.ratings.time)}
${rating('الالتزام بتعليمات جهة الإشراف', d.ratings.supervision)}
</table>
<div class="cert-section">المرفقات مع شهادة الإنجاز</div>
<div class="checks">${attachments}</div>
${CLOSING}
${signatures([
  { role: 'تم الاستلام والمراجعة بواسطة محاسب المدرسة', name: d.accountant },
  { role: 'مدير المدرسة', name: d.principal, extra: d.school },
])}`;
  return printDocument({ title: 'شهادة إنجاز أعمال', ref: d.number, date: d.date, body, compact: true });
}

/** كتاب التغطية: طلب صرف مستحقات الشركة — template «Cover Let». */
export function certificateCover(d: CertificateData & { coverDate: string; coverAttachments: string[] }) {
  const items = COVER_ATTACHMENTS.filter((a) => a.key === 'certificate' || d.coverAttachments.includes(a.key));
  const body = `
<div class="to"><span>السادة / ${esc(ADDRESSEES[d.addressee - 1] ?? ADDRESSEES[0])}</span><span>المحترمين</span></div>
${GREETING}
<p>تحية طيبة وبعد،،،</p>
<p class="subject">الموضوع: صرف مستحقات شركة ${esc(d.supplier)}</p>
<p class="indent">تتقدم إليكم مدرسة / ${esc(d.school)} بأخلص التحيات،</p>
<p class="indent">بالإشارة إلى الموضوع أعلاه، وحيث أن شركة / ${esc(d.supplier)} قد أتمت المعاملة من توريد / ${esc(
    d.subject,
  )}، إلى المدرسة حسب الموافقات والتكليف الصادر لها (أمر التوريد ${esc(d.orderNumber)}، شهادة الإنجاز ${esc(d.number)}، صافي المستحق ${money(d.net)} ر.ق).</p>
<p class="indent">وعليه فيرجى التكرم بإجراء اللازم لصرف مستحقات الشركة للفاتورة المرفقة.</p>
${CLOSING}
${signatures([{ role: 'مدير المدرسة', name: d.principal, extra: d.school }])}
<p class="bold">المرفقات:</p>
<ol>${items.map((a) => `<li>${esc(a.text)}</li>`).join('')}</ol>`;
  return printDocument({ title: 'كتاب تغطية — صرف مستحقات', ref: d.number + '-COVER', date: d.coverDate, body });
}

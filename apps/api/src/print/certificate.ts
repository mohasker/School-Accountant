import { EVIDENCE, COVER_ATTACHMENTS, PRE_CERTIFICATE } from '../core/documents';
import { tafqeet } from '../core/tafqeet';
import { ADDRESSEES, CLOSING, GREETING, dateHtml, esc, money, printDocument, signatures, num, workingDays } from './layout';

export const RATINGS = { EXCELLENT: 'ممتاز', AVERAGE: 'متوسط', POOR: 'رديء' } as const;
export type Rating = keyof typeof RATINGS;

export const addresseeName = (a: number | string) => (typeof a === 'string' && a ? a : (ADDRESSEES[Number(a) - 1] ?? ADDRESSEES[0]));

export type CertificateData = {
  number: string;
  kind: 'PARTIAL' | 'FINAL';
  date: string;
  /** Name of the addressed department (older certificates stored the position in the fixed list). */
  addressee: number | string;
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

const ratingRow = (label: string, value: Rating) =>
  `<td class="r bold">${esc(label)}</td>${(Object.keys(RATINGS) as Rating[])
    .map((k) => `<td${k === value ? ' class="picked"' : ''}>${k === value ? '☒' : '☐'} ${RATINGS[k]}</td>`)
    .join('')}`;

/** شهادة إنجاز أعمال — template «Injaz». */
export function certificateDocument(d: CertificateData) {
  const row = (n: number, label: string, value: string) =>
    `<tr><td class="n">${n}</td><td class="k">${esc(label)}</td><td>${value}</td></tr>`;
  const delay = d.hasFine
    ? `نعم — مدة التوريد ${workingDays(d.deliveryDays)} — عدد أيام التأخير ${workingDays(d.lateDays)}`
    : `لا${d.deliveryDays ? ` — مدة التوريد ${workingDays(d.deliveryDays)}` : ''}`;
  const fineLine =
    `${money(d.fine)} ر.ق — ${num(d.finePct + '%')}` +
    (Number(d.priorFine) > 0
      ? ` <span class="muted">(غرامات سابقة ${money(d.priorFine)}، المتراكمة ${money(d.cumulativeFine)})</span>`
      : '');
  const attachments = PRE_CERTIFICATE.map(
    (code) => `<span class="${d.attachments.includes(code) ? 'on' : ''}">${esc(EVIDENCE[code].print)}</span>`,
  ).join('');
  const body = `
<div class="to"><span>السادة / ${esc(addresseeName(d.addressee))}</span><span>المحترمين</span></div>
<h1>الموضوع: شهادة إنجاز أعمال${d.kind === 'PARTIAL' ? ' (جزئية)' : ''}</h1>
<p>تتقدم إليكم مدرسة: <b>${esc(d.school)}</b> بأخلص التحيات،</p>
<p>بالإشارة إلى الموضوع أعلاه، وبناءً على قيام السادة شركة / <b>${esc(d.supplier)}</b> بتوريد الأصناف / تنفيذ الأعمال المنصوص عليها في أمر التوريد / كتاب التكليف (${esc(d.subject)})، حسب الآتي:</p>
<table class="grid cert">
${row(1, 'رقم أمر التوريد / كتاب التكليف / العقد', esc(d.orderNumber))}
${row(2, 'رقم الفاتورة', esc(d.invoice))}
${row(3, 'قيمة أمر التوريد / التكليف الإجمالية / العقد', money(d.orderValue) + ' ر.ق')}
${row(4, 'تاريخ أمر التوريد / العقد', dateHtml(d.orderDate))}
${row(5, 'تاريخ التوريد الفعلي للأصناف', dateHtml(d.deliveryDate))}
${row(6, 'قيمة البنود والأصناف التي تم توريدها فعلياً', money(d.gross) + ' ر.ق')}
${row(7, 'غرامات تأخير / مدة التوريد / عدد أيام التأخير', delay)}
${row(8, 'قيمة غرامات التأخير / ونسبتها %', fineLine)}
${row(9, 'قيمة الفاتورة بعد خصم قيمة غرامة التأخير', `<b>${money(d.net)} ر.ق</b><div class="words">${tafqeet(d.net)}</div>`)}
${row(10, 'ملاحظات', esc(d.notes || '—'))}
</table>
<p class="bold section cert-head">تقييم المدرسة لأداء المورد</p>
<table class="rating cert-small">
<tr>${ratingRow('1- الالتزام بنطاق العمل', d.ratings.scope)}</tr>
<tr>${ratingRow('2- الالتزام بالمدة الزمنية للعقد', d.ratings.time)}</tr>
<tr>${ratingRow('3- الالتزام بتعليمات جهة الإشراف', d.ratings.supervision)}</tr>
</table>
<p class="bold section cert-head">** مرفقات مع تقرير (شهادة) الإنجاز:</p>
<div class="checks cert-small">${attachments}</div>
${CLOSING}
${signatures([
  { role: 'تم الاستلام والمراجعة بواسطة محاسب المدرسة', name: d.accountant },
  { role: 'مدير المدرسة', name: d.principal, extra: d.school },
])}`;
  return printDocument({ title: 'شهادة إنجاز أعمال', ref: d.number, date: d.date, body, compact: true, showRef: false });
}

/** كتاب التغطية: طلب صرف مستحقات الشركة — template «Cover Let». */
export function certificateCover(d: CertificateData & { coverDate: string; coverAttachments: string[] }) {
  const items = COVER_ATTACHMENTS.filter((a) => a.key === 'certificate' || d.coverAttachments.includes(a.key));
  const body = `
<div class="to"><span>السادة / ${esc(addresseeName(d.addressee))}</span><span>المحترمين</span></div>
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
  return printDocument({ title: 'كتاب تغطية — صرف مستحقات', ref: d.number + '-COVER', date: d.coverDate, body, showRef: false });
}

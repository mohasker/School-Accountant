import { tafqeet } from '../core/tafqeet';
import { CLOSING, FINANCE, GREETING, dateHtml, esc, money, printDocument, signatures, num, workingDays } from './layout';

type QuoteRow = { supplier: string; total: unknown; compliant: boolean; note?: string | null; selected: boolean };

/** تقرير دراسة عروض أسعار الشركات — template «Taqrer». */
export function quoteStudyReport(d: {
  ref: string;
  date: Date | string;
  school: string;
  principal: string;
  accountant: string;
  subject: string;
  quotes: QuoteRow[];
  method: string;
  exclusiveReason?: string | null;
  awardReason?: string | null;
  singleQuoteLimit: string;
}) {
  const winner = d.quotes.find((q) => q.selected);
  const basis =
    d.method === 'EXCLUSIVE'
      ? `<p class="indent">المورد المذكور محتكر لتوريد الصنف المطلوب، لذا اكتُفي بعرض سعر واحد. المبرر: ${esc(d.exclusiveReason)}.</p>`
      : d.method === 'SINGLE_QUOTE'
        ? `<p class="indent">قيمة المشتريات لا تتجاوز ${money(d.singleQuoteLimit)} ريال قطري، لذا اكتُفي بعرض سعر واحد وفق السياسة المالية المعتمدة.</p>`
        : '';
  const rows = d.quotes
    .map(
      (q, i) =>
        `<tr><td>${i + 1}</td><td class="r">${esc(q.supplier)}</td><td>${money(q.total)}</td><td class="r">${esc(
          q.note?.trim() || (q.compliant ? 'مطابق للمواصفات والشروط' : 'غير مطابق'),
        )}</td></tr>`,
    )
    .join('');
  const body = `
<div class="to"><span>السادة / ${FINANCE}</span><span>المحترمين</span></div>
${GREETING}
<p class="subject">الموضوع / تقرير دراسة عروض أسعار الشركات عن ${esc(d.subject)}.</p>
<p class="indent">تتقدم إليكم مدرسة / ${esc(d.school)} بأخلص التحيات،</p>
<p class="indent">بالإشارة للموضوع أعلاه، وبناءً على الحاجة الفعلية للمدرسة لهذه الأصناف نحيطكم علماً بأنه تم طلب عروض أسعار من عدد من الشركات، وعليه وبعد دراسة العروض المقدمة نرفق لكم بيانها بالجدول أدناه:</p>
<table><tr><th style="width:40px">م</th><th>اسم الشركة</th><th style="width:130px">قيمة عرض السعر</th><th>الرأي الفني</th></tr>${rows}</table>
${basis}
<p class="bold">التوصية:</p>
<p class="indent">بعد الاطلاع على عروض الأسعار الموضحة أعلاه نوصي بتكليف شركة / ${esc(winner?.supplier)}، وبقيمة / ${money(
    winner?.total,
  )} ريال قطري، حيث إنها مطابقة للمواصفات والشروط المطلوبة.${d.awardReason ? ` (${esc(d.awardReason)})` : ''}</p>
<p class="words">${tafqeet(winner?.total)}</p>
${CLOSING}
${signatures([
  { role: 'مسؤول المشتريات / محاسب المدرسة', name: d.accountant },
  { role: 'مدير المدرسة', name: d.principal },
])}`;
  return printDocument({ title: 'تقرير دراسة عروض الأسعار', ref: d.ref, date: d.date, body });
}

/** كتاب التكليف / أمر الشراء المحلي — template «Taklef». */
export function orderLetter(d: {
  orderNumber: string;
  date: Date | string;
  school: string;
  principal: string;
  accountant: string;
  supplier: string;
  subject: string;
  quoteRef?: string | null;
  quoteDate?: Date | string | null;
  ministryReference?: string | null;
  items: { name: string; unit: string; qty: unknown; unitPrice: unknown; value: unknown }[];
  total: unknown;
  startWithinDays: number;
  deliveryDays: number;
  dueDate: Date | string;
  finePct: string;
  capPct: string;
}) {
  const reference = d.ministryReference
    ? `بالإشارة إلى الموضوع أعلاه، وإلى تكليف الوزارة رقم ( ${esc(d.ministryReference)} )`
    : `بالإشارة إلى الموضوع أعلاه، بخصوص عرض السعر رقم ( ${esc(d.quoteRef)} ) بتاريخ ( ${dateHtml(d.quoteDate)} )`;
  const rows = d.items
    .map(
      (i, n) =>
        `<tr><td>${n + 1}</td><td class="r">${esc(i.name)}</td><td>${esc(i.qty)} ${esc(i.unit)}</td><td>${money(i.unitPrice)}</td><td>${money(i.value)}</td></tr>`,
    )
    .join('');
  const body = `
<p class="bold">رقم أمر الشراء المحلي: ${esc(d.orderNumber)}</p>
<div class="to"><span>السادة / ${esc(d.supplier)}</span><span>المحترمين</span></div>
${GREETING}
<p>تحية طيبة وبعد،،،</p>
<p class="subject">الموضوع / ${esc(d.subject)}.</p>
<p class="indent">تتقدم إليكم مدرسة / ${esc(d.school)} بأخلص التحيات،</p>
<p class="indent">${reference} نفيدكم بالموافقة مع تكليفكم بإتمام التوريد، وعليه يرجى البدء بالعمل وحسب الشروط الخاصة بعرض السعر المرفق.</p>
<table><tr><th style="width:40px">م</th><th>الصنف</th><th style="width:110px">الكمية</th><th style="width:120px">السعر الإفرادي</th><th style="width:130px">القيمة الإجمالية</th></tr>${rows}
<tr class="total"><td colspan="4" class="r">القيمة الإجمالية</td><td class="bold">${money(d.total)}</td></tr></table>
<p class="words">القيمة الإجمالية: ${tafqeet(d.total)}</p>
<p class="bold">مع ضرورة الالتزام بالتالي:</p>
<ol>
<li>البدء بتوريد الأصناف للمدرسة خلال ${workingDays(d.startWithinDays)} من استلام كتاب التكليف، وإتمام التوريد خلال ${workingDays(d.deliveryDays)} (آخر موعد ${dateHtml(d.dueDate)}).</li>
<li>في حال عدم عمل اللازم سيتم تطبيق غرامة تأخير ${num(d.finePct + '%')} عن كل يوم عمل تأخير وبحد أقصى ${num(d.capPct + '%')}.</li>
<li>مع ضرورة التقيد بجميع الشروط الخاصة بعرض سعركم المذكور أعلاه.</li>
</ol>
<p class="indent">فور الانتهاء من الأعمال المطلوبة، يتم تزويد المدرسة بالفاتورة الأصلية بتاريخ انتهاء الأعمال أو توريد المواد، حيث سيتم الدفع عن طريق ${FINANCE} بوزارة التربية والتعليم والتعليم العالي.</p>
${CLOSING}
${signatures([
  { role: 'محاسب المدرسة', name: d.accountant },
  { role: 'مدير المدرسة', name: d.principal, extra: d.school },
])}`;
  return printDocument({ title: 'كتاب التكليف', ref: d.orderNumber, date: d.date, body });
}

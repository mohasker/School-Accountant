import { D, sum } from '../common/money';
import { tafqeet } from '../core/tafqeet';
import { CLOSING, FINANCE, GREETING, dateHtml, esc, money, printDocument, signatures } from './layout';

export const IMPREST_TYPES: Record<string, string> = {
  PETTY: 'العهدة النثرية',
  EDUCATION: 'عهدة يوم التعليم',
  BOOK: 'عهدة معرض الكتاب',
  OTHER: 'عهدة خاصة',
};

export const SETTLEMENT_TYPES: Record<string, string> = {
  REPLENISH: 'إستعاضة وصرف',
  CLOSE: 'تسوية وإغلاق',
};

type ExpenseRow = {
  vendor: string;
  invoice: string;
  date: Date | string;
  description: string;
  amount: unknown;
  note: string;
  accountCode?: string;
  budget: { code: string; name: string };
};

export type ImprestStatement = {
  number: number;
  date: string;
  type: string;
  settlementType: string;
  school: string;
  year: string;
  principal: string;
  custodian: string;
  accountant: string;
  imprestAmount: unknown;
  expenses: ExpenseRow[];
};

/** كشف استعاضة / تسوية العهدة — template «ASKER». */
export function imprestStatement(d: ImprestStatement) {
  const total = sum(d.expenses.map((e) => new D(String(e.amount))));
  const balance = new D(String(d.imprestAmount)).minus(total);
  const rows = d.expenses
    .map(
      (e, i) =>
        `<tr><td>${i + 1}</td><td class="r">${esc(e.vendor)}</td><td>${esc(e.invoice || '—')}</td><td>${dateHtml(e.date)}</td><td class="r">${esc(
          e.description,
        )}</td><td class="r">${esc(e.budget.name)}</td><td>${money(e.amount)}</td><td class="r">${esc(e.note)}</td></tr>`,
    )
    .join('');
  const byBudget = new Map<string, { name: string; code: string; total: InstanceType<typeof D> }>();
  for (const e of d.expenses) {
    const key = e.accountCode || e.budget.code;
    const name = key === e.budget.code ? e.budget.name : `${e.budget.name} (أصول)`;
    const row = byBudget.get(key) ?? { name, code: key, total: new D(0) };
    row.total = row.total.plus(String(e.amount));
    byBudget.set(key, row);
  }
  const title =
    d.type === 'PETTY' && d.settlementType === 'REPLENISH'
      ? `كشف استعاضة النثرية رقم ( ${d.number} )`
      : `كشف ${SETTLEMENT_TYPES[d.settlementType]} ${IMPREST_TYPES[d.type]} رقم ( ${d.number} )`;
  const body = `
<p class="center bold">مدرسة ${esc(d.school)} — للسنة الدراسية ${esc(d.year)}</p>
<h1>${esc(title)}</h1>
<table><tr><th>مبلغ العهدة</th><th>المنصرف</th><th>الرصيد</th><th>مسؤول العهدة</th></tr>
<tr><td>${money(d.imprestAmount)}</td><td>${money(total)}</td><td>${money(balance)}</td><td>${esc(d.custodian)}</td></tr></table>
<table class="dense"><tr><th style="width:32px">م</th><th>المورد</th><th>رقم الفاتورة</th><th>تاريخ الفاتورة</th><th>البيان (التفاصيل)</th><th>البند</th><th>المبلغ</th><th>ملاحظات</th></tr>
${rows}
<tr class="total"><td colspan="6">الإجمالي</td><td class="bold">${money(total)}</td><td></td></tr></table>
<p class="words">${tafqeet(total)}</p>
<table style="margin-top:18px"><tr><th>الوظيفة</th><th>الاسم</th><th style="width:34%">التوقيع</th></tr>
<tr><td>مدير / ة المدرسة</td><td>${esc(d.principal)}</td><td></td></tr>
<tr><td>مسؤول / ة العهدة</td><td>${esc(d.custodian)}</td><td></td></tr>
<tr><td>محاسب / ة المدرسة</td><td>${esc(d.accountant)}</td><td></td></tr></table>
<p class="bold">ملخص المنصرف حسب بنود الموازنة</p>
<table><tr><th>البند</th><th>رقم الحساب</th><th>المبلغ المنصرف</th></tr>
${[...byBudget.values()].map((b) => `<tr><td class="r">${esc(b.name)}</td><td>${esc(b.code)}</td><td>${money(b.total)}</td></tr>`).join('')}
<tr class="total"><td colspan="2">الإجمالي</td><td class="bold">${money(total)}</td></tr></table>`;
  return printDocument({ title, ref: `IMP-${d.number}`, date: d.date, body });
}

/** كتاب طلب تسوية واستعاضة العهدة — template «COVER LTR». */
export function imprestCover(d: ImprestStatement) {
  const total = sum(d.expenses.map((e) => new D(String(e.amount))));
  const body = `
<div class="to"><span>الفاضل / مدير ${FINANCE}</span><span>المحترم</span></div>
${GREETING}
<p class="subject">الموضوع / طلب ${esc(SETTLEMENT_TYPES[d.settlementType])} ${esc(IMPREST_TYPES[d.type])}.</p>
<p class="indent">تتقدم إليكم مدرسة / ${esc(d.school)} بأخلص التحيات، بالإشارة للموضوع أعلاه، يرجى من سيادتكم الموافقة على تسوية ${esc(
    SETTLEMENT_TYPES[d.settlementType],
  )} ( ${esc(IMPREST_TYPES[d.type])} ) بإجمالي قيمة الفواتير: ( ${money(total)} ) ريال قطري — ${tafqeet(
    total,
  )}، ومرفق لسيادتكم المستندات الثبوتية للتسوية${d.settlementType === 'REPLENISH' ? ' والاستعاضة' : ''} فيما يلي:</p>
<ol><li>فاتورة مؤيدة لكل عمليات الصرف، معتمدة ومختومة.</li><li>كشف تفريغي لكافة الفواتير (كشف رقم ${d.number}).</li>${
    d.settlementType === 'CLOSE' ? '<li>إيصال إعادة الرصيد المتبقي من العهدة.</li>' : ''
  }</ol>
${CLOSING}
${signatures([{ role: 'مدير المدرسة', name: d.principal, extra: d.school }])}`;
  return printDocument({ title: 'كتاب تغطية تسوية العهدة', ref: `IMP-${d.number}-COVER`, date: d.date, body });
}

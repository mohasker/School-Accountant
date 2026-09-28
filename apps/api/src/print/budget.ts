import { D, amount, sum } from '../common/money';
import { esc, printDocument, signatures } from './layout';

/** Budget groups of the operational budget template, in print order. */
export const BUDGET_GROUPS: { key: string; ar: string; en: string; subtotal: string }[] = [
  { key: 'INSTRUCTIONAL', ar: 'الأنشطة التعليمية', en: 'Instructional Activities', subtotal: 'إجمالي - المواد التعليمية' },
  { key: 'NON_INSTRUCTIONAL', ar: 'نشاطات غير تعليمية', en: 'Non Instructional Activities', subtotal: 'إجمالي - نشاطات تشغيلية' },
  { key: 'MAINTENANCE', ar: 'مصاريف الصيانة', en: 'Maintenance Expenses', subtotal: 'إجمالي مصاريف الصيانة' },
  { key: 'STUDENT', ar: 'خدمات طلابية', en: 'Student Services', subtotal: 'إجمالي الخدمات الطلابية' },
];

type Line = { code: string; name: string; nameEn: string; groupKey: string; schoolAmount: unknown; kgAmount: unknown; approved: unknown };
type Plan = {
  schoolBuildings: number;
  kgBuildings: number;
  studentsSchool: number;
  studentsKg: number;
  teachersSchool: number;
  teachersKg: number;
  adminSchool: number;
  adminKg: number;
} | null;

/** الموازنة التقديرية — template «موازنة المدرسة». */
export function budgetEstimate(d: { school: string; principal: string; year: string; plan: Plan; lines: Line[] }) {
  const p = d.plan;
  const n = (v?: number) => (v ?? 0).toString();
  const assumption = (en: string, ar: string, a?: number, b?: number) =>
    `<tr><td class="r">${en}</td><td class="r">${ar}</td><td>${n(a)}</td><td>${n(b)}</td><td>${(a ?? 0) + (b ?? 0)}</td></tr>`;
  const money = (l: Line) => {
    const school = new D(String(l.schoolAmount ?? 0)),
      kg = new D(String(l.kgAmount ?? 0));
    // Lines entered without a building split are shown under the school building.
    return school.plus(kg).isZero() ? { school: new D(String(l.approved ?? 0)), kg } : { school, kg };
  };
  let grandSchool = new D(0),
    grandKg = new D(0);
  const groups = [...BUDGET_GROUPS, { key: '', ar: 'بنود أخرى', en: 'Other', subtotal: 'إجمالي - بنود أخرى' }]
    .map((g) => {
      const lines = d.lines.filter((l) => (g.key ? l.groupKey === g.key : !BUDGET_GROUPS.some((x) => x.key === l.groupKey)));
      if (!lines.length) return '';
      const values = lines.map(money),
        s = sum(values.map((v) => v.school)),
        k = sum(values.map((v) => v.kg));
      grandSchool = grandSchool.plus(s);
      grandKg = grandKg.plus(k);
      return `<tr><th colspan="2" class="r">${esc(g.en)}</th><th colspan="4">${esc(g.ar)}</th></tr>${lines
        .map(
          (l, i) =>
            `<tr><td class="r">${esc(l.nameEn)}</td><td class="r">${esc(l.name)} <span class="muted">(${esc(l.code)})</span></td><td>${amount(
              values[i].school,
            )}</td><td>${amount(values[i].kg)}</td><td>${amount(values[i].school.plus(values[i].kg))}</td><td></td></tr>`,
        )
        .join('')}<tr class="bold"><td class="r">Subtotal</td><td class="r">${esc(g.subtotal)}</td><td>${amount(s)}</td><td>${amount(k)}</td><td>${amount(
        s.plus(k),
      )}</td><td></td></tr>`;
    })
    .join('');
  const body = `
<p>اسم المدرسة: <b>${esc(d.school)}</b></p>
<p>عدد المباني: ( ${n(p?.schoolBuildings)} ) مبنى مدرسة — ( ${n(p?.kgBuildings)} ) مبنى روضة</p>
<p>اسم مدير/ة المدرسة: <b>${esc(d.principal)}</b></p>
<h1>الموازنة التقديرية ${esc(d.year)}</h1>
<table><tr><th colspan="2">Main Assumptions — الافتراضات الرئيسية</th><th>مبنى المدرسة</th><th>مبنى الروضة</th><th>الإجمالي</th></tr>
${assumption('Projected Number of Students', 'التسجيل المتوقع للطلاب', p?.studentsSchool, p?.studentsKg)}
${assumption('Proposed Number of Instructional Staff', 'عدد الهيئة التدريسية', p?.teachersSchool, p?.teachersKg)}
${assumption('Proposed Number of Administrational Staff', 'عدد الهيئة الإدارية', p?.adminSchool, p?.adminKg)}
</table>
<table><tr><th colspan="2">Operational Expenses — المصاريف التشغيلية</th><th>مبنى المدرسة</th><th>مبنى الروضة</th><th>الإجمالي</th><th>ملاحظات</th></tr>
${groups}
<tr class="bold"><td class="r">Total Expenditures</td><td class="r">إجمالي المصروفات</td><td>${amount(grandSchool)}</td><td>${amount(grandKg)}</td><td>${amount(
    grandSchool.plus(grandKg),
  )}</td><td></td></tr></table>
${signatures([{ role: 'يعتمد: مدير المدرسة', name: d.principal }])}`;
  return printDocument({ title: 'الموازنة التقديرية', ref: `BUDGET-${d.year}`, date: new Date(), body });
}

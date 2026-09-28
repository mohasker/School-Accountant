'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { BUDGET_GROUPS, currency, day } from '../lib/format';

const PLAN_FIELDS: [string, string][] = [
  ['schoolBuildings', 'عدد مباني المدرسة'],
  ['kgBuildings', 'عدد مباني الروضة'],
  ['studentsSchool', 'الطلاب المتوقعون — المدرسة'],
  ['studentsKg', 'الطلاب المتوقعون — الروضة'],
  ['teachersSchool', 'الهيئة التدريسية — المدرسة'],
  ['teachersKg', 'الهيئة التدريسية — الروضة'],
  ['adminSchool', 'الهيئة الإدارية — المدرسة'],
  ['adminKg', 'الهيئة الإدارية — الروضة'],
];

export function Budget() {
  const w = useWorkspace();
  const [ledger] = useLoad<Row[]>(() => w.api(w.root('ledger?year=' + w.year)));
  const budgets: Row[] = w.setup.budgets || [];
  const available = (b: Row) => Number(b.approved) - Number(b.committed) - Number(b.spent);

  const lineDialog = (b?: Row): Dialog => ({
    title: b ? `اعتماد بند ${b.name}` : 'إضافة بند موازنة',
    intro: <p>أدخل مبلغ مبنى المدرسة ومبنى الروضة؛ الإجمالي هو الاعتماد. التعديل يُسجل في سجل التدقيق مع السبب.</p>,
    fields: [
      ...(!b
        ? ([
            { name: 'code', label: 'رقم الحساب' },
            { name: 'name', label: 'اسم البند' },
            {
              name: 'groupKey',
              label: 'المجموعة',
              type: 'select',
              options: Object.entries(BUDGET_GROUPS).map(([value, label]) => ({ value, label: String(label) })),
            },
          ] as const)
        : []),
      { name: 'schoolAmount', label: 'مبنى المدرسة', type: 'number', value: b?.schoolAmount ?? '0' },
      { name: 'kgAmount', label: 'مبنى الروضة', type: 'number', value: b?.kgAmount ?? '0' },
      { name: 'reason', label: 'السبب ومرجع الاعتماد' },
    ],
    save: (v) => {
      const total = (Number(v.schoolAmount || 0) + Number(v.kgAmount || 0)).toFixed(2);
      const body = {
        yearId: w.year,
        code: b?.code ?? v.code,
        name: b?.name ?? v.name,
        amount: total,
        schoolAmount: Number(v.schoolAmount || 0).toFixed(2),
        kgAmount: Number(v.kgAmount || 0).toFixed(2),
        reason: v.reason,
        ...(!b ? { groupKey: v.groupKey } : {}),
      };
      return w.api(w.root('budgets' + (b ? '/' + b.id : '')), b ? 'PATCH' : 'POST', body);
    },
  });

  const planDialog: Dialog = {
    title: 'الافتراضات الرئيسية للموازنة التقديرية',
    fields: PLAN_FIELDS.map(([name, label]) => ({ name, label, type: 'number', step: '1', value: w.setup.plan?.[name] ?? 0 })),
    save: (v) =>
      w.api(w.root('budget-plan'), 'POST', { yearId: w.year, ...Object.fromEntries(PLAN_FIELDS.map(([k]) => [k, Number(v[k] || 0)])) }),
  };

  const groups = Object.keys(BUDGET_GROUPS);
  return (
    <>
      <Panel
        title="بنود الموازنة التشغيلية"
        actions={
          <>
            <DocButtons path={w.root('budget-estimate?year=' + w.year)} label="الموازنة التقديرية" />
            {w.can('ACCOUNTANT') && (
              <button className="secondary" onClick={() => w.open(planDialog)}>
                الافتراضات (الطلاب والهيئات)
              </button>
            )}
            {w.can('ACCOUNTANT') && (
              <>
                <button
                  className="secondary"
                  onClick={() =>
                    w.task(() => w.api(w.root('budgets/init'), 'POST', { yearId: w.year }), 'تمت إضافة البنود الرسمية الناقصة')
                  }
                >
                  إضافة البنود الرسمية
                </button>
                <button onClick={() => w.open(lineDialog())}>＋ بند</button>
              </>
            )}
          </>
        }
      >
        {budgets.length ? (
          <Table heads={['رقم الحساب', 'البند', 'مبنى المدرسة', 'مبنى الروضة', 'الاعتماد', 'الارتباطات', 'المصروف', 'المتاح', '']}>
            {groups.flatMap((g) => {
              const lines = budgets.filter((b) => (b.groupKey || 'OTHER') === g || (g === 'OTHER' && !groups.includes(b.groupKey)));
              if (!lines.length) return [];
              return [
                <tr key={g} className="group-row">
                  <td colSpan={9}>{BUDGET_GROUPS[g]}</td>
                </tr>,
                ...lines.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.code}</td>
                    <td>
                      {b.name}
                      <small>{b.nameEn}</small>
                    </td>
                    <td>{currency(b.schoolAmount)}</td>
                    <td>{currency(b.kgAmount)}</td>
                    <td>
                      <b>{currency(b.approved)}</b>
                    </td>
                    <td>{currency(b.committed)}</td>
                    <td>{currency(b.spent)}</td>
                    <td>
                      <b className={available(b) < 0 ? 'neg' : ''}>{currency(available(b))}</b>
                    </td>
                    <td>
                      {w.can('ACCOUNTANT') && (
                        <button className="link" onClick={() => w.open(lineDialog(b))}>
                          اعتماد / تعديل
                        </button>
                      )}
                    </td>
                  </tr>
                )),
              ];
            })}
            <tr className="total-row">
              <td colSpan={4}>الإجمالي</td>
              <td>{currency(budgets.reduce((a, b) => a + Number(b.approved), 0))}</td>
              <td>{currency(budgets.reduce((a, b) => a + Number(b.committed), 0))}</td>
              <td>{currency(budgets.reduce((a, b) => a + Number(b.spent), 0))}</td>
              <td>{currency(budgets.reduce((a, b) => a + available(b), 0))}</td>
              <td />
            </tr>
          </Table>
        ) : (
          <Empty text="لا توجد بنود؛ استخدم «إضافة البنود الرسمية» لإنشاء بنود دليل الموازنة" />
        )}
      </Panel>
      <Panel title="كشف حركة الموازنة">
        <Table heads={['التاريخ', 'البند', 'حركة الارتباط', 'حركة المصروف', 'النوع']}>
          {(ledger || []).map((r) => (
            <tr key={r.id}>
              <td>{day(r.createdAt)}</td>
              <td>
                {r.budget.name}
                <small>{r.budget.code}</small>
              </td>
              <td>{currency(r.commitment)}</td>
              <td>{currency(r.expense)}</td>
              <td>{r.kind === 'EXPENSE' ? 'مصروف' : 'ارتباط'}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

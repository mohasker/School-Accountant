'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, IMPREST_TYPES, percent } from '../lib/format';

export function Imprests() {
  const w = useWorkspace();
  const [rows] = useLoad<Row[]>(() => w.api(w.root('imprests?year=' + w.year)));
  const policy = w.setup.policy || {};
  const school = w.setup.school || {};
  const post = (a: Row, action: string, body: Row) => w.api(w.root(`imprests/${a.id}/${action}`), 'POST', body);

  const openDialog: Dialog = {
    title: 'فتح عهدة',
    intro: <p>قيمة العهدة تُطلب في كل مرة لأنها تتغير حسب السياسة المالية. عهدة يوم التعليم ومعرض الكتاب تُسوّى وتُغلق ولا تُستعاض.</p>,
    fields: [
      {
        name: 'type',
        label: 'نوع العهدة',
        type: 'select',
        options: Object.entries(IMPREST_TYPES).map(([value, label]) => ({ value, label: String(label) })),
      },
      { name: 'name', label: 'اسم العهدة', value: 'العهدة النثرية ' + (w.setup.years?.find((y: Row) => y.id === w.year)?.label ?? '') },
      { name: 'custodian', label: 'مسؤول / أمين العهدة', value: school.pettyCustodian },
      { name: 'amount', label: 'قيمة العهدة المستلمة (ر.ق)', type: 'number' },
      { name: 'reference', label: 'مرجع التمويل / الشيك' },
    ],
    save: (v) => w.api(w.root('imprests'), 'POST', { ...v, yearId: w.year }),
  };

  const expenseDialog = (a: Row): Dialog => ({
    title: 'تسجيل فاتورة مصروفة من العهدة',
    intro:
      a.type === 'PETTY' ? (
        <p>الشراء من النثرية للاحتياجات الطارئة والضرورية حتى {currency(policy.singleQuoteLimit)} ر.ق للفاتورة.</p>
      ) : undefined,
    fields: [
      { name: 'vendor', label: 'المورد' },
      { name: 'invoice', label: 'رقم الفاتورة', required: false },
      { name: 'date', label: 'تاريخ الفاتورة', type: 'date', value: dateNow() },
      { name: 'description', label: 'البيان (التفاصيل)' },
      {
        name: 'budgetId',
        label: 'البند',
        type: 'select',
        options: (w.setup.budgets || []).map((b: Row) => ({ value: b.id, label: `${b.name} (${b.code})` })),
      },
      { name: 'amount', label: 'المبلغ', type: 'number' },
      { name: 'note', label: 'ملاحظات (مثل: ليس لديهم فاتورة إلكترونية)', required: false },
    ],
    save: (v) => post(a, 'expense', v),
  });

  /** Settlement screen: shows the imprest figures, then asks for replenishment or settlement and closure. */
  const settleDialog = (a: Row): Dialog => {
    const s = a.status;
    const unsettled = a.expenses.filter((e: Row) => !e.settlementId);
    return {
      title: 'تسوية ' + a.name,
      wide: true,
      intro: (
        <>
          <div className="summary">
            <div>
              <span>قيمة العهدة</span>
              <b>{currency(a.amount)}</b>
            </div>
            <div>
              <span>الرصيد النقدي</span>
              <b>{currency(a.balance)}</b>
            </div>
            <div>
              <span>منصرف غير مسوى</span>
              <b>
                {currency(s.unsettledTotal)} <small>({unsettled.length} فاتورة)</small>
              </b>
            </div>
            <div>
              <span>حد الاستعاضة</span>
              <b>
                {currency(s.threshold)} <small>({percent(s.replenishPct)})</small>
              </b>
            </div>
          </div>
          {a.type === 'PETTY' && !s.canReplenish && (
            <p className="warn">
              لم يبلغ المنصرف {percent(s.replenishPct)} من قيمة العهدة؛ الاستعاضة غير متاحة بعد، ويمكن التسوية والإغلاق.
            </p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const type = (document.querySelector('select[name="type"]') as HTMLSelectElement)?.value || 'REPLENISH';
              try {
                const r = await w.api(w.root(`imprests/${a.id}/preview?type=${type}`));
                w.printHtml(r.html);
              } catch (e) {
                w.fail(e);
              }
            }}
          >
            معاينة الكشف قبل الحفظ
          </button>
        </>
      ),
      fields: [
        {
          name: 'type',
          label: 'المطلوب',
          type: 'select',
          value: s.canReplenish ? 'REPLENISH' : 'CLOSE',
          options: [
            ...(a.type === 'PETTY' ? [{ value: 'REPLENISH', label: 'تسوية واستعاضة (صرف)' }] : []),
            { value: 'CLOSE', label: 'تسوية وإغلاق العهدة' },
          ],
        },
        { name: 'date', label: 'تاريخ الكشف', type: 'date', value: dateNow() },
        { name: 'custodian', label: 'مسؤول / ة العهدة', value: a.custodian },
        { name: 'principal', label: 'مدير / ة المدرسة', value: school.principal },
        { name: 'reason', label: 'ملاحظات', required: false },
      ],
      submit: 'إصدار الكشف وكتاب التغطية',
      save: (v) => post(a, 'settle', v),
    };
  };

  return (
    <>
      <div className="actions">{w.can('APPROVER') && <button onClick={() => w.open(openDialog)}>＋ فتح عهدة</button>}</div>
      {rows && !rows.length && <Empty text="لا توجد عهد لهذا العام" />}
      {rows?.map((a) => (
        <Panel
          key={a.id}
          title={
            <div>
              <h2>
                {a.name} <span className="tag">{IMPREST_TYPES[a.type]}</span>
              </h2>
              <p>
                {a.custodian} — {a.closed ? 'مغلقة' : 'مفتوحة'} — القيمة {currency(a.amount)} ر.ق
              </p>
            </div>
          }
          actions={
            <h2>
              {currency(a.balance)} <small>ر.ق رصيد</small>
            </h2>
          }
        >
          {!a.closed && (
            <>
              {a.type === 'PETTY' && Number(a.amount) > 0 && (
                <div className="budget-bar">
                  <div>
                    <span>المنصرف غير المسوى من قيمة العهدة</span>
                    <b>{percent(Number(a.status.unsettledTotal) / Number(a.amount))}</b>
                  </div>
                  <div className="track">
                    <span style={{ width: `${Math.min(100, (100 * Number(a.status.unsettledTotal)) / Number(a.amount))}%` }} />
                  </div>
                  <small>
                    {a.status.canReplenish
                      ? 'بلغت العهدة حد الاستعاضة — يمكن طلب الاستعاضة'
                      : `الاستعاضة عند ${percent(a.status.replenishPct)} (${currency(a.status.threshold)} ر.ق)`}
                  </small>
                </div>
              )}
              <div className="actions">
                {w.can('ACCOUNTANT') && <button onClick={() => w.open(expenseDialog(a))}>＋ فاتورة</button>}
                {w.can('APPROVER') && (
                  <>
                    <button className="secondary" onClick={() => w.open(settleDialog(a))}>
                      تسوية / استعاضة / إغلاق
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        w.open({
                          title: 'إغلاق العهدة وإعادة الرصيد المتبقي',
                          intro: <p>يتطلب تسوية كل الفواتير وتسجيل التسويات في ERP. الرصيد المتبقي: {currency(a.balance)} ر.ق.</p>,
                          fields: [{ name: 'returnReference', label: 'مرجع إيصال إعادة الرصيد' }],
                          save: (v) => post(a, 'close', v),
                        })
                      }
                    >
                      إغلاق العهدة
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          <Table heads={['م', 'المورد', 'رقم الفاتورة', 'التاريخ', 'البيان', 'البند', 'المبلغ', 'ملاحظات', 'التسوية']}>
            {a.expenses.map((e: Row, i: number) => (
              <tr key={e.id}>
                <td>{i + 1}</td>
                <td>{e.vendor}</td>
                <td>{e.invoice || '—'}</td>
                <td>{day(e.date)}</td>
                <td>{e.description}</td>
                <td>
                  {e.budget?.name}
                  <small>{e.budget?.code}</small>
                </td>
                <td>{currency(e.amount)}</td>
                <td>{e.note}</td>
                <td>{e.settlementId ? 'مسوى' : 'لم يسوَّ'}</td>
              </tr>
            ))}
          </Table>
          {a.settlements.map((st: Row) => (
            <div className="settlement" key={st.id}>
              <b>
                كشف رقم {st.number} — {st.type === 'REPLENISH' ? 'استعاضة' : 'تسوية وإغلاق'} — {currency(st.amount)} ر.ق
              </b>
              <span>{st.erpRef ? `ERP: ${st.erpRef}` : 'بانتظار ERP'}</span>
              {st.type === 'REPLENISH' && <span>{st.replenished ? 'استُلمت الاستعاضة' : 'بانتظار استلام الاستعاضة'}</span>}
              <button className="link" onClick={() => w.print(w.root(`imprests/${a.id}/${st.id}`))}>
                طباعة الكشف
              </button>
              <button
                className="link"
                onClick={async () => {
                  try {
                    w.printHtml((await w.api(w.root(`imprests/${a.id}/${st.id}`))).cover);
                  } catch (e) {
                    w.fail(e);
                  }
                }}
              >
                طباعة كتاب التغطية
              </button>
              {w.can('ERP') && !st.erpRef && (
                <button
                  className="link"
                  onClick={() =>
                    w.open({
                      title: 'تسجيل التسوية في ERP',
                      fields: [{ name: 'reference', label: 'مرجع ERP' }],
                      save: (v) => post(a, 'erp', { ...v, settlementId: st.id }),
                    })
                  }
                >
                  إثبات ERP
                </button>
              )}
              {w.can('APPROVER') && !st.replenished && st.type === 'REPLENISH' && !a.closed && (
                <button
                  className="link"
                  onClick={() =>
                    w.open({
                      title: 'تأكيد استلام الاستعاضة فعلياً',
                      fields: [{ name: 'reference', label: 'مرجع إيصال الاستلام' }],
                      save: (v) => post(a, 'replenish', { ...v, settlementId: st.id }),
                    })
                  }
                >
                  استلام الاستعاضة
                </button>
              )}
            </div>
          ))}
        </Panel>
      ))}
    </>
  );
}

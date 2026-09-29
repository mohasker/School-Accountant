'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { DateInput } from '../components/DateInput';
import { NumberInput, toNumberText } from '../components/NumberInput';
import { Select } from '../components/Select';
import { openImprestDialog } from '../components/dialogs';
import type { Dialog } from '../components/FormDialog';
import { DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, IMPREST_TYPES, percent } from '../lib/format';

export function Imprests() {
  const w = useWorkspace();
  const [rows] = useLoad<Row[]>(() => w.api(w.root('imprests?year=' + w.year)));
  const policy = w.setup.policy || {};
  const school = w.setup.school || {};
  const vendors = [...new Set((rows || []).flatMap((a) => a.expenses.map((e: Row) => e.vendor)))] as string[];
  const post = (a: Row, action: string, body: Row) => w.api(w.root(`imprests/${a.id}/${action}`), 'POST', body);

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
          <p>
            أدخل كل فواتير الفترة مرة واحدة هنا (المورد، الرقم، التاريخ، البيان، البند، المبلغ)؛ تُسجَّل مع إصدار كشف التسوية وكتاب التغطية.
            {a.type === 'PETTY' && (
              <>
                {' '}
                الاستعاضة عند بلوغ المنصرف {percent(s.replenishPct)} من قيمة العهدة ({currency(s.threshold)} ر.ق).
              </>
            )}
          </p>
        </>
      ),
      fields: [
        {
          name: 'type',
          label: 'المطلوب',
          type: 'select',
          value: a.type === 'PETTY' ? 'REPLENISH' : 'CLOSE',
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
      body: (
        <InvoiceRows budgets={w.setup.budgets || []} vendors={vendors} limit={a.type === 'PETTY' ? Number(policy.singleQuoteLimit) : 0} />
      ),
      submit: 'إصدار الكشف وكتاب التغطية',
      save: (v, fd) => post(a, 'settle', { ...v, invoices: readInvoiceRows(fd) }),
    };
  };

  return (
    <>
      <div className="actions">{w.can('ACCOUNTANT') && <button onClick={() => w.open(openImprestDialog(w))}>＋ عهدة جديدة</button>}</div>
      {rows && !rows.length && <Empty text="لا توجد عهد لهذا العام — اضغط «عهدة جديدة» وحدد نوعها وقيمتها" />}
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
                {w.can('ACCOUNTANT') && (
                  <>
                    <button onClick={() => w.open(settleDialog(a))}>
                      {a.type === 'PETTY' ? 'تسوية / استعاضة — إدخال الفواتير' : 'تسوية العهدة — إدخال الفواتير'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        w.open({
                          title: 'إغلاق العهدة وإعادة الرصيد المتبقي',
                          intro: <p>يتطلب تسوية كل الفواتير بكشف تسوية. الرصيد المتبقي: {currency(a.balance)} ر.ق.</p>,
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
          {w.me.user.isTenantAdmin && (
            <button
              className="link danger"
              onClick={() =>
                w.open({
                  title: 'حذف العهدة نهائياً',
                  intro: <p className="warn">تُحذف العهدة وفواتيرها وتسوياتها، وتُعاد مبالغ الفواتير إلى أرصدة البنود. لا يمكن التراجع.</p>,
                  fields: [{ name: 'confirm', label: 'اكتب كلمة «حذف» للتأكيد' }],
                  submit: 'حذف نهائي',
                  save: (v) => w.api('admin/purge', 'POST', { scope: 'imprest', id: a.id, confirm: v.confirm }),
                })
              }
            >
              حذف العهدة (مدير النظام)
            </button>
          )}
          {a.settlements.map((st: Row) => (
            <div className="settlement" key={st.id}>
              <b>
                كشف رقم {st.number} — {st.type === 'REPLENISH' ? 'استعاضة' : 'تسوية وإغلاق'} — {currency(st.amount)} ر.ق
              </b>
              {st.erpRef && <span>ERP: {st.erpRef}</span>}
              {st.type === 'REPLENISH' && <span>{st.replenished ? 'استُلمت الاستعاضة' : 'بانتظار استلام الاستعاضة'}</span>}
              <DocButtons link path={w.root(`imprests/${a.id}/${st.id}`)} label="الكشف" />
              <DocButtons link path={w.root(`imprests/${a.id}/${st.id}`)} part="cover" label="كتاب التغطية" />
              {w.can('ACCOUNTANT') && !st.erpRef && (
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
              {w.can('ACCOUNTANT') && !st.replenished && st.type === 'REPLENISH' && !a.closed && (
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

/** All invoices of the settlement entered at once, as a table; empty rows are ignored. */
function InvoiceRows({ budgets, vendors, limit }: { budgets: Row[]; vendors: string[]; limit: number }) {
  const [count, setCount] = useState(5);
  const [sum, setSum] = useState(0);
  const recount = (e: React.FormEvent<HTMLDivElement>) => {
    const inputs = e.currentTarget.querySelectorAll<HTMLInputElement>('input[name^="i_amount_"]');
    setSum([...inputs].reduce((v, i) => v + (Number(toNumberText(i.value)) || 0), 0));
  };
  const lines = budgets.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` }));
  return (
    <div className="invoice-rows" onInput={recount}>
      <datalist id="vendors">
        {vendors.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <div className="invoice-row head">
        <span>م</span>
        <span>المورد</span>
        <span>رقم الفاتورة</span>
        <span>التاريخ</span>
        <span>البيان</span>
        <span>البند</span>
        <span>المبلغ</span>
        <span>ملاحظات</span>
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div className="invoice-row" key={i}>
          <span className="n">{i + 1}</span>
          <input name={'i_vendor_' + i} list="vendors" autoComplete="off" placeholder="اسم المورد" aria-label="المورد" />
          <input name={'i_invoice_' + i} placeholder="—" aria-label="رقم الفاتورة" />
          <DateInput name={'i_date_' + i} defaultValue={dateNow()} ariaLabel="التاريخ" />
          <input name={'i_desc_' + i} placeholder="مثل: ضيافة - بوفيه المدرسة" aria-label="البيان" />
          <Select name={'i_budget_' + i} label="البند" options={lines} />
          <NumberInput name={'i_amount_' + i} aria-label="المبلغ" />
          <input name={'i_note_' + i} placeholder="" aria-label="ملاحظات" />
        </div>
      ))}
      <div className="invoice-foot">
        <button type="button" className="secondary" onClick={() => setCount((n) => n + 5)}>
          ＋ 5 صفوف أخرى
        </button>
        <span>
          إجمالي الفواتير المدخلة: <b>{currency(sum)} ر.ق</b>
          {limit > 0 && <small> · حد الفاتورة من النثرية {currency(limit)} ر.ق</small>}
        </span>
      </div>
    </div>
  );
}

export function readInvoiceRows(fd: FormData) {
  const rows = [];
  for (let i = 0; fd.has('i_vendor_' + i); i++) {
    const g = (k: string) => String(fd.get(`i_${k}_${i}`) ?? '').trim();
    if (!g('vendor') && !g('amount') && !g('desc')) continue;
    rows.push({
      vendor: g('vendor'),
      invoice: g('invoice'),
      date: g('date'),
      description: g('desc') || 'مشتريات',
      budgetId: g('budget'),
      amount: toNumberText(g('amount')),
      note: g('note') || (g('invoice') ? '' : 'بدون فاتورة'),
    });
  }
  return rows;
}

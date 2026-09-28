'use client';
import { useEffect, useState } from 'react';
import { BudgetBars, MonthlyBars } from '../components/charts';
import { useWorkspace } from '../components/context';
import { newCaseDialog, openImprestDialog } from '../components/dialogs';
import { Panel, Stat, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, percent } from '../lib/format';
import { CaseTable } from './Cases';

const STAGES: Row = {
  REPORT: 'تقرير عروض الأسعار قيد الإعداد',
  ORDER: 'جاهزة لإصدار التكليف',
  CERTIFICATE: 'صدر التكليف — بانتظار الإنجاز',
  DONE: 'منجزة (شهادة وكتاب تغطية)',
  CANCELLED: 'ملغاة',
};

/** Home screen for the chosen school and fiscal year: budget, documents issued in a period, charts. */
export function Dashboard() {
  const w = useWorkspace();
  const year = w.setup.years?.find((y: Row) => y.id === w.year);
  const [range, setRange] = useState({ from: '', to: '' });
  const [draft, setDraft] = useState({ from: '', to: '' });
  useEffect(() => {
    setRange({ from: '', to: '' });
    setDraft({ from: '', to: '' });
  }, [w.year]);
  const [d] = useLoad<Row>(
    () => w.api(w.root(`dashboard?year=${w.year}${range.from ? '&from=' + range.from : ''}${range.to ? '&to=' + range.to : ''}`)),
    [range.from, range.to],
  );
  if (!d) return <p>جارٍ التحميل…</p>;
  const doc = d.documents;
  const b = d.budget;
  const preset = (from: string, to: string) => (setDraft({ from, to }), setRange({ from, to }));
  const now = dateNow(),
    month = now.slice(0, 7),
    q = Math.floor((Number(now.slice(5, 7)) - 1) / 3);
  const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

  return (
    <>
      <div className="actions">
        {w.can('ACCOUNTANT') && <button onClick={() => w.open(newCaseDialog(w))}>＋ معاملة جديدة (تقرير عروض أسعار)</button>}
        {w.can('ACCOUNTANT') && (
          <button className="secondary" onClick={() => w.open(openImprestDialog(w))}>
            ＋ عهدة جديدة
          </button>
        )}
        <button className="secondary" onClick={() => w.go('imprests')}>
          تسجيل فاتورة عهدة
        </button>
      </div>

      <section className="panel period">
        <div>
          <h2>الفترة</h2>
          <p>
            {day(d.period.from)} — {day(d.period.to)} · العام المالي {year?.label}
          </p>
        </div>
        <div className="period-controls">
          <button className="secondary" onClick={() => preset('', '')}>
            العام كاملاً
          </button>
          <button
            className="secondary"
            onClick={() =>
              preset(
                `${now.slice(0, 4)}-${String(q * 3 + 1).padStart(2, '0')}-01`,
                monthEnd(`${now.slice(0, 4)}-${String(q * 3 + 3).padStart(2, '0')}`),
              )
            }
          >
            الربع الحالي
          </button>
          <button className="secondary" onClick={() => preset(month + '-01', monthEnd(month))}>
            الشهر الحالي
          </button>
          <label>
            من
            <input type="date" value={draft.from || d.period.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label>
            إلى
            <input type="date" value={draft.to || d.period.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <button onClick={() => setRange(draft)}>عرض</button>
        </div>
      </section>

      {(d.alerts?.replenish?.length > 0 || d.alerts?.lateOrders?.length > 0) && (
        <section className="panel alerts">
          <h2>تنبيهات تحتاج إجراء</h2>
          {d.alerts.replenish.map((a: Row) => (
            <div key={a.id} className="alert">
              <b>{a.name}</b> بلغ المنصرف غير المسوى {currency(a.unsettled)} ر.ق ({percent(a.ratio)} من قيمة العهدة) — يمكن طلب الاستعاضة.
              <button className="link" onClick={() => w.go('imprests')}>
                فتح العهد ←
              </button>
            </div>
          ))}
          {d.alerts.lateOrders.map((c: Row) => (
            <div key={c.id} className="alert late">
              <b>{c.number}</b> {c.subject} — {c.supplier?.name} — تجاوز موعد التنفيذ {day(c.dueDate)}.
              <button className="link" onClick={() => w.go('case', c.id)}>
                فتح المعاملة ←
              </button>
            </div>
          ))}
        </section>
      )}

      <h2 className="section-title">الموازنة والأرصدة</h2>
      <div className="cards">
        <Stat label="الموازنة المعتمدة" value={currency(b.approved)} hint="ر.ق — كشف الموازنة ←" onClick={() => w.go('budget')} />
        <Stat label="المصروف" value={currency(b.spent)} hint={`${percent(Number(b.spent) / (Number(b.approved) || 1))} من المعتمد`} />
        <Stat label="الارتباطات (تكليفات قائمة)" value={currency(b.committed)} hint="ر.ق" />
        <Stat label="الرصيد المتاح" value={currency(b.available)} hint="ر.ق" />
      </div>

      <h2 className="section-title">المستندات الصادرة خلال الفترة</h2>
      <div className="cards six">
        <Stat
          label="تقارير عروض الأسعار"
          value={doc.reports.count}
          hint={currency(doc.reports.value) + ' ر.ق'}
          onClick={() => w.go('cases')}
        />
        <Stat label="التكليفات" value={doc.orders.count} hint={currency(doc.orders.value) + ' ر.ق'} onClick={() => w.go('cases')} />
        <Stat
          label="شهادات الإنجاز"
          value={doc.certificates.count}
          hint={`صافي ${currency(doc.certificates.value)} · غرامات ${currency(doc.certificates.fines)}`}
          onClick={() => w.go('registry')}
        />
        <Stat label="كتب التغطية" value={doc.certificates.covers} hint="تصدر مع الشهادة" onClick={() => w.go('registry')} />
        <Stat
          label="فواتير العهد"
          value={doc.imprests.invoices}
          hint={currency(doc.imprests.spent) + ' ر.ق'}
          onClick={() => w.go('imprests')}
        />
        <Stat
          label="تسويات العهد"
          value={doc.imprests.settlements}
          hint={`${currency(doc.imprests.settled)} ر.ق · ${doc.imprests.open} عهدة مفتوحة`}
          onClick={() => w.go('imprests')}
        />
      </div>

      <div className="grid2">
        <Panel title="القيم الشهرية (ر.ق)">
          <MonthlyBars
            rows={d.monthly}
            series={[
              { key: 'orders', label: 'التكليفات' },
              { key: 'certificates', label: 'شهادات الإنجاز (صافي)' },
              { key: 'imprests', label: 'مصروفات العهد' },
            ]}
          />
        </Panel>
        <Panel title="مسار المعاملات">
          <Table heads={['المرحلة', 'العدد', 'القيمة']}>
            {d.stages.map((s: Row) => (
              <tr key={s.key} className="clickable" onClick={() => w.go('cases')}>
                <td>{STAGES[s.key]}</td>
                <td>
                  <b>{s.count}</b>
                </td>
                <td>{currency(s.value)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>

      <Panel
        title="أرصدة بنود الموازنة"
        actions={
          <button className="link" onClick={() => w.go('budget')}>
            كشف الموازنة ←
          </button>
        }
      >
        {b.lines.length ? <BudgetBars lines={b.lines} /> : <p>لم تُعتمد مبالغ للبنود بعد؛ أدخلها من شاشة الموازنة.</p>}
      </Panel>

      <Panel
        title="أحدث المعاملات"
        actions={
          <button className="link" onClick={() => w.go('cases')}>
            عرض الكل ←
          </button>
        }
      >
        <CaseTable rows={d.cases || []} />
      </Panel>
    </>
  );
}

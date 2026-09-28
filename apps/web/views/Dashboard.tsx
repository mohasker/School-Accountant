'use client';
import { useWorkspace } from '../components/context';
import { newCaseDialog } from '../components/dialogs';
import { Panel, Stat } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, day, percent, STATE_NAMES, STATES } from '../lib/format';
import { CaseTable } from './Cases';

export function Dashboard() {
  const w = useWorkspace();
  const [d] = useLoad<Row>(() => w.api(w.root('dashboard?year=' + w.year)));
  if (!d) return <p>جارٍ التحميل…</p>;
  const count = (s: string) => d.counts?.find((r: Row) => r.state === s)?._count || 0;
  return (
    <>
      {w.can('ACCOUNTANT') && (
        <div className="actions">
          <button onClick={() => w.open(newCaseDialog(w))}>＋ معاملة شراء جديدة</button>
          <button className="secondary" onClick={() => w.go('imprests')}>
            تسجيل مصروف نثرية
          </button>
        </div>
      )}
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
              <b>{c.number}</b> {c.subject} — {c.supplier?.name} — تجاوز موعد التوريد {day(c.dueDate)}.
              <button className="link" onClick={() => w.go('case', c.id)}>
                فتح المعاملة ←
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="cards">
        <Stat label="كل المعاملات" value={d.total || 0} hint="عرض البيان ←" onClick={() => w.go('cases')} />
        <Stat label="بانتظار الاعتماد" value={count('EVALUATED')} hint="عرض البيان ←" onClick={() => w.go('cases')} />
        <Stat label="قيد التوريد" value={count('ORDERED') + count('PARTIAL')} hint="عرض البيان ←" onClick={() => w.go('cases')} />
        <Stat label="شهادات الإنجاز" value={d.certificates || 0} hint="السجل ←" onClick={() => w.go('registry')} />
      </div>
      <div className="grid2">
        <Panel
          title="الموازنة المعتمدة"
          actions={
            <button className="link" onClick={() => w.go('budget')}>
              كشف الأرصدة ←
            </button>
          }
        >
          {d.budgets
            ?.filter((b: Row) => Number(b.approved) > 0)
            .map((b: Row) => (
              <div className="budget-bar" key={b.id}>
                <div>
                  <span>
                    {b.name} <small>{b.code}</small>
                  </span>
                  <b>{currency(Number(b.approved) - Number(b.committed) - Number(b.spent))} ر.ق</b>
                </div>
                <div className="track">
                  <span style={{ width: `${(100 * Number(b.spent)) / Number(b.approved || 1)}%` }} />
                  <i style={{ width: `${(100 * Number(b.committed)) / Number(b.approved || 1)}%` }} />
                </div>
                <small>
                  مصروف {currency(b.spent)} · ارتباطات {currency(b.committed)} · اعتماد {currency(b.approved)}
                </small>
              </div>
            ))}
        </Panel>
        <Panel title="مسار المعاملات">
          <p>اضغط على أي حالة للوصول إلى معاملاتها.</p>
          {STATES.filter((s) => s !== 'CANCELLED').map((s) => (
            <button className="state-row" key={s} onClick={() => w.go('cases')}>
              <span>{STATE_NAMES[s]}</span>
              <b>{count(s)}</b>
            </button>
          ))}
        </Panel>
      </div>
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

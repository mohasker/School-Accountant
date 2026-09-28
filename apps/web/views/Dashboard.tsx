'use client';
import { useEffect, useState } from 'react';
import { BudgetBars, ExecutionGauge, GroupBars, MonthlyBars } from '../components/charts';
import { useWorkspace } from '../components/context';
import { newCaseDialog, openImprestDialog } from '../components/dialogs';
import { Panel, Stat } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, ERP_URL, percent } from '../lib/format';
import { CaseTable } from './Cases';

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
  const span = Date.parse(d.period.yearEnd) - Date.parse(d.period.yearStart) || 1;
  const elapsed = Math.min(1, Math.max(0, (Date.parse(now) - Date.parse(d.period.yearStart)) / span));
  const accountant = w.can('ACCOUNTANT');
  const links: { icon: string; title: string; hint: string; onClick?: () => void; href?: string; primary?: boolean }[] = [
    ...(accountant
      ? [{ icon: '＋', title: 'معاملة جديدة', hint: 'تقرير عروض الأسعار', onClick: () => w.open(newCaseDialog(w)), primary: true }]
      : []),
    { icon: '☰', title: 'تقارير عروض الأسعار', hint: 'بحث وإعادة طباعة', onClick: () => w.go('quote-register') },
    { icon: '✎', title: 'التكليفات', hint: 'أوامر الشراء', onClick: () => w.go('order-register') },
    { icon: '✔', title: 'شهادات الإنجاز', hint: 'وكتب التغطية', onClick: () => w.go('registry') },
    ...(accountant ? [{ icon: '＋', title: 'عهدة جديدة', hint: 'نثرية أو خاصة', onClick: () => w.open(openImprestDialog(w)) }] : []),
    { icon: '▣', title: 'العهد والتسوية', hint: 'إدخال الفواتير عند التسوية', onClick: () => w.go('imprests') },
    { icon: '▧', title: 'التقارير', hint: 'التقرير المالي الشامل والمعاملات', onClick: () => w.go('reports') },
    { icon: '▥', title: 'الموازنة', hint: 'البنود والأرصدة', onClick: () => w.go('budget') },
    { icon: '↗', title: 'نظام ERP', hint: 'بوابة الوزارة', href: ERP_URL },
  ];
  const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

  return (
    <>
      <section className="quick-links" aria-label="روابط سريعة">
        {links.map((l) =>
          l.href ? (
            <a key={l.title} className="quick-link erp" href={l.href} target="_blank" rel="noreferrer">
              <i>{l.icon}</i>
              <b>{l.title}</b>
              <small>{l.hint}</small>
            </a>
          ) : (
            <button key={l.title} type="button" className={'quick-link' + (l.primary ? ' primary' : '')} onClick={l.onClick}>
              <i>{l.icon}</i>
              <b>{l.title}</b>
              <small>{l.hint}</small>
            </button>
          ),
        )}
      </section>

      <button
        type="button"
        className={'incomplete-banner' + (d.incomplete.count ? '' : ' clear')}
        onClick={() => document.getElementById('incomplete')?.scrollIntoView({ behavior: 'smooth' })}
      >
        <strong>{d.incomplete.count}</strong>
        <span>
          <b>{d.incomplete.count ? 'معاملات غير مكتملة' : 'لا توجد معاملات غير مكتملة'}</b>
          <small>
            {d.incomplete.count
              ? `بقيمة ${currency(d.incomplete.value)} ر.ق — لم تصدر لها شهادة الإنجاز بعد. اضغط لعرضها واستكمالها ↓`
              : 'كل المعاملات صدرت لها شهادة الإنجاز وكتاب التغطية.'}
          </small>
        </span>
      </button>

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
      <div className="budget-head">
        <Panel title="نسبة تنفيذ الموازنة">
          <ExecutionGauge approved={Number(b.approved)} spent={Number(b.spent)} committed={Number(b.committed)} elapsed={elapsed} />
        </Panel>
        <div className="cards two">
          <Stat label="الموازنة المعتمدة" value={currency(b.approved)} hint="ر.ق — كشف الموازنة ←" onClick={() => w.go('budget')} />
          <Stat label="المصروف" value={currency(b.spent)} hint={`${percent(Number(b.spent) / (Number(b.approved) || 1))} من المعتمد`} />
          <Stat label="الارتباطات (تكليفات قائمة)" value={currency(b.committed)} hint="ر.ق" />
          <Stat label="الرصيد المتاح" value={currency(b.available)} hint="ر.ق" />
        </div>
      </div>

      <h2 className="section-title">المستندات الصادرة خلال الفترة</h2>
      <div className="cards six">
        <Stat
          label="تقارير عروض الأسعار"
          value={doc.reports.count}
          hint={currency(doc.reports.value) + ' ر.ق'}
          onClick={() => w.go('quote-register')}
        />
        <Stat
          label="التكليفات"
          value={doc.orders.count}
          hint={currency(doc.orders.value) + ' ر.ق'}
          onClick={() => w.go('order-register')}
        />
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
        <Panel title="الموازنة حسب المجموعات (ر.ق)">
          <GroupBars groups={b.groups} />
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
        {b.lines.length ? <BudgetBars compact lines={b.lines} /> : <p>لم تُعتمد مبالغ للبنود بعد؛ أدخلها من شاشة الموازنة.</p>}
      </Panel>

      <div id="incomplete">
        <Panel
          title={`المعاملات غير المكتملة (${d.incomplete.count})`}
          actions={
            <button className="link" onClick={() => w.go('cases')}>
              كل المعاملات ←
            </button>
          }
        >
          {d.incomplete.rows.length ? <CaseTable rows={d.incomplete.rows} /> : <p>لا توجد معاملات بانتظار استكمال.</p>}
        </Panel>
      </div>
    </>
  );
}

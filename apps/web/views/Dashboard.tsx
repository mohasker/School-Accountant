'use client';
import { useEffect, useState } from 'react';
import { BudgetBars, ExecutionGauge, GroupBars, MonthlyBars } from '../components/charts';
import { useWorkspace } from '../components/context';
import { DateInput } from '../components/DateInput';
import { newCaseDialog } from '../components/dialogs';
import { Panel, Stat, Table } from '../components/ui';
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
    { icon: '▣', title: 'العهد', hint: 'عهدة جديدة والتسوية', onClick: () => w.go('imprests') },
    { icon: '▧', title: 'التقارير', hint: 'التقرير المالي الشامل والمعاملات', onClick: () => w.go('reports') },
    { icon: '🗂', title: 'الأرشيف', hint: 'سجلات وتعهدات الشركات المشتركة', onClick: () => w.go('archive') },
    { icon: '✦', title: 'المساعد الذكي', hint: 'اسأل عن النظام وأرقام مدرستك', onClick: () => w.go('assistant') },
    { icon: '▥', title: 'الموازنة', hint: 'البنود والأرصدة', onClick: () => w.go('budget') },
    { icon: '↗', title: 'نظام ERP', hint: 'بوابة الوزارة', href: ERP_URL },
  ];
  const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const greet = new Date();
  const hijri = (() => {
    try {
      return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Qatar',
      }).format(greet);
    } catch {
      return '';
    }
  })();
  const weekday = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Qatar' }).format(greet);
  const gregorian = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Qatar' }).format(
    greet,
  );
  return (
    <>
      <section className="welcome">
        <div>
          <h2>أهلاً بعودتك يا {w.me.user.name}</h2>
          <p>
            اليوم: <b>{weekday}</b>
            {hijri && <> {hijri}</>} — الموافق: <b className="mono">{gregorian}</b> م
          </p>
        </div>
        {w.setup.school?.erpCode && (
          <div className="welcome-erp">
            كود المدرسة على ERP: <b className="mono">{w.setup.school.erpCode}</b>
          </div>
        )}
      </section>
      <section className="quick-links" aria-label="روابط سريعة">
        {links.map((l) =>
          l.href ? (
            <a key={l.title} className="quick-link erp" href={l.href} target="_blank" rel="noreferrer" title={l.hint}>
              <i>{l.icon}</i>
              <b>{l.title}</b>
            </a>
          ) : (
            <button key={l.title} type="button" className={'quick-link' + (l.primary ? ' primary' : '')} onClick={l.onClick} title={l.hint}>
              <i>{l.icon}</i>
              <b>{l.title}</b>
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
            <DateInput value={draft.from || d.period.from} onChange={(v) => setDraft({ ...draft, from: v })} ariaLabel="من" />
          </label>
          <label>
            إلى
            <DateInput value={draft.to || d.period.to} onChange={(v) => setDraft({ ...draft, to: v })} ariaLabel="إلى" />
          </label>
          <button onClick={() => setRange(draft)}>عرض</button>
        </div>
      </section>

      {d.alerts?.repeatSuppliers?.length > 0 && (
        <section className="panel alerts repeat">
          <h2>ملاحظة: موردون تكرر التكليف لهم أكثر من مرتين هذا العام</h2>
          <p>للتذكير بتوسيع دعوات عروض الأسعار وتنويع الموردين؛ القائمة تفرغ تلقائياً عندما لا يوجد تكرار.</p>
          <Table heads={['المورد', 'عدد التكليفات', 'إجمالي القيمة']}>
            {d.alerts.repeatSuppliers.map((r: Row) => (
              <tr key={r.name}>
                <td>
                  <b>{r.name}</b>
                </td>
                <td>{r.count}</td>
                <td>{currency(r.value)} ر.ق</td>
              </tr>
            ))}
          </Table>
        </section>
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
        <Stat label="مصروفات مباشرة" value={doc.direct.count} hint={currency(doc.direct.value) + ' ر.ق'} onClick={() => w.go('budget')} />
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
              { key: 'direct', label: 'مصروفات مباشرة', color: '#b08d57' },
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

'use client';
import { Fragment, useState } from 'react';
import { useWorkspace } from '../components/context';
import { Empty, Panel, Stat, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, percent } from '../lib/format';
import { APP_NAME, APP_TITLE } from '../lib/brand';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The financial supervisor's screen (المراقب المالي): the schools it audits grouped by accountant, with
 * each accountant's totals and, opened on demand, every school's position. The administrator passes
 * `userId` to see the screen of a given supervisor.
 */
export function Supervision({ userId }: { userId?: string }) {
  const w = useWorkspace();
  const [d] = useLoad<Row>(() => w.api('admin/supervision' + (userId ? '?user=' + userId : '')), [userId]);
  const [open, setOpen] = useState<string | null>(null);
  if (!d) return <p>جارٍ التحميل…</p>;
  const t = d.totals;

  const print = () =>
    w.printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير المراقب المالي</title>
<style>@page{size:A4 landscape;margin:12mm}body{font-family:Calibri,Arial,sans-serif;font-size:10.5pt;color:#1c1c1c}
h1{font-size:16pt;color:#6b1530;margin:0}p{margin:2mm 0 4mm;color:#555}table{width:100%;border-collapse:collapse;margin-bottom:6mm}
th{background:#6b1530;color:#fff;font-weight:600;padding:2mm}td{border-bottom:1px solid #ddd;padding:1.6mm 2mm}tr.acc td{background:#f6eef1;font-weight:700}
td.n{text-align:left;direction:ltr;font-variant-numeric:tabular-nums}.foot{font-size:8.5pt;color:#888}</style></head><body>
<h1>تقرير المراقب المالي — ${esc(d.supervisor.name)}</h1>
<p>${esc(APP_NAME)} · ${esc(APP_TITLE)} · ${t.schools} مدرسة · ${new Date().toLocaleDateString('en-GB')}</p>
<table><thead><tr><th>المحاسب / المدرسة</th><th>المعتمد</th><th>المصروف</th><th>الارتباطات</th><th>المتاح</th><th>الاستخدام</th><th>قيد الإعداد</th><th>متأخرة</th><th>شهادات العام</th><th>صافي الشهادات</th><th>مرتجعات</th><th>لم تُسجل ERP</th></tr></thead><tbody>
${d.accountants
  .map(
    (a: Row) =>
      `<tr class="acc"><td>${esc(a.name)} (${a.totals.schools})</td><td class="n">${currency(a.totals.approved)}</td><td class="n">${currency(a.totals.spent)}</td><td class="n">${currency(a.totals.committed)}</td><td class="n">${currency(a.totals.available)}</td><td class="n">${percent(a.totals.used)}</td><td class="n">${a.totals.pending}</td><td class="n">${a.totals.late}</td><td class="n">${a.totals.certificates}</td><td class="n">${currency(a.totals.net)}</td><td class="n">${a.totals.returns}</td><td class="n">${a.totals.erp}</td></tr>` +
      a.schools
        .map(
          (s: Row) =>
            `<tr><td>&nbsp;&nbsp;${esc(s.name)}</td><td class="n">${currency(s.approved)}</td><td class="n">${currency(s.spent)}</td><td class="n">${currency(s.committed)}</td><td class="n">${currency(s.available)}</td><td class="n">${percent(s.used)}</td><td class="n">${s.pending}</td><td class="n">${s.late}</td><td class="n">${s.certificates}</td><td class="n">${currency(s.net)}</td><td class="n">${s.returns}</td><td class="n">${s.erp}</td></tr>`,
        )
        .join(''),
  )
  .join('')}
<tr class="acc"><td>الإجمالي</td><td class="n">${currency(t.approved)}</td><td class="n">${currency(t.spent)}</td><td class="n">${currency(t.committed)}</td><td class="n">${currency(t.available)}</td><td class="n">${percent(t.used)}</td><td class="n">${t.pending}</td><td class="n">${t.late}</td><td class="n">${t.certificates}</td><td class="n">${currency(t.net)}</td><td class="n">${t.returns}</td><td class="n">${t.erp}</td></tr>
</tbody></table><p class="foot">الأرقام من العام المالي الحالي لكل مدرسة. المبالغ بالريال القطري.</p></body></html>`);

  return (
    <>
      <div className="cards">
        <Stat label="المدارس تحت الإشراف" value={t.schools} hint={`${d.accountants.filter((a: Row) => a.id).length} محاسب`} />
        <Stat label="الموازنة المعتمدة" value={currency(t.approved)} hint={`مستخدم ${percent(t.used)}`} />
        <Stat label="شهادات العام / صافيها" value={t.certificates} hint={currency(t.net) + ' ر.ق'} />
        <Stat label="متأخرة / مرتجعات / بدون ERP" value={`${t.late} / ${t.returns} / ${t.erp}`} />
      </div>
      <Panel
        title={'المحاسبون ومدارسهم' + (userId ? ' — ' + d.supervisor.name : '')}
        actions={
          <button className="secondary" onClick={print}>
            طباعة التقرير
          </button>
        }
      >
        {!d.accountants.length ? (
          <Empty text="لم تُحدد مدارس للإشراف بعد؛ يحددها مدير النظام من لوحته" />
        ) : (
          <Table
            heads={[
              'المحاسب',
              'المدارس',
              'المعتمد',
              'المصروف + الارتباطات',
              'الاستخدام',
              'قيد الإعداد',
              'متأخرة',
              'شهادات العام',
              'مرتجعات',
              'تنبيهات',
              '',
            ]}
          >
            {d.accountants.map((a: Row) => (
              <Fragment key={a.id || 'none'}>
                <tr className={a.totals.late || a.totals.warnings ? 'attention' : ''}>
                  <td>
                    <b>{a.name}</b>
                  </td>
                  <td>{a.totals.schools}</td>
                  <td className="mono">{currency(a.totals.approved)}</td>
                  <td className="mono">{currency(Number(a.totals.spent) + Number(a.totals.committed))}</td>
                  <td>
                    <span className="usage">
                      <i style={{ width: Math.min(100, Math.round(a.totals.used * 100)) + '%' }} />
                    </span>
                    {percent(a.totals.used)}
                  </td>
                  <td>{a.totals.pending}</td>
                  <td className={a.totals.late ? 'danger-text' : ''}>{a.totals.late}</td>
                  <td>
                    {a.totals.certificates}
                    <small>{currency(a.totals.net)}</small>
                  </td>
                  <td>{a.totals.returns}</td>
                  <td>{a.totals.warnings}</td>
                  <td>
                    <button className="link" onClick={() => setOpen(open === a.id ? null : a.id)}>
                      {open === a.id ? 'إخفاء المدارس ▴' : 'المدارس ▾'}
                    </button>
                  </td>
                </tr>
                {open === a.id &&
                  a.schools.map((s: Row) => (
                    <tr key={a.id + s.id} className="sub-row">
                      <td>
                        <button className="link" title="فتح المدرسة (اطلاع)" onClick={() => w.pickSchool(s.id)}>
                          {s.name}
                        </button>
                        {s.warnings
                          .filter((x: Row) => x.level !== 'info')
                          .slice(0, 2)
                          .map((x: Row, i: number) => (
                            <small key={i} className={x.level === 'danger' ? 'danger-text' : ''}>
                              {x.text}
                            </small>
                          ))}
                      </td>
                      <td>{s.year?.label ?? '—'}</td>
                      <td className="mono">{currency(s.approved)}</td>
                      <td className="mono">{currency(Number(s.spent) + Number(s.committed))}</td>
                      <td>{percent(s.used)}</td>
                      <td>{s.pending}</td>
                      <td className={s.late ? 'danger-text' : ''}>{s.late}</td>
                      <td>
                        {s.certificates}
                        <small>{currency(s.net)}</small>
                      </td>
                      <td>{s.returns}</td>
                      <td>{s.warnings.filter((x: Row) => x.level === 'danger').length}</td>
                      <td>{s.erp ? `${s.erp} بدون ERP` : ''}</td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

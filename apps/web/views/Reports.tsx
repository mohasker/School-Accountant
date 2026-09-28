'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { dateNow, day, downloadCsv, downloadFile, STATE_NAMES } from '../lib/format';
import { CaseTable } from './Cases';

export function Reports() {
  const w = useWorkspace();
  const fy = w.setup.years?.find((y: Row) => y.id === w.year);
  const [period, setPeriod] = useState({ from: day(fy?.startDate) || '2026-01-01', to: dateNow(), accountant: '' }),
    [report, setReport] = useState<Row | null>(null);
  const [runs] = useLoad<Row[]>(() => w.api(w.root('report-runs?year=' + w.year)), [report?.id]);
  const run = async () => {
    try {
      setReport(
        await w.api(
          w.root(
            `reports?year=${w.year}&from=${period.from}&to=${period.to}${period.accountant ? '&accountant=' + period.accountant : ''}`,
          ),
        ),
      );
    } catch (e) {
      w.fail(e);
    }
  };
  return (
    <>
      <Panel title="تقرير المعاملات لفترة محددة">
        <div className="toolbar">
          <label>
            من
            <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          </label>
          <label>
            إلى
            <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          </label>
          <label>
            المحاسب
            <select value={period.accountant} onChange={(e) => setPeriod({ ...period, accountant: e.target.value })}>
              <option value="">كل المحاسبين المصرح بهم</option>
              {w.setup.users?.map((u: Row) => (
                <option key={u.id} value={u.user.id}>
                  {u.user.name}
                </option>
              ))}
            </select>
          </label>
          <button onClick={run}>استخراج التقرير</button>
        </div>
        <div className="actions">
          <button className="link" onClick={() => setPeriod({ ...period, from: dateNow().slice(0, 7) + '-01', to: dateNow() })}>
            هذا الشهر
          </button>
          <button className="link" onClick={() => fy && setPeriod({ ...period, from: day(fy.startDate), to: day(fy.endDate) })}>
            العام المالي
          </button>
        </div>
        {report && (
          <>
            <div className="report-head">
              {report.header.school} | إعداد: {report.header.accountant} | {report.header.from} — {report.header.to}
            </div>
            <div className="actions">
              <DocButtons path={w.root('report-runs/' + report.id)} label="التقرير" />
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    downloadFile(await w.api(w.root('report-runs/' + report.id + '/xlsx')));
                  } catch (e) {
                    w.fail(e);
                  }
                }}
              >
                تنزيل Excel
              </button>
              <button
                className="secondary"
                onClick={() =>
                  downloadCsv('school-transactions.csv', [
                    ['المدرسة', report.header.school, 'المحاسب', report.header.accountant],
                    ['من', report.header.from, 'إلى', report.header.to],
                    ['الرقم', 'الموضوع', 'المحاسب', 'أمر الشراء', 'القيمة', 'الحالة'],
                    ...report.rows.map((r: Row) => [r.number, r.subject, r.accountantName, r.orderNumber, r.total, STATE_NAMES[r.state]]),
                  ])
                }
              >
                تنزيل CSV
              </button>
            </div>
            <CaseTable rows={report.rows} />
          </>
        )}
      </Panel>
      <Panel title="تقارير أخرى">
        <div className="actions">
          <button className="secondary" onClick={() => w.go('registry')}>
            سجل شهادات الإنجاز والبحث
          </button>
          <DocButtons path={w.root('budget-estimate?year=' + w.year)} label="الموازنة التقديرية" />
          <button className="secondary" onClick={() => w.go('imprests')}>
            كشوف العهد
          </button>
        </div>
      </Panel>
      <Panel title="التقارير المحفوظة">
        {runs?.length ? (
          <Table heads={['التقرير', 'وقت الاستخراج', '']}>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{new Date(r.createdAt).toLocaleString('ar-QA')}</td>
                <td>
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        setReport(await w.api(w.root('report-runs/' + r.id)));
                      } catch (e) {
                        w.fail(e);
                      }
                    }}
                  >
                    عرض النسخة المحفوظة
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لا توجد تقارير محفوظة بعد" />
        )}
      </Panel>
    </>
  );
}

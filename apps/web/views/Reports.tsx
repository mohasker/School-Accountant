'use client';
import { useState } from 'react';
import { DateInput } from '../components/DateInput';
import { Select } from '../components/Select';
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
  const finPath = (extra = '') => w.root(`financial-report?year=${w.year}&from=${period.from}&to=${period.to}${extra}`);
  return (
    <>
      <Panel title="التقرير المالي الشامل">
        <p>
          أرقام ورسوم بيانية فقط، محسوبة مباشرة من السجلات: المؤشرات الرئيسية، الموقف المالي حسب المجموعات والبنود، نشاط المشتريات، القيم
          الشهرية والصرف التراكمي، الموردون، والعهد.
        </p>
        <div className="toolbar">
          <label>
            من
            <DateInput value={period.from} onChange={(v) => setPeriod({ ...period, from: v })} ariaLabel="من" />
          </label>
          <label>
            إلى
            <DateInput value={period.to} onChange={(v) => setPeriod({ ...period, to: v })} ariaLabel="إلى" />
          </label>
          <DocButtons path={finPath()} label="التقرير المالي" />
          <button
            className="secondary"
            onClick={async () => {
              try {
                downloadFile(await w.api(finPath('&format=xlsx')));
              } catch (e) {
                w.fail(e);
              }
            }}
          >
            تنزيل Excel
          </button>
        </div>
        <div className="actions">
          <button className="link" onClick={() => setPeriod({ ...period, from: dateNow().slice(0, 7) + '-01', to: dateNow() })}>
            هذا الشهر
          </button>
          <button className="link" onClick={() => fy && setPeriod({ ...period, from: day(fy.startDate), to: day(fy.endDate) })}>
            العام المالي كاملاً
          </button>
        </div>
      </Panel>
      <Panel title="تقرير المعاملات لفترة محددة">
        <div className="toolbar">
          <label>
            من
            <DateInput value={period.from} onChange={(v) => setPeriod({ ...period, from: v })} ariaLabel="من" />
          </label>
          <label>
            إلى
            <DateInput value={period.to} onChange={(v) => setPeriod({ ...period, to: v })} ariaLabel="إلى" />
          </label>
          <label>
            المحاسب
            <Select
              value={period.accountant}
              onChange={(v) => setPeriod({ ...period, accountant: v })}
              options={[
                { value: '', label: 'كل المحاسبين المصرح بهم' },
                ...(w.setup.users || []).map((u: Row) => ({ value: u.user.id, label: u.user.name })),
              ]}
            />
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
          <button className="secondary" onClick={() => w.go('quote-register')}>
            تقارير عروض الأسعار
          </button>
          <button className="secondary" onClick={() => w.go('order-register')}>
            التكليفات
          </button>
          <button className="secondary" onClick={() => w.go('registry')}>
            شهادات الإنجاز
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
      <YearPackage />
    </>
  );
}

/** «حزمة نهاية السنة»: every file, statement and register of the school's year in one ZIP (built in the background). */
function YearPackage() {
  const w = useWorkspace();
  const [state, setState] = useState<Row | null>(null);
  const start = async () => {
    try {
      const { job, total } = await w.api(`year-package/${w.school}/${w.year}`, 'POST', {});
      setState({ status: 'RUNNING', done: 0, total });
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        const st = await w.api('year-package/' + job);
        setState(st);
        if (st.status === 'DONE') {
          downloadFile(st);
          break;
        }
        if (st.status === 'FAILED') throw Error(st.error || 'تعذر إعداد الحزمة');
      }
    } catch (e) {
      setState(null);
      w.fail(e);
    }
  };
  return (
    <Panel title="حزمة نهاية السنة">
      <p>
        <small>
          ملف ZIP للعام المختار فيه كل ملفات المعاملات (فهرس + المستندات بترتيب التدقيق)، وكشوف تسوية العهد وكتب تغطيتها، وسجلات Excel
          للمعاملات وفواتير العهد والموازنة. قد يستغرق إعدادها بضع دقائق.
        </small>
      </p>
      <button onClick={start} disabled={state?.status === 'RUNNING'}>
        {state?.status === 'RUNNING' ? `جارٍ الإعداد… ${state.done} من ${state.total}` : 'إعداد حزمة نهاية السنة'}
      </button>
      {state?.status === 'DONE' && <small> ✓ نُزّلت الحزمة.</small>}
    </Panel>
  );
}

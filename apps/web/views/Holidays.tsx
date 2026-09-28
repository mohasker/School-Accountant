'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { day } from '../lib/format';

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** Official holidays: excluded from delivery deadlines and delay days, with the weekly weekend. */
export function Holidays() {
  const w = useWorkspace();
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows] = useLoad<Row[]>(() => w.api('admin/holidays?year=' + year), [year]);
  const admin = w.me.user.isTenantAdmin;
  const weekend: number[] = w.setup.policy?.weekend ?? [5, 6];
  return (
    <Panel
      title={`الإجازات الرسمية ${year}`}
      actions={
        <>
          <button className="secondary" onClick={() => setYear(year - 1)}>
            ‹ {year - 1}
          </button>
          <button className="secondary" onClick={() => setYear(year + 1)}>
            {year + 1} ›
          </button>
          {admin && (
            <button
              onClick={() =>
                w.open({
                  title: 'إضافة إجازة رسمية',
                  intro: (
                    <p>للإجازة الممتدة (مثل عيد الفطر أو إجازة الربيع) حدد من وإلى؛ تُسجّل كل الأيام. الأيام المسجلة مسبقاً لا تتكرر.</p>
                  ),
                  fields: [
                    { name: 'name', label: 'اسم الإجازة' },
                    { name: 'from', label: 'من', type: 'date' },
                    { name: 'to', label: 'إلى', type: 'date' },
                  ],
                  save: (v) => w.api('admin/holidays', 'POST', v),
                })
              }
            >
              ＋ إضافة إجازة
            </button>
          )}
        </>
      }
    >
      <p>
        العطلة الأسبوعية: {weekend.map((d) => WEEKDAYS[d]).join(' و ')}. تُستبعد أيام العطلة الأسبوعية والإجازات الرسمية من مدة التوريد ومن
        أيام التأخير في حساب الغرامة. {!admin && 'يعدّل الجدول مسؤول النظام.'}
      </p>
      {rows?.length ? (
        <Table heads={['التاريخ', 'اليوم', 'الإجازة', '']}>
          {rows.map((h) => (
            <tr key={h.id}>
              <td className="mono">{day(h.date)}</td>
              <td>{WEEKDAYS[new Date(h.date).getUTCDay()]}</td>
              <td>{h.name}</td>
              <td>
                {admin && (
                  <button
                    className="link danger"
                    onClick={() => confirm('حذف هذا اليوم من الإجازات؟') && w.task(() => w.api('admin/holidays/' + h.id, 'DELETE', {}))}
                  >
                    حذف
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text="لا توجد إجازات مسجلة لهذا العام" />
      )}
    </Panel>
  );
}

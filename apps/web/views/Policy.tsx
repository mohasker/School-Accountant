'use client';
import { useWorkspace } from '../components/context';
import { Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { dateNow, day } from '../lib/format';

const show = (v: unknown) => (Array.isArray(v) ? v.join('، ') : String(v));

/** Financial policy values with dated history; a change applies from its effective date forward. */
export function Policy() {
  const w = useWorkspace();
  const [data] = useLoad<Row>(() => w.api('admin/policy'));
  const admin = w.me.user.isTenantAdmin;
  if (!data) return <p>جارٍ التحميل…</p>;
  const label = (key: string) => data.definitions.find((d: Row) => d.key === key)?.label ?? key;
  return (
    <>
      <Panel title="القيم السارية">
        <p>تُحفظ كل قيمة جديدة بتاريخ سريان، ولا تُعدّل القيم السابقة، فتبقى المعاملات القديمة على القاعدة التي طُبقت عليها.</p>
        <Table heads={['البند', 'القيمة الحالية', 'الوصف', '']}>
          {data.definitions.map((d: Row) => (
            <tr key={d.key}>
              <td>
                <b>{d.label}</b>
              </td>
              <td className="mono">{show(data.current[d.key])}</td>
              <td>
                <small>{d.help}</small>
              </td>
              <td>
                {admin && (
                  <button
                    className="link"
                    onClick={() =>
                      w.open({
                        title: 'تعديل: ' + d.label,
                        intro: <p>{d.help}</p>,
                        fields: [
                          { name: 'value', label: 'القيمة الجديدة', value: show(data.current[d.key]) },
                          { name: 'effectiveFrom', label: 'تاريخ السريان', type: 'date', value: dateNow() },
                          { name: 'reason', label: 'السبب / مرجع التعميم' },
                        ],
                        save: (v) => {
                          const value =
                            typeof d.default === 'number'
                              ? Number(v.value)
                              : Array.isArray(d.default)
                                ? String(v.value)
                                    .split(/[،,\s]+/)
                                    .filter(Boolean)
                                    .map(Number)
                                : String(v.value).trim();
                          return w.api('admin/policy', 'POST', { key: d.key, value, effectiveFrom: v.effectiveFrom, reason: v.reason });
                        },
                      })
                    }
                  >
                    تعديل
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="سجل التعديلات">
        <Table heads={['البند', 'القيمة', 'يسري من', 'السبب', 'وقت التسجيل']}>
          {data.history.map((h: Row) => (
            <tr key={h.id}>
              <td>{label(h.key)}</td>
              <td className="mono">{show(h.value)}</td>
              <td>{day(h.effectiveFrom)}</td>
              <td>{h.reason}</td>
              <td>{new Date(h.createdAt).toLocaleString('ar-QA')}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

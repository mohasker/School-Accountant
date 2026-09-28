'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { downloadFile } from '../lib/format';

/** Completion-certificate register across the user's schools (search, reprint, Excel export). */
export function Registry() {
  const w = useWorkspace();
  const [form, setForm] = useState({ q: '', supplier: '', school: '', from: '', to: '' }),
    [filters, setFilters] = useState(form);
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  const [data] = useLoad<Row>(() => w.api('registry/certificates?' + qs), [qs]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const withFormat = (format: string) =>
    'registry/certificates?' + new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), format });
  return (
    <Panel
      title="البحث في شهادات الإنجاز"
      actions={
        <>
          <DocButtons path={withFormat('print')} label="النتائج" />
          <button
            className="secondary"
            onClick={async () => {
              try {
                downloadFile(await w.api(withFormat('xlsx')));
              } catch (e) {
                w.fail(e);
              }
            }}
          >
            تنزيل Excel
          </button>
        </>
      }
    >
      <form
        className="toolbar wrap"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(form);
        }}
      >
        <label>
          بحث
          <input placeholder="رقم الشهادة أو أمر التوريد أو الفاتورة أو الموضوع" value={form.q} onChange={set('q')} />
        </label>
        <label>
          المورد
          <input value={form.supplier} onChange={set('supplier')} />
        </label>
        <label>
          المدرسة
          <select value={form.school} onChange={set('school')}>
            <option value="">كل مدارسي</option>
            {w.me.schools.map((s: Row) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          من
          <input type="date" value={form.from} onChange={set('from')} />
        </label>
        <label>
          إلى
          <input type="date" value={form.to} onChange={set('to')} />
        </label>
        <button>بحث</button>
      </form>
      {data?.rows?.length ? (
        <Table heads={[...data.heads.slice(0, 5), 'القيمة المنجزة', 'الغرامة', 'الصافي', 'المدرسة', '']}>
          {data.rows.map((r: Row) => (
            <tr key={r.id}>
              <td>{r.cells[0]}</td>
              <td className="mono">{r.cells[1]}</td>
              <td>{r.cells[2]}</td>
              <td>{r.cells[3]}</td>
              <td className="mono">{r.cells[4]}</td>
              <td>{r.cells[9]}</td>
              <td>{r.cells[13]}</td>
              <td>
                <b>{r.cells[14]}</b>
              </td>
              <td>{r.cells[16]}</td>
              <td>
                <div className="actions">
                  <DocButtons link path={`schools/${r.schoolId}/certificates/${r.id}`} label="الشهادة" />
                  <DocButtons link path={`schools/${r.schoolId}/certificates/${r.id}/cover`} label="التغطية" />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text="لا توجد شهادات مطابقة" />
      )}
      <small>يعرض حتى 2000 شهادة من المدارس المسندة إليك فقط.</small>
    </Panel>
  );
}

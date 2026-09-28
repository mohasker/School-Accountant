'use client';
import { useEffect, useState } from 'react';
import { Select } from '../components/Select';
import { useWorkspace } from '../components/context';
import { DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, downloadFile } from '../lib/format';

export type RegisterType = 'report' | 'order' | 'certificate';

const TITLES: Record<RegisterType, string> = {
  report: 'تقارير دراسة عروض الأسعار',
  order: 'التكليفات (أوامر الشراء)',
  certificate: 'شهادات الإنجاز وكتب التغطية',
};
const SEARCH_HINT: Record<RegisterType, string> = {
  report: 'رقم التقرير أو المعاملة أو الموضوع',
  order: 'رقم أمر الشراء أو المعاملة أو الموضوع',
  certificate: 'رقم الشهادة أو أمر التوريد أو الفاتورة أو الموضوع',
};

/**
 * Registers across the user's schools: quote reports, assignment letters, completion certificates.
 * Search by text, school, accountant (administrator), company and period; reprint any document, print
 * the list as a report, or download it to Excel.
 */
export function Registry({ type = 'certificate' }: { type?: RegisterType }) {
  const w = useWorkspace();
  const admin = w.me.user.isTenantAdmin;
  const empty = { q: '', supplier: '', school: '', accountant: '', from: '', to: '' };
  const [form, setForm] = useState(empty),
    [filters, setFilters] = useState(empty);
  useEffect(() => (setForm(empty), setFilters(empty)), [type]);
  const [accounts] = useLoad<Row[]>(() => (admin ? w.api('admin/users') : null));
  const base = type === 'certificate' ? 'registry/certificates' : 'registry/cases';
  const params = { ...(type === 'certificate' ? {} : { type }), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  const [data] = useLoad<Row>(() => w.api(base + '?' + qs), [qs]);
  const withFormat = (format: string) => base + '?' + new URLSearchParams({ ...(params as Record<string, string>), format });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const docPath = (r: Row) =>
    type === 'report' ? `schools/${r.schoolId}/cases/${r.id}/report-print` : `schools/${r.schoolId}/cases/${r.id}/order-print`;

  return (
    <Panel
      title={'البحث في ' + TITLES[type]}
      actions={
        <>
          <DocButtons path={withFormat('print')} label="التقرير" />
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
        className="toolbar wrap register-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(form);
        }}
      >
        <label>
          بحث
          <input placeholder={SEARCH_HINT[type]} value={form.q} onChange={set('q')} />
        </label>
        <label>
          الشركة / المورد
          <input list="register-companies" value={form.supplier} onChange={set('supplier')} />
          <datalist id="register-companies">
            {(w.setup.suppliers || []).map((s: Row) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </label>
        <label>
          المدرسة
          <Select
            value={form.school}
            onChange={(v) => setForm({ ...form, school: v })}
            options={[{ value: '', label: 'كل مدارسي' }, ...w.me.schools.map((s: Row) => ({ value: s.id, label: s.name }))]}
          />
        </label>
        {admin && (
          <label>
            المحاسب
            <Select
              value={form.accountant}
              onChange={(v) => setForm({ ...form, accountant: v })}
              options={[{ value: '', label: 'كل المحاسبين' }, ...(accounts || []).map((a: Row) => ({ value: a.id, label: a.name }))]}
            />
          </label>
        )}
        <label>
          من
          <input type="date" value={form.from} onChange={set('from')} />
        </label>
        <label>
          إلى
          <input type="date" value={form.to} onChange={set('to')} />
        </label>
        <div className="register-buttons">
          <button>بحث</button>
          <button type="button" className="secondary" onClick={() => (setForm(empty), setFilters(empty))}>
            مسح
          </button>
        </div>
      </form>
      {data?.rows?.length ? (
        <>
          <p className="register-count">
            النتائج: <b>{data.rows.length}</b>
            {data.total && (
              <>
                {' '}
                — الإجمالي <b>{currency(data.total)} ر.ق</b>
              </>
            )}
          </p>
          {type === 'certificate' ? (
            <Table heads={['م', 'رقم الشهادة', 'التاريخ', 'الشركة', 'أمر التوريد', 'القيمة المنجزة', 'الغرامة', 'الصافي', 'المدرسة', '']}>
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
            <Table heads={[...data.heads, '']}>
              {data.rows.map((r: Row) => (
                <tr key={r.id}>
                  {r.cells.map((c: unknown, i: number) => (
                    <td key={i} className={i === 1 ? 'mono' : ''}>
                      {String(c)}
                    </td>
                  ))}
                  <td>
                    <DocButtons link path={docPath(r)} label="" />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      ) : (
        <Empty text="لا توجد نتائج مطابقة" />
      )}
      <small>يعرض حتى 2000 مستند من المدارس المسندة إليك فقط.</small>
    </Panel>
  );
}

'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Select } from '../components/Select';
import { Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { downloadFile, readBase64 } from '../lib/format';

const KIND_OPTIONS = [
  { value: 'CR', label: 'سجل تجاري' },
  { value: 'UNDERTAKING', label: 'تعهد / إقرار' },
  { value: 'IBAN', label: 'شهادة IBAN' },
  { value: 'LICENSE', label: 'رخصة / تصريح' },
  { value: 'OTHER', label: 'مستند آخر' },
];
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);
const when = (v: unknown) => new Date(String(v)).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar' });

/**
 * Shared document archive across all schools: commercial registrations, undertakings, IBAN letters…
 * Any accountant searches, downloads and adds; only the system administrator removes a document.
 */
export function Archive() {
  const w = useWorkspace();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [data] = useLoad<Row>(() => w.api(`admin/archive?q=${encodeURIComponent(q)}&kind=${kind}`), [q, kind]);
  const suppliers: Row[] = w.setup.suppliers || [];

  const addDialog: Dialog = {
    title: 'إضافة مستند إلى الأرشيف المشترك',
    intro: <p>يظهر المستند لكل المحاسبين في كل المدارس؛ من باب المشاركة والعون. الملفات المقبولة: PDF أو صورة (PNG/JPG) حتى 6 ميجابايت.</p>,
    fields: [
      { name: 'company', label: 'اسم الشركة / الجهة', list: 'archive-companies' },
      { name: 'kind', label: 'نوع المستند', type: 'select', options: KIND_OPTIONS },
      { name: 'title', label: 'عنوان المستند (مثل: سجل تجاري ساري حتى 2027)' },
      { name: 'note', label: 'ملاحظات (تاريخ الانتهاء، رقم السجل…)', required: false },
    ],
    body: (
      <>
        <datalist id="archive-companies">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <label>
          الملف
          <input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
        </label>
      </>
    ),
    submit: 'رفع المستند',
    save: async (v, fd) => {
      const file = fd.get('file') as File;
      if (!file?.size) throw Error('اختر ملفاً');
      if (file.size > 6 * 1024 * 1024) throw Error('حجم الملف حتى 6 ميجابايت');
      await w.api('admin/archive', 'POST', { ...v, name: file.name, mime: file.type, base64: await readBase64(file) });
    },
  };

  const download = async (r: Row) => {
    try {
      downloadFile(await w.api('admin/archive/' + r.id));
    } catch (e) {
      w.fail(e);
    }
  };

  return (
    <Panel title="أرشيف المستندات المشترك" actions={<button onClick={() => w.open(addDialog)}>＋ إضافة مستند</button>}>
      <p>
        مخزن مشترك بين كل المحاسبين: السجلات التجارية والتعهدات وشهادات IBAN للشركات. ابحث باسم الشركة، وحمّل أي مستند، أو أضف ما لديك
        ليستفيد الزملاء.
      </p>
      <div className="toolbar wrap">
        <label>
          بحث
          <input placeholder="اسم الشركة أو عنوان المستند" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label>
          النوع
          <Select value={kind} onChange={setKind} options={[{ value: '', label: 'كل الأنواع' }, ...KIND_OPTIONS]} />
        </label>
      </div>
      {data?.rows?.length ? (
        <Table heads={['الشركة', 'النوع', 'المستند', 'ملاحظات', 'الحجم', 'أضافه', 'التاريخ', '']}>
          {data.rows.map((r: Row) => (
            <tr key={r.id}>
              <td>
                <b>{r.company}</b>
              </td>
              <td>{data.kinds[r.kind] ?? r.kind}</td>
              <td>{r.title}</td>
              <td>{r.note}</td>
              <td className="mono">{size(r.size)}</td>
              <td>{r.uploaderName}</td>
              <td>{when(r.createdAt)}</td>
              <td>
                <div className="actions">
                  <button className="link" onClick={() => download(r)}>
                    ⤓ تحميل
                  </button>
                  {data.canDelete && (
                    <button
                      className="link danger"
                      onClick={() =>
                        w.open({
                          title: 'حذف المستند من الأرشيف',
                          intro: (
                            <p>
                              {r.company} — {r.title}
                            </p>
                          ),
                          fields: [{ name: 'confirm', label: 'اكتب كلمة «حذف» للتأكيد' }],
                          submit: 'حذف',
                          save: async (v) => {
                            if (v.confirm !== 'حذف') throw Error('اكتب كلمة حذف للتأكيد');
                            await w.api('admin/archive/' + r.id, 'DELETE');
                          },
                        })
                      }
                    >
                      حذف
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text={q || kind ? 'لا توجد مستندات مطابقة' : 'الأرشيف فارغ — أضف أول مستند'} />
      )}
    </Panel>
  );
}

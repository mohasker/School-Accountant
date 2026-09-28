'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel, Table } from '../components/ui';
import type { Row } from '../lib/api';
import { parseCsv } from '../lib/format';

export function Suppliers() {
  const w = useWorkspace();
  const rows: Row[] = w.setup.suppliers || [];
  const editor = w.can('ACCOUNTANT', 'ADMIN');
  const form = (r?: Row): Dialog => ({
    title: r ? 'تعديل المورد' : 'إضافة مورد',
    fields: [
      { name: 'name', label: 'الاسم القانوني كما في السجل التجاري', value: r?.name },
      { name: 'cr', label: 'رقم السجل التجاري', value: r?.cr },
      { name: 'phone', label: 'الهاتف', value: r?.phone, required: false },
      { name: 'email', label: 'البريد الإلكتروني', value: r?.email, required: false },
      { name: 'iban', label: 'IBAN (تعديله يحتاج معتمداً)', value: r?.iban, required: false },
    ],
    save: (v) =>
      w.api(w.root('suppliers' + (r ? '/' + r.id : '')), r ? 'PATCH' : 'POST', {
        ...v,
        ...(r ? { version: r.version, active: r.active } : {}),
      }),
  });
  const importDialog: Dialog = {
    title: 'استيراد قائمة الموردين',
    intro: <p>ملف CSV بترميز UTF-8 ورؤوس الأعمدة: name, cr, phone, email. تُرفض القائمة كاملة عند وجود سجل تجاري مكرر.</p>,
    body: <input name="csv" type="file" accept=".csv" required />,
    save: async (_, fd) => w.api(w.root('supplier-import'), 'POST', { rows: parseCsv(await (fd.get('csv') as File).text()) }),
  };
  return (
    <Panel
      title="الموردون المسجلون"
      actions={
        editor && (
          <>
            <button onClick={() => w.open(form())}>＋ إضافة مورد</button>
            <button className="secondary" onClick={() => w.open(importDialog)}>
              استيراد CSV
            </button>
          </>
        )
      }
    >
      {rows.length ? (
        <Table heads={['اسم المورد', 'السجل التجاري', 'IBAN', 'التواصل', 'الحالة', '']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <b>{r.name}</b>
              </td>
              <td className="mono">{r.cr}</td>
              <td className="mono">{r.iban || '—'}</td>
              <td>
                {r.phone || '—'}
                <small>{r.email}</small>
              </td>
              <td>{r.active ? 'نشط' : 'موقوف'}</td>
              <td>
                {editor && (
                  <div className="actions">
                    <button className="link" onClick={() => w.open(form(r))}>
                      تعديل
                    </button>
                    <button
                      className="link danger"
                      onClick={() => {
                        if (confirm('يُحذف المورد غير المستخدم، ويُعطّل إذا كان مرتبطاً بمعاملات. متابعة؟'))
                          w.task(() => w.api(w.root('suppliers/' + r.id), 'DELETE', {}));
                      }}
                    >
                      حذف / تعطيل
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text="لا يوجد موردون بعد" />
      )}
    </Panel>
  );
}

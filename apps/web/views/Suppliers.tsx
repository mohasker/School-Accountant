'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel, Table } from '../components/ui';
import type { Row } from '../lib/api';
import { parseCsv } from '../lib/format';
import { useLoad } from '../components/useLoad';
import { cardFields, cardPayload } from './SupplierBank';

export function Suppliers() {
  const w = useWorkspace();
  const rows: Row[] = w.setup.suppliers || [];
  const editor = w.can('ACCOUNTANT', 'ADMIN');
  const [bank] = useLoad<Row[]>(() => (editor ? w.api('admin/supplier-bank') : null));
  const mine = new Set(rows.map((r) => r.cardId));
  const available = (bank ?? []).filter((c) => !mine.has(c.id));
  /** The school copy carries the document fields; the full card (contacts, bank, note) lives in the supplier bank. */
  const form = (r?: Row): Dialog => ({
    title: r ? 'تعديل المورد' : 'إضافة مورد جديد',
    intro: <p>تُحفظ البيانات الكاملة في بنك الموردين المشترك، وتظهر هنا نسخة المدرسة المستخدمة في المستندات.</p>,
    fields: cardFields(r?.card ?? r),
    save: async (v) => {
      const card = cardPayload(v, true);
      const copy = { name: card.name, cr: card.cr, iban: card.iban, phone: card.mobile || card.phone, email: card.email };
      const saved = await w.api(w.root('suppliers' + (r ? '/' + r.id : '')), r ? 'PATCH' : 'POST', {
        ...copy,
        ...(r ? { version: r.version, active: r.active } : {}),
      });
      if (saved?.cardId) await w.api('admin/supplier-bank/' + saved.cardId, 'PATCH', card);
    },
  });
  const pickDialog: Dialog = {
    title: 'إضافة مورد من بنك الموردين',
    intro: <p>اختر المورد لتُنسخ بياناته إلى مدرستك؛ أي تعديل لاحق في البنك ينعكس هنا.</p>,
    fields: [
      {
        name: 'cardId',
        label: 'المورد',
        type: 'select',
        options: available.map((c) => ({
          value: c.id,
          label: c.name + (c.cr ? ` — ${c.cr}` : '') + (c.category ? ` (${c.category})` : ''),
        })),
      },
    ],
    save: (v) => w.api(w.root('supplier-from-bank'), 'POST', { cardId: v.cardId }),
  };
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
            <button
              onClick={() => w.open(pickDialog)}
              disabled={!available.length}
              title={available.length ? '' : 'كل موردي البنك مضافون بالفعل'}
            >
              ＋ من بنك الموردين
            </button>
            <button className="secondary" onClick={() => w.open(form())}>
              ＋ مورد جديد
            </button>
            <button className="secondary" onClick={() => w.go('supplier-bank')}>
              فتح بنك الموردين
            </button>
            <button
              className="secondary"
              title="الموردون الواردون في شيت شهادة الإنجاز وشيت التكليف؛ يُضاف الناقص فقط"
              onClick={() =>
                w.task(async () => {
                  const r = await w.api(w.root('supplier-standard'), 'POST', {});
                  if (!r.added) throw Error('كل موردي الشيتات موجودون بالفعل');
                }, 'أُضيف موردو الشيتات الناقصون')
              }
            >
              إضافة موردي الشيتات
            </button>
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
                {r.card?.contact && <div>{r.card.contact}</div>}
                {r.card?.mobile || r.phone || '—'}
                {r.card?.phone && r.card.phone !== (r.card.mobile || r.phone) && <small>{r.card.phone}</small>}
                <small>{r.card?.email || r.email}</small>
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

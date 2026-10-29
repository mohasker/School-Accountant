'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

/** Shared notes (general entries, settlements, depreciation…): everyone reads, the administrator edits. */
export function Notes() {
  const w = useWorkspace();
  const admin = w.me.user.isTenantAdmin;
  const [notes] = useLoad<Row[]>(() => w.api('admin/notes'));

  const dialog = (n?: Row): Dialog => ({
    title: n ? 'تعديل الملاحظة' : 'ملاحظة جديدة',
    wide: true,
    fields: [
      { name: 'title', label: 'العنوان', value: n?.title },
      { name: 'category', label: 'التصنيف (مثل: قيود عامة، تسويات، إهلاكات)', value: n?.category, required: false },
      { name: 'sort', label: 'الترتيب', type: 'number', step: '1', value: n?.sort ?? 0 },
      { name: 'body', label: 'النص', type: 'textarea', value: n?.body },
    ],
    save: (v) => w.api('admin/notes' + (n ? '/' + n.id : ''), n ? 'PATCH' : 'POST', { ...v, sort: Number(v.sort || 0) }),
  });

  const groups = new Map<string, Row[]>();
  for (const n of notes || []) groups.set(n.category || 'عام', [...(groups.get(n.category || 'عام') || []), n]);

  return (
    <Panel title="الملاحظات العامة والقيود المساعدة" actions={admin && <button onClick={() => w.open(dialog())}>＋ ملاحظة</button>}>
      <p>مرجع مشترك لكل المحاسبين: القيود العامة للتسويات، الإهلاكات، وما يلزم تذكره. يحرره مسؤول النظام ويطلع عليه الجميع.</p>
      {notes && !notes.length && <Empty text="لا توجد ملاحظات بعد" />}
      {[...groups.entries()].map(([cat, rows]) => (
        <section key={cat} className="notes-group">
          <h3>{cat}</h3>
          {rows.map((n) => (
            <article key={n.id} className="note">
              <div className="note-head">
                <b>{n.title}</b>
                {admin && (
                  <span className="actions">
                    <button className="link" onClick={() => w.open(dialog(n))}>
                      تعديل
                    </button>
                    <button
                      className="link danger"
                      onClick={() =>
                        w.open({
                          title: 'حذف الملاحظة',
                          intro: <p>{n.title}</p>,
                          fields: [{ name: 'confirm', label: 'اكتب كلمة «حذف» للتأكيد' }],
                          submit: 'حذف',
                          save: async (v) => {
                            if (v.confirm !== 'حذف') throw Error('اكتب كلمة حذف للتأكيد');
                            await w.api('admin/notes/' + n.id, 'DELETE');
                          },
                        })
                      }
                    >
                      حذف
                    </button>
                  </span>
                )}
              </div>
              <pre className="note-body">{n.body}</pre>
            </article>
          ))}
        </section>
      ))}
    </Panel>
  );
}

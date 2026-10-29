'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { Supervision } from './Supervision';

/**
 * The ministry's financial supervisors (المراقب المالي): any account (create it with «حساب جديد») is given
 * the schools it audits, read-only; its screen groups those schools by accountant.
 */
export function SupervisorsPanel() {
  const w = useWorkspace();
  const [users] = useLoad<Row[]>(() => w.api('admin/supervisors'));
  const [schools] = useLoad<Row[]>(() => w.api('admin/schools'));
  const [preview, setPreview] = useState<Row | null>(null);
  if (!users || !schools) return null;
  const supervisors = users.filter((u) => u.schools.length);

  const assign = (u: Row): Dialog => ({
    title: 'مدارس المراقب المالي — ' + u.name,
    wide: true,
    intro: (
      <p>
        اختر المدارس التي يراجعها هذا الحساب (اطلاع فقط مع تسجيل المرتجعات والملاحظات). تظهر له في «لوحة المراقب المالي» مجمّعة حسب المحاسب.
        الأدوار الأخرى للحساب في أي مدرسة لا تتغير.
      </p>
    ),
    body: (
      <div className="check-grid">
        <label className="check">
          <input
            type="checkbox"
            onChange={(e) =>
              e.currentTarget.form
                ?.querySelectorAll<HTMLInputElement>('input[name^="s_"]')
                .forEach((x) => (x.checked = e.currentTarget.checked))
            }
          />
          <b>تحديد الكل</b>
        </label>
        {schools.map((s) => (
          <label key={s.id} className="check">
            <input type="checkbox" name={'s_' + s.id} defaultChecked={u.schools.includes(s.id)} />
            {s.name}
          </label>
        ))}
      </div>
    ),
    submit: 'حفظ المدارس',
    save: (_v, form) =>
      w.api(`admin/users/${u.id}/supervise`, 'POST', {
        schoolIds: [...form.keys()].filter((k) => k.startsWith('s_')).map((k) => k.slice(2)),
      }),
  });

  const pick: Dialog = {
    title: 'تعيين مراقب مالي',
    intro: <p>اختر الحساب (أنشئه أولاً من «حساب جديد» إن لم يكن موجوداً)، ثم حدد مدارسه.</p>,
    fields: [
      {
        name: 'user',
        label: 'الحساب',
        type: 'select',
        options: users.filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.name} (${u.username})` })),
      },
    ],
    submit: 'التالي: المدارس',
    save: async (v) => {
      const u = users.find((x) => x.id === v.user);
      if (u) setTimeout(() => w.open(assign(u)), 50);
    },
  };

  if (preview)
    return (
      <Panel
        title={'معاينة لوحة المراقب المالي — ' + preview.name}
        actions={
          <button className="secondary" onClick={() => setPreview(null)}>
            رجوع
          </button>
        }
      >
        <Supervision userId={preview.id} />
      </Panel>
    );

  return (
    <Panel title="المراقبون الماليون (الوزارة)" actions={<button onClick={() => w.open(pick)}>＋ تعيين مراقب مالي</button>}>
      <p>حساب اطلاع على مجموعة مدارس (30 أو أكثر) يرى إجماليات كل محاسب ونتائج مدارسه، ويسجل المرتجعات والملاحظات دون أي تعديل مالي.</p>
      {supervisors.length ? (
        <Table heads={['المراقب', 'اسم الدخول', 'عدد المدارس', '']}>
          {supervisors.map((u) => (
            <tr key={u.id}>
              <td>
                <b>{u.name}</b>
              </td>
              <td className="mono">{u.username}</td>
              <td>{u.schools.length}</td>
              <td>
                <button className="link" onClick={() => w.open(assign(u))}>
                  المدارس
                </button>{' '}
                <button className="link" onClick={() => setPreview(u)}>
                  معاينة لوحته
                </button>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="muted">لا يوجد مراقب مالي بعد.</p>
      )}
    </Panel>
  );
}

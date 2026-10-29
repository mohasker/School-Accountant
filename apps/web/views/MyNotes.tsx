'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

const COLORS = ['yellow', 'pink', 'blue', 'green'];
const when = (v: string) => new Date(v).toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: '2-digit' });

/** The accountant's own notepad beside the home screen: quick notes to follow up, ticked off when done. */
export function MyNotes() {
  const w = useWorkspace();
  const [d, reload] = useLoad<Row>(() => w.api('admin/my-notes'));
  const [text, setText] = useState('');
  const [color, setColor] = useState('yellow');
  const [showDone, setShowDone] = useState(false);
  const call = async (path: string, method: string, body?: unknown) => {
    try {
      await w.api(path, method, body);
      reload();
    } catch (e) {
      w.fail(e);
    }
  };
  const add = async () => {
    if (!text.trim()) return;
    await call('admin/my-notes', 'POST', { text: text.trim(), color, ...(w.school ? { schoolId: w.school } : {}) });
    setText('');
  };
  const schoolName = (id?: string) => (id ? w.me.schools.find((s: Row) => s.id === id)?.name : '');
  return (
    <aside className="notepad" aria-label="ملاحظاتي">
      <header>
        <b>✎ ملاحظاتي</b>
        <small>للمتابعة والتذكير — تظهر لك وحدك</small>
      </header>
      <div className={'note-new c-' + color}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب ملاحظة أو متعلقات للعمل… (Ctrl + Enter للحفظ)"
          rows={3}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && add()}
        />
        <div className="note-tools">
          <span className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={'sw c-' + c + (c === color ? ' on' : '')}
                title="لون الورقة"
                onClick={() => setColor(c)}
              />
            ))}
          </span>
          <button type="button" disabled={!text.trim()} onClick={add}>
            إضافة
          </button>
        </div>
      </div>
      <div className="notes-list">
        {!d ? null : d.open.length ? (
          d.open.map((n: Row) => (
            <article key={n.id} className={'sticky c-' + n.color + (n.pinned ? ' pinned' : '')}>
              <p>{n.text}</p>
              <footer>
                <small>
                  {when(n.createdAt)}
                  {schoolName(n.schoolId) ? ' · ' + schoolName(n.schoolId) : ''}
                </small>
                <span>
                  <button
                    type="button"
                    className="icon"
                    title={n.pinned ? 'إلغاء التثبيت' : 'تثبيت أعلى القائمة'}
                    onClick={() => call('admin/my-notes/' + n.id, 'PATCH', { pinned: !n.pinned })}
                  >
                    {n.pinned ? '📌' : '📍'}
                  </button>
                  <button type="button" className="icon" title="تم" onClick={() => call('admin/my-notes/' + n.id, 'PATCH', { done: true })}>
                    ✓
                  </button>
                  <button
                    type="button"
                    className="icon"
                    title="حذف"
                    onClick={() => confirm('حذف الملاحظة؟') && call('admin/my-notes/' + n.id, 'DELETE')}
                  >
                    ✕
                  </button>
                </span>
              </footer>
            </article>
          ))
        ) : (
          <p className="notes-empty">لا توجد ملاحظات مفتوحة.</p>
        )}
      </div>
      {d?.done.length > 0 && (
        <div className="notes-done">
          <button type="button" className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'إخفاء المنجز ▴' : `المنجز (${d.done.length}) ▾`}
          </button>
          {showDone &&
            d.done.map((n: Row) => (
              <p key={n.id}>
                <s>{n.text}</s>{' '}
                <button type="button" className="link" onClick={() => call('admin/my-notes/' + n.id, 'PATCH', { done: false })}>
                  إرجاع
                </button>
              </p>
            ))}
        </div>
      )}
    </aside>
  );
}

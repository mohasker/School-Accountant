'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';

/** Administrator: the departments a certificate or covering letter may be addressed to. */
export function AddresseesPanel() {
  const w = useWorkspace();
  const [list] = useLoad<string[]>(() => w.api('admin/addressees'));
  const [draft, setDraft] = useState('');
  if (!list) return null;
  const save = (next: string[]) => w.task(() => w.api('admin/addressees', 'POST', { list: next }), 'حُفظت قائمة الجهات');
  return (
    <Panel title="الجهات المرسل إليها (شهادة الإنجاز وكتاب التغطية)">
      <p>
        <small>يختار المحاسب الجهة من هذه القائمة عند إصدار الشهادة والتغطية. أضف أي جهة جديدة هنا لتظهر للجميع.</small>
      </p>
      <ol>
        {list.map((a, i) => (
          <li key={a}>
            {a}{' '}
            {list.length > 1 && (
              <button className="link danger" onClick={() => confirm(`حذف «${a}» من القائمة؟`) && save(list.filter((_, j) => j !== i))}>
                حذف
              </button>
            )}
          </li>
        ))}
      </ol>
      <form
        className="toolbar wrap"
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (v.length < 2 || list.includes(v)) return;
          save([...list, v]).then(() => setDraft(''));
        }}
      >
        <input
          placeholder="جهة جديدة، مثل: إدارة الشؤون الإدارية"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <button type="submit" disabled={w.busy}>
          ＋ إضافة جهة
        </button>
      </form>
    </Panel>
  );
}

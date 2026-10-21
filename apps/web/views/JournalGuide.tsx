'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { APP_NAME, APP_TITLE } from '../lib/brand';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One entry as a small journal: debit lines first, then credit lines (indented), as written by hand. */
function Entry({ g }: { g: Row }) {
  const lines: Row[] = g.lines ?? [];
  return (
    <table className="journal">
      <thead>
        <tr>
          <th>الحساب</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        {[...lines.filter((l) => l.side === 'D'), ...lines.filter((l) => l.side === 'C')].map((l, i) => (
          <tr key={i} className={l.side === 'C' ? 'cr' : 'dr'}>
            <td>
              {l.side === 'D' ? 'من ' : 'إلى '}
              {l.account}
            </td>
            <td>{l.amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Guidance journal entries (القيود الاسترشادية): depreciation, imprests, assets, corrections… for the
 * accountant's reference; the administrator adds and edits them. Nothing here is posted.
 */
export function JournalGuide() {
  const w = useWorkspace();
  const [rows] = useLoad<Row[]>(() => w.api('admin/journal-guide'));
  const [cat, setCat] = useState('');
  const admin = w.me.user.isTenantAdmin;
  if (!rows) return <p>جارٍ التحميل…</p>;
  const cats = [...new Set(rows.map((r) => r.category))];
  const shown = rows.filter((r) => !cat || r.category === cat);

  const edit = (g?: Row): Dialog => ({
    title: g ? 'تعديل القيد' : 'قيد استرشادي جديد',
    wide: true,
    intro: (
      <p>
        اكتب كل طرف في سطر: يبدأ بـ «من» للمدين أو «إلى» للدائن، ثم «|» والمبلغ أو طريقة حسابه. مثال: من حـ/ مصروف الإهلاك | قسط الإهلاك
      </p>
    ),
    fields: [
      { name: 'title', label: 'عنوان القيد', value: g?.title },
      { name: 'category', label: 'التصنيف (مثل: الأصول والإهلاك)', value: g?.category ?? cat },
      { name: 'usage', label: 'متى يُستخدم', value: g?.usage, required: false },
      {
        name: 'lines',
        label: 'أطراف القيد',
        type: 'textarea',
        value: (g?.lines ?? [])
          .map((l: Row) => `${l.side === 'D' ? 'من' : 'إلى'} ${l.account}${l.amount ? ' | ' + l.amount : ''}`)
          .join('\n'),
      },
      { name: 'note', label: 'ملاحظة / طريقة الحساب', type: 'textarea', value: g?.note, required: false },
    ],
    save: (v) => {
      const lines = String(v.lines)
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const side = x.startsWith('إلى') ? 'C' : 'D';
          const [account, amount = ''] = x.replace(/^(من|إلى)\s*/, '').split('|');
          return { side, account: account.trim(), amount: amount.trim() };
        });
      const body = { title: v.title, category: v.category, usage: v.usage ?? '', lines, note: v.note ?? '', sort: g?.sort ?? rows.length };
      return w.api('admin/journal-guide' + (g ? '/' + g.id : ''), g ? 'PATCH' : 'POST', body);
    },
  });

  const print = () =>
    w.printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>القيود الاسترشادية</title>
<style>@page{size:A4;margin:12mm}body{font-family:Calibri,Arial,sans-serif;font-size:10.5pt;color:#1c1c1c}h1{font-size:16pt;color:#6b1530;margin:0 0 2mm}
h2{font-size:12pt;color:#fff;background:#6b1530;padding:1.5mm 3mm;margin:5mm 0 2mm}.e{break-inside:avoid;border:1px solid #e3d3d9;border-radius:2mm;padding:2.5mm 3.5mm;margin-bottom:3mm}
.e b{color:#6b1530}.u{color:#555;font-size:9.5pt;margin:1mm 0}table{width:100%;border-collapse:collapse;margin:1.5mm 0}td{border-bottom:1px solid #eee;padding:1.2mm}
tr.cr td:first-child{padding-right:12mm}.n{font-size:9pt;color:#444;background:#faf6f7;padding:1.5mm 2.5mm}.foot{color:#888;font-size:8.5pt}</style></head><body>
<h1>القيود الاسترشادية</h1><p class="foot">${esc(APP_NAME)} · ${esc(APP_TITLE)} — للاسترشاد فقط؛ دليل الحسابات المعتمد وتعاميم الوزارة هي المرجع.</p>
${cats
  .filter((c) => !cat || c === cat)
  .map(
    (c) =>
      `<h2>${esc(c)}</h2>` +
      rows
        .filter((r) => r.category === c)
        .map(
          (g) =>
            `<div class="e"><b>${esc(g.title)}</b>${g.usage ? `<p class="u">${esc(g.usage)}</p>` : ''}<table>${[
              ...g.lines.filter((l: Row) => l.side === 'D'),
              ...g.lines.filter((l: Row) => l.side === 'C'),
            ]
              .map(
                (l: Row) =>
                  `<tr class="${l.side === 'C' ? 'cr' : ''}"><td>${l.side === 'D' ? 'من' : 'إلى'} ${esc(l.account)}</td><td>${esc(l.amount)}</td></tr>`,
              )
              .join('')}</table>${g.note ? `<p class="n">${esc(g.note)}</p>` : ''}</div>`,
        )
        .join(''),
  )
  .join('')}</body></html>`);

  return (
    <Panel
      title="القيود الاسترشادية"
      actions={
        <>
          <button className="secondary" onClick={print}>
            طباعة
          </button>
          {admin && <button onClick={() => w.open(edit())}>＋ قيد جديد</button>}
        </>
      }
    >
      <p>
        قيود مساعدة للاسترشاد عند إعداد القيود يدوياً (الإهلاك، العهد، الأصول، التسويات). لا تُرحّل في النظام؛{' '}
        <b>دليل الحسابات المعتمد وتعاميم الوزارة هي المرجع</b>.{admin ? ' مدير النظام يضيف ويعدّل القيود.' : ''}
      </p>
      <div className="chips">
        <button type="button" className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>
          الكل ({rows.length})
        </button>
        {cats.map((c) => (
          <button key={c} type="button" className={'chip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
            {c} ({rows.filter((r) => r.category === c).length})
          </button>
        ))}
      </div>
      <div className="guide-grid">
        {shown.map((g) => (
          <article key={g.id} className="guide-card">
            <header>
              <span className="tag">{g.category}</span>
              <b>{g.title}</b>
              {admin && (
                <span className="guide-tools">
                  <button className="link" onClick={() => w.open(edit(g))}>
                    تعديل
                  </button>
                  <button
                    className="link danger"
                    onClick={() =>
                      confirm('حذف القيد «' + g.title + '»؟') && w.task(() => w.api('admin/journal-guide/' + g.id, 'DELETE'), 'حُذف القيد')
                    }
                  >
                    حذف
                  </button>
                </span>
              )}
            </header>
            {g.usage && <p className="usage-text">{g.usage}</p>}
            <Entry g={g} />
            {g.note && <p className="guide-note">{g.note}</p>}
          </article>
        ))}
      </div>
    </Panel>
  );
}

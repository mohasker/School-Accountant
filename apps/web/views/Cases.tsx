'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { newCaseDialog } from '../components/dialogs';
import { Badge, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, day, METHOD_NAMES, STATE_NAMES, STATES } from '../lib/format';

export function CaseTable({ rows }: { rows: Row[] }) {
  const w = useWorkspace();
  if (!rows.length) return <Empty />;
  return (
    <Table heads={['المعاملة', 'الموضوع / المورد', 'أمر الشراء', 'المحاسب', 'القيمة', 'الحالة', '']}>
      {rows.map((r) => (
        <tr key={r.id}>
          <td>
            <b className="mono">{r.number}</b>
            <small>{day(r.createdAt)}</small>
          </td>
          <td>
            {r.subject}
            <small>
              {r.supplier?.name || 'لم يحدد المورد'}
              {r.method ? ' · ' + METHOD_NAMES[r.method] : ''}
            </small>
          </td>
          <td className="mono">{r.orderNumber || '—'}</td>
          <td>{r.accountantName}</td>
          <td>
            {currency(r.total)} <small>ر.ق</small>
          </td>
          <td>
            <Badge state={r.state} />
          </td>
          <td>
            <button className="link" onClick={() => w.go('case', r.id)}>
              فتح ←
            </button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function Cases() {
  const w = useWorkspace();
  const [q, setQ] = useState(''),
    [state, setState] = useState(''),
    [search, setSearch] = useState('');
  const [rows] = useLoad<Row[]>(
    () => w.api(w.root(`cases?year=${w.year}&q=${encodeURIComponent(search)}${state ? '&state=' + state : ''}`)),
    [search, state],
  );
  return (
    <Panel title="المعاملات" actions={w.can('ACCOUNTANT') && <button onClick={() => w.open(newCaseDialog(w))}>＋ معاملة جديدة</button>}>
      <div className="toolbar">
        <input
          placeholder="رقم المعاملة أو أمر الشراء أو الشهادة أو الفاتورة أو المورد…"
          aria-label="بحث المعاملات"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSearch(q)}
        />
        <select aria-label="الحالة" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">كل الحالات</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_NAMES[s]}
            </option>
          ))}
        </select>
        <button onClick={() => setSearch(q)}>بحث</button>
      </div>
      <CaseTable rows={rows || []} />
      <small>يعرض حتى 500 نتيجة؛ استخدم البحث لتحديد النتائج.</small>
    </Panel>
  );
}

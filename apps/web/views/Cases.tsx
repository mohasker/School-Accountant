'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Select } from '../components/Select';
import { caseDialogs } from './CaseDetail';
import { useWorkspace } from '../components/context';
import { newCaseDialog } from '../components/dialogs';
import { Badge, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, day, METHOD_NAMES, STATE_NAMES, STATES } from '../lib/format';

/** Quick actions of a file in the list: its next step, and reprint of every document already issued. */
function RowActions({ r }: { r: Row }) {
  const w = useWorkspace();
  const [open, setOpen] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  // The menu is drawn over the page (not inside the scrolling table) so it is never cut off.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'mousedown' && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(null);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const toggle = () => {
    if (open || !btn.current) return setOpen(null);
    const b = btn.current.getBoundingClientRect();
    const up = window.innerHeight - b.bottom < 60 + docs.length * 44;
    setOpen({ top: up ? b.top - 4 : b.bottom + 4, left: Math.max(8, Math.min(b.left, window.innerWidth - 210)), up });
  };
  const cert = r.certificates?.[0];
  const docs = [
    r.evaluationHtml && { label: 'تقرير عروض الأسعار', path: w.root(`cases/${r.id}/report-print`) },
    r.orderHtml && { label: 'كتاب التكليف', path: w.root(`cases/${r.id}/order-print`) },
    cert && { label: 'شهادة الإنجاز', path: w.root('certificates/' + cert.id) },
    cert && { label: 'كتاب التغطية', path: w.root(`certificates/${cert.id}/cover`) },
  ].filter(Boolean) as { label: string; path: string }[];
  const step =
    r.state === 'DRAFT'
      ? { key: 'quotes', label: 'إكمال تقرير العروض' }
      : r.state === 'APPROVED'
        ? { key: 'order', label: 'إعداد التكليف' }
        : ['ORDERED', 'PARTIAL', 'DELIVERED'].includes(r.state)
          ? { key: 'finish', label: 'إعداد الشهادة والتغطية' }
          : null;
  const run = async () => {
    if (!step) return;
    if (r.state === 'DRAFT') return w.go('case', r.id);
    try {
      const full = await w.api(w.root('cases/' + r.id));
      w.open((caseDialogs(w, full) as Row)[step.key]);
    } catch (e) {
      w.fail(e);
    }
  };
  return (
    <div className="row-actions">
      {step && w.can('ACCOUNTANT') && (
        <button className="mini" onClick={run}>
          {step.label}
        </button>
      )}
      {docs.length > 0 && (
        <span className="send">
          <button ref={btn} className="mini secondary" onClick={toggle} aria-expanded={Boolean(open)}>
            ⎙ طباعة ▾
          </button>
          {open &&
            createPortal(
              <span
                ref={menu}
                className="send-menu floating"
                style={{ top: open.top, left: open.left, transform: open.up ? 'translateY(-100%)' : undefined }}
              >
                {docs.map((d) => (
                  <button key={d.label} type="button" onClick={() => (setOpen(null), w.print(d.path))}>
                    {d.label}
                  </button>
                ))}
              </span>,
              document.body,
            )}
        </span>
      )}
      <button className="link" onClick={() => w.go('case', r.id)}>
        فتح ←
      </button>
    </div>
  );
}

export function CaseTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <Empty />;
  return (
    <Table heads={['المعاملة', 'الموضوع / الشركة', 'أمر الشراء', 'القيمة', 'الحالة', 'الإجراءات']}>
      {rows.map((r) => (
        <tr key={r.id}>
          <td>
            <b className="mono">{r.number}</b>
            <small>{day(r.createdAt)}</small>
          </td>
          <td>
            {r.subject}
            <small>
              {r.supplier?.name || 'لم تحدد الشركة'}
              {r.method ? ' · ' + METHOD_NAMES[r.method] : ''}
            </small>
          </td>
          <td className="mono">{r.orderNumber || '—'}</td>
          <td>
            {currency(r.total)} <small>ر.ق</small>
          </td>
          <td>
            <Badge state={r.state} />
          </td>
          <td>
            <RowActions r={r} />
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
    <Panel
      title="المعاملات"
      actions={
        w.can('ACCOUNTANT') && (
          <button data-tour="new-case" onClick={() => w.open(newCaseDialog(w))}>
            ＋ معاملة جديدة
          </button>
        )
      }
    >
      <div className="toolbar" data-tour="search">
        <input
          placeholder="رقم المعاملة أو أمر الشراء أو الشهادة أو الفاتورة أو المورد…"
          aria-label="بحث المعاملات"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSearch(q)}
        />
        <Select
          label="الحالة"
          value={state}
          onChange={setState}
          options={[{ value: '', label: 'كل الحالات' }, ...STATES.map((s) => ({ value: s, label: STATE_NAMES[s] }))]}
        />
        <button onClick={() => setSearch(q)}>بحث</button>
      </div>
      <CaseTable rows={rows || []} />
      <small>يعرض حتى 500 نتيجة؛ استخدم البحث لتحديد النتائج.</small>
    </Panel>
  );
}

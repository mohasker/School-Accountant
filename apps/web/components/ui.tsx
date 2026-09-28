import React from 'react';
import { EVIDENCE_STATUS, STATE_NAMES } from '../lib/format';
import { useWorkspace } from './context';

export function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {heads.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ text = 'لا توجد سجلات في هذا الاختيار' }: { text?: string }) {
  return (
    <div className="empty">
      <span>▤</span>
      <p>{text}</p>
    </div>
  );
}

export function Badge({ state }: { state: string }) {
  return <span className={'badge s-' + state}>{STATE_NAMES[state] || EVIDENCE_STATUS[state] || state}</span>;
}

export function Panel({ title, actions, children }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Screen logo (the letterhead banner is used only on printed documents). */
export function Logo({ variant = 'full' }: { variant?: 'full' | 'emblem' }) {
  return variant === 'emblem' ? (
    <img className="logo emblem" src="/brand/moehe-emblem.png" alt="شعار وزارة التربية والتعليم والتعليم العالي" />
  ) : (
    <img className="logo full" src="/brand/moehe-logo-full.png" alt="وزارة التربية والتعليم والتعليم العالي — دولة قطر" />
  );
}

export function Stat({ label, value, hint, onClick }: { label: string; value: React.ReactNode; hint?: string; onClick?: () => void }) {
  return (
    <button className="metric" onClick={onClick} type="button">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </button>
  );
}

/** Print (browser) and PDF (server-rendered) buttons for a stored document. */
export function DocButtons({ path, label, part, link }: { path: string; label: string; part?: 'cover'; link?: boolean }) {
  const w = useWorkspace();
  const cls = link ? 'link' : 'secondary';
  return (
    <span className="doc-buttons">
      <button
        className={cls}
        onClick={async () => {
          if (!part) return w.print(path);
          try {
            w.printHtml((await w.api(path))[part]);
          } catch (e) {
            w.fail(e);
          }
        }}
      >
        طباعة{label ? ' ' + label : ''}
      </button>
      <button className={cls + ' pdf'} disabled={w.busy} onClick={() => w.pdf(path, part)} title={'تنزيل ' + (label || 'المستند') + ' PDF'}>
        PDF
      </button>
    </span>
  );
}

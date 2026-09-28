import React from 'react';
import { EVIDENCE_STATUS, STATE_NAMES } from '../lib/format';

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

export function Logo({ small }: { small?: boolean }) {
  return (
    <img className={small ? 'logo small' : 'logo'} src="/brand/moehe-logo.png" alt="وزارة التربية والتعليم والتعليم العالي — دولة قطر" />
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

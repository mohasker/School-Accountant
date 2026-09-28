import React, { useState } from 'react';
import { downloadFile, EVIDENCE_STATUS, STATE_NAMES } from '../lib/format';
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

/** Screen logos: the system logo (MOESAS) with the ministry logo; the letterhead banner is used only on printed documents. */
export function Logo({ variant = 'full' }: { variant?: 'full' | 'emblem' | 'system' | 'mark' }) {
  if (variant === 'system') return <img className="logo system" src="/brand/moesas-logo.png" alt="MOESAS — نظام محاسب المدارس" />;
  if (variant === 'mark') return <img className="logo mark" src="/brand/moesas-mark.png" alt="MOESAS" />;
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

/**
 * Document actions: direct print, PDF download, and sending the PDF by e-mail or WhatsApp. On devices
 * that can share files (phones, Windows) the PDF is attached through the system share sheet; otherwise
 * it is downloaded and the e-mail / WhatsApp message opens ready for the file to be attached.
 */
export function DocButtons({ path, label, part, link }: { path: string; label: string; part?: 'cover'; link?: boolean }) {
  const w = useWorkspace();
  const [open, setOpen] = useState(false);
  const cls = link ? 'link' : 'secondary';
  const title = label || 'المستند';
  const send = async (via: 'mail' | 'whatsapp') => {
    setOpen(false);
    try {
      const file = await w.api(path + (path.includes('?') ? '&' : '?') + 'pdf=1' + (part ? '&part=' + part : ''));
      const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
      const pdf = new File([bytes], file.name, { type: 'application/pdf' });
      const text = `${title} — ${file.name.replace(/\.pdf$/, '')}`;
      if (navigator.canShare?.({ files: [pdf] })) {
        await navigator.share({ files: [pdf], title: text, text });
        return;
      }
      downloadFile(file);
      const note = `${text}\n(الملف المرفق: ${file.name})`;
      window.open(
        via === 'mail'
          ? `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(note)}`
          : `https://wa.me/?text=${encodeURIComponent(note)}`,
        '_blank',
      );
    } catch (e: any) {
      if (e?.name !== 'AbortError') w.fail(e);
    }
  };
  return (
    <span className="doc-buttons">
      <button
        className={cls}
        title={'طباعة ' + title}
        onClick={async () => {
          if (!part) return w.print(path);
          try {
            w.printHtml((await w.api(path))[part]);
          } catch (e) {
            w.fail(e);
          }
        }}
      >
        ⎙ طباعة{label ? ' ' + label : ''}
      </button>
      <button className={cls + ' pdf'} disabled={w.busy} onClick={() => w.pdf(path, part)} title={'تنزيل ' + title + ' PDF'}>
        PDF
      </button>
      <span className="send">
        <button className={cls + ' send-btn'} onClick={() => setOpen((o) => !o)} aria-expanded={open} title={'إرسال ' + title}>
          إرسال ▾
        </button>
        {open && (
          <span className="send-menu" onMouseLeave={() => setOpen(false)}>
            <button type="button" onClick={() => send('mail')}>
              ✉ بالبريد الإلكتروني
            </button>
            <button type="button" onClick={() => send('whatsapp')}>
              ◉ عبر واتساب
            </button>
          </span>
        )}
      </span>
    </span>
  );
}

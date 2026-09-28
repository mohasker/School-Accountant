import React from 'react';
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
  if (variant === 'system') return <img className="logo system" src="/brand/moesas-logo.png" alt="MOESAS — نظام محاسبي المدارس الحكومية" />;
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
  const cls = link ? 'link' : 'secondary';
  const title = label || 'المستند';
  const send = async (via: 'mail' | 'whatsapp') => {
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
      <button className={cls + ' mail-btn'} onClick={() => send('mail')} title={'إرسال ' + title + ' بالبريد الإلكتروني'}>
        ✉ بريد
      </button>
      <button className={cls + ' wa-btn'} onClick={() => send('whatsapp')} title={'إرسال ' + title + ' عبر واتساب'}>
        <WhatsAppIcon /> واتساب
      </button>
    </span>
  );
}

/** WhatsApp mark in its green, for the send buttons. */
export function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="wa-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#25D366" d="M16 2.6A13.4 13.4 0 0 0 4.4 22.7L2.6 29.4l6.9-1.8A13.4 13.4 0 1 0 16 2.6z" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        d="M16 5.6a10.4 10.4 0 0 0-8.9 15.8l.3.5-1.1 4 4.1-1.1.5.3A10.4 10.4 0 1 0 16 5.6z"
      />
      <path
        fill="#fff"
        d="M12.3 10.4c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1 .5-.4.4-1.4 1.3-1.4 3.2s1.4 3.7 1.6 4c.2.2 2.7 4.3 6.6 5.8 3.3 1.3 4 1 4.7.9.7-.1 2.3-.9 2.6-1.9.3-.9.3-1.7.2-1.9-.1-.2-.3-.3-.7-.5l-2.6-1.2c-.3-.1-.6-.2-.8.2-.2.4-.9 1.2-1.2 1.4-.2.2-.4.3-.8.1-.4-.2-1.6-.6-3.1-1.9-1.1-1-1.9-2.3-2.1-2.7-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3 0-.5 0-.7l-1.2-2.8z"
      />
    </svg>
  );
}

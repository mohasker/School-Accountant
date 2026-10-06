'use client';
import React, { useEffect, useRef, useState } from 'react';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAYS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const todayIso = () => {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
};
/** ISO (yyyy-mm-dd) → dd/mm/yyyy for display. */
export const showDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : v);
/** Typed dd/mm/yyyy (Arabic or English digits, any separator) → ISO, or '' when not a full valid date. */
export function parseTyped(raw: string) {
  const t = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  let m = t.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{4})$/);
  let y: number, mo: number, d: number;
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return '';
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? iso(y, mo - 1, d) : '';
}

const Chevron = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
  </svg>
);

/**
 * Date box with an Arabic calendar: shows dd/mm/yyyy, accepts a typed date in any digits, and opens a
 * month grid with «اليوم». Inside a form it submits the ISO value through a hidden input named `name`.
 */
export function DateInput({
  name,
  value,
  defaultValue,
  onChange,
  required,
  min,
  max,
  placeholder = 'يوم/شهر/سنة',
  ariaLabel,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  required?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const [text, setText] = useState(showDate(current));
  const [open, setOpen] = useState(false);
  const base = current || todayIso();
  const [view, setView] = useState({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setText(showDate(current)), [current]);
  useEffect(() => {
    if (!open) return;
    const b = current || todayIso();
    setView({ y: Number(b.slice(0, 4)), m: Number(b.slice(5, 7)) - 1 });
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const set = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
  };
  const commitText = () => {
    const v = parseTyped(text);
    if (v) set(v);
    else if (!text.trim()) set('');
    else setText(showDate(current));
  };
  const first = new Date(view.y, view.m, 1).getDay();
  const count = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  const disabled = (d: string) => (min && d < min) || (max && d > max);
  const move = (n: number) => setView((v) => ({ y: v.y + Math.floor((v.m + n) / 12), m: (((v.m + n) % 12) + 12) % 12 }));
  const t = todayIso();
  return (
    <div className={'date' + (open ? ' open' : '')} ref={box}>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      <div className="date-field">
        <input
          className="date-text"
          value={text}
          placeholder={placeholder}
          inputMode="numeric"
          aria-label={ariaLabel}
          required={required && !current}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), commitText());
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <button type="button" className="date-btn" aria-label="فتح التقويم" onClick={() => setOpen((o) => !o)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2.5" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="date-pop" role="dialog" aria-label="التقويم">
          <div className="date-head">
            <button type="button" className="date-nav" onClick={() => move(1)} aria-label="الشهر التالي">
              <Chevron dir="left" />
            </button>
            <b>
              {MONTHS[view.m]} {view.y}
            </b>
            <button type="button" className="date-nav" onClick={() => move(-1)} aria-label="الشهر السابق">
              <Chevron dir="right" />
            </button>
          </div>
          <div className="date-grid">
            {DAYS.map((d) => (
              <span key={d} className="dn">
                {d}
              </span>
            ))}
            {cells.map((d, i) => {
              if (!d) return <span key={'e' + i} />;
              const v = iso(view.y, view.m, d);
              return (
                <button
                  type="button"
                  key={v}
                  className={
                    (v === current ? 'on ' : '') + (v === t ? 'today ' : '') + (new Date(view.y, view.m, d).getDay() >= 5 ? 'we' : '')
                  }
                  disabled={Boolean(disabled(v))}
                  onClick={() => (set(v), setOpen(false))}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="date-foot">
            <button type="button" className="link" onClick={() => (set(t), setOpen(false))}>
              اليوم
            </button>
            {current && (
              <button type="button" className="link" onClick={() => (set(''), setOpen(false))}>
                مسح
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

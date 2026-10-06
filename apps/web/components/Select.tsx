'use client';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export type Option = { value: string; label: string; hint?: string };

/**
 * Drop-down list used everywhere instead of the native <select>: the whole field opens the list, it
 * animates in, filters as you type when the list is long, and works with the keyboard. Inside a form
 * it submits its value through a hidden input named `name`.
 */
export function Select({
  name,
  options,
  value,
  defaultValue,
  onChange,
  placeholder = 'اختر…',
  required,
  label,
  className = '',
}: {
  name?: string;
  options: Option[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  label?: string;
  className?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? '');
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const searchable = options.length > 8;
  const shown = useMemo(
    () => (query ? options.filter((o) => (o.label + ' ' + (o.hint ?? '')).toLowerCase().includes(query.toLowerCase())) : options),
    [query, options],
  );
  const selected = options.find((o) => o.value === current);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(
        Math.max(
          0,
          options.findIndex((o) => o.value === current),
        ),
      );
    }
  }, [open]);

  const pick = (v: string) => {
    if (value === undefined) setInner(v);
    onChange?.(v);
    setOpen(false);
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => Math.min(shown.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (shown[active]) pick(shown[active].value);
    } else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={'select ' + className + (open ? ' open' : '')} ref={box} onKeyDown={key}>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        className="select-field"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? '' : 'placeholder'}>{selected?.label ?? placeholder}</span>
        <i className="chevron" aria-hidden="true" />
      </button>
      {required && !current && <input className="select-required" tabIndex={-1} required value="" onChange={() => {}} aria-hidden="true" />}
      {open && (
        <div className="select-pop" role="listbox" id={listId} onClick={(e) => e.preventDefault()}>
          {searchable && (
            <input
              className="select-search"
              autoFocus
              placeholder="بحث…"
              value={query}
              onChange={(e) => (setQuery(e.target.value), setActive(0))}
            />
          )}
          <div className="select-list">
            {shown.map((o, i) => (
              <button
                type="button"
                role="option"
                aria-selected={o.value === current}
                key={o.value}
                className={(o.value === current ? 'on ' : '') + (i === active ? 'active' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                style={{ animationDelay: `${Math.min(i, 12) * 14}ms` }}
              >
                <span>{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
              </button>
            ))}
            {!shown.length && <p className="select-empty">لا نتائج</p>}
          </div>
        </div>
      )}
    </div>
  );
}

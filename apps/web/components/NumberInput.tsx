'use client';
import React from 'react';

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits, the Arabic decimal mark and thousands separators → plain "1234.5". */
export function toNumberText(raw: string, integer = false) {
  let v = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,،]/g, (m) => (m === '٫' ? '.' : ''))
    .replace(/[^\d.]/g, '');
  const dot = v.indexOf('.');
  if (dot >= 0) v = integer ? v.slice(0, dot) : v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  return v;
}

/**
 * Number box typed by hand on any keyboard (Arabic or English digits, «٫» or «.», thousands commas).
 * It is a plain text box — nothing is blocked or rewritten while typing; the value is cleaned when the
 * box is left and again when the form is read (see `toNumberText`).
 */
export function NumberInput({
  integer,
  className = '',
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { integer?: boolean }) {
  return (
    <input
      {...props}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      autoComplete="off"
      className={'num-input ' + className}
      defaultValue={props.defaultValue === undefined || props.defaultValue === null ? undefined : String(props.defaultValue)}
      onBlur={(e) => {
        const el = e.currentTarget,
          clean = toNumberText(el.value, integer);
        if (clean !== el.value) el.value = clean;
      }}
    />
  );
}

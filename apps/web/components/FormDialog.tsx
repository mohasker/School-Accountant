'use client';
import React, { useState } from 'react';
import type { Row } from '../lib/api';

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'password' | 'select' | 'textarea' | 'checkbox';
  value?: unknown;
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
  step?: string;
  min?: string;
};

export type Dialog = {
  title: string;
  intro?: React.ReactNode;
  fields?: Field[];
  /** Extra inputs rendered after the fields; they are submitted with the same form. */
  body?: React.ReactNode;
  wide?: boolean;
  submit?: string;
  save: (values: Row, form: FormData) => Promise<unknown>;
};

export function FormDialog({ dialog, onClose, onSaved }: { dialog: Dialog; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget),
      values: Row = {};
    for (const f of dialog.fields ?? []) values[f.name] = f.type === 'checkbox' ? fd.get(f.name) === 'on' : String(fd.get(f.name) ?? '');
    try {
      await dialog.save(values, fd);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={dialog.title} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form className={dialog.wide ? 'modal wide' : 'modal'} onSubmit={submit}>
        <div className="panel-head">
          <h2>{dialog.title}</h2>
          <button type="button" className="link" aria-label="إغلاق" onClick={onClose}>
            ✕
          </button>
        </div>
        {dialog.intro && <div className="intro">{dialog.intro}</div>}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {!!dialog.fields?.length && (
          <div className="form-grid">
            {dialog.fields.map((f) => (
              <label key={f.name} className={f.type === 'textarea' ? 'span2' : f.type === 'checkbox' ? 'check' : ''}>
                {f.type === 'checkbox' && <input name={f.name} type="checkbox" defaultChecked={Boolean(f.value)} />}
                {f.label}
                {f.type === 'select' ? (
                  <select name={f.name} defaultValue={f.value as string} required={f.required !== false}>
                    {f.options?.map((o) => (
                      <option value={o.value} key={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea name={f.name} defaultValue={f.value as string} required={f.required !== false} rows={3} />
                ) : f.type === 'checkbox' ? null : (
                  <input
                    name={f.name}
                    type={f.type || 'text'}
                    defaultValue={f.value as string}
                    required={f.required !== false}
                    step={f.step ?? (f.type === 'number' ? '0.01' : undefined)}
                    min={f.min ?? (f.type === 'number' ? '0' : undefined)}
                  />
                )}
                {f.help && <small>{f.help}</small>}
              </label>
            ))}
          </div>
        )}
        {dialog.body}
        <div className="modal-actions">
          <button disabled={busy}>{busy ? 'جارٍ الحفظ…' : dialog.submit || 'حفظ ومتابعة'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}

/** Repeating purchase lines (description, unit, quantity, budget line) inside a dialog form. */
export function ItemLines({ budgets }: { budgets: Row[] }) {
  const [count, setCount] = useState(1);
  return (
    <>
      <h3>البنود المطلوبة</h3>
      {Array.from({ length: count }, (_, i) => (
        <div className="item-form" key={i}>
          <input name={'name_' + i} placeholder="وصف الصنف" aria-label="وصف الصنف" required />
          <input name={'unit_' + i} defaultValue="عدد" aria-label="الوحدة" required />
          <input name={'qty_' + i} type="number" min="0.001" step="0.001" placeholder="الكمية" aria-label="الكمية" required />
          <select name={'budget_' + i} aria-label="بند الموازنة">
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => setCount((n) => n + 1)}>
        ＋ صنف آخر
      </button>
    </>
  );
}

export function readItemLines(fd: FormData) {
  const lines = [];
  for (let i = 0; fd.has('name_' + i); i++)
    lines.push({ name: fd.get('name_' + i), unit: fd.get('unit_' + i), qty: fd.get('qty_' + i), budgetId: fd.get('budget_' + i) });
  return lines;
}

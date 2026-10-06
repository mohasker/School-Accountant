'use client';
import React, { useEffect, useRef, useState } from 'react';
import { DateInput } from './DateInput';
import { NumberInput, toNumberText } from './NumberInput';
import { Select } from './Select';
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
  /** id of a <datalist> with suggestions (free text is still accepted). */
  list?: string;
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
  /** A plain summary shown for a last check before an official document is issued; «رجوع» keeps the entries. */
  confirm?: (values: Row, form: FormData) => React.ReactNode;
};

export function FormDialog({ dialog, onClose, onSaved }: { dialog: Dialog; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<{ values: Row; fd: FormData; text: React.ReactNode } | null>(null);
  const confirmBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending) confirmBox.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [pending]);
  async function run(values: Row, fd: FormData) {
    setBusy(true);
    setError('');
    try {
      await dialog.save(values, fd);
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget),
      values: Row = {};
    for (const f of dialog.fields ?? [])
      values[f.name] =
        f.type === 'checkbox'
          ? fd.get(f.name) === 'on'
          : f.type === 'number'
            ? toNumberText(String(fd.get(f.name) ?? ''), f.step === '1')
            : String(fd.get(f.name) ?? '');
    if (dialog.confirm) return setPending({ values, fd, text: dialog.confirm(values, fd) });
    await run(values, fd);
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
        {/* While the summary is shown the entries are locked, so what is confirmed is exactly what is issued. */}
        <fieldset disabled={Boolean(pending)} className="dialog-fields">
          {!!dialog.fields?.length && (
            <div className="form-grid">
              {dialog.fields.map((f) => (
                <label key={f.name} className={f.type === 'textarea' ? 'span2' : f.type === 'checkbox' ? 'check' : ''}>
                  {f.type === 'checkbox' && <input name={f.name} type="checkbox" defaultChecked={Boolean(f.value)} />}
                  {f.label}
                  {f.type === 'select' ? (
                    <Select
                      name={f.name}
                      label={f.label}
                      options={f.options ?? []}
                      defaultValue={f.value as string}
                      required={f.required !== false}
                    />
                  ) : f.type === 'textarea' ? (
                    <textarea name={f.name} defaultValue={f.value as string} required={f.required !== false} rows={3} />
                  ) : f.type === 'checkbox' ? null : f.type === 'date' ? (
                    <DateInput
                      name={f.name}
                      defaultValue={f.value as string}
                      required={f.required !== false}
                      min={f.min}
                      ariaLabel={f.label}
                    />
                  ) : f.type === 'number' ? (
                    <NumberInput name={f.name} defaultValue={f.value as string} required={f.required !== false} integer={f.step === '1'} />
                  ) : (
                    <input
                      name={f.name}
                      type={f.type || 'text'}
                      defaultValue={f.value as string}
                      required={f.required !== false}
                      list={f.list}
                      autoComplete={f.list ? 'off' : undefined}
                    />
                  )}
                  {f.help && <small>{f.help}</small>}
                </label>
              ))}
            </div>
          )}
          {dialog.body}
        </fieldset>
        {pending && (
          <div ref={confirmBox} className="confirm-box" role="alertdialog" aria-label="تأكيد قبل الإصدار">
            <b>راجع قبل الإصدار</b>
            <div>{pending.text}</div>
            <div className="actions">
              <button type="button" disabled={busy} onClick={() => run(pending.values, pending.fd)}>
                {busy ? 'جارٍ الإصدار…' : 'تأكيد وإصدار ✓'}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setPending(null)}>
                رجوع للتعديل
              </button>
            </div>
          </div>
        )}
        <div className="modal-actions" hidden={Boolean(pending)}>
          <button disabled={busy}>{busy ? 'جارٍ الحفظ…' : dialog.submit || 'حفظ ومتابعة'}</button>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}

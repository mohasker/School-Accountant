/**
 * Comparison helpers for the paper-file check: Arabic names are compared after removing what
 * changes between hands and printers (diacritics, alef forms, ta marbuta, spacing, «مدرسة»), numbers
 * and references after unifying digits and separators, amounts to the dirham.
 */

const DIACRITICS = /[ً-ٰٟـ]/g;

export const westernDigits = (v: string) =>
  v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** Arabic or Latin name reduced to its comparable letters. */
export function nameKey(v: string | null | undefined) {
  if (!v) return '';
  return westernDigits(v.normalize('NFKC'))
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\b(w\.?\s?l\.?\s?l|co|company|trading|llc|est)\b\.?/g, ' ')
    .replace(/(^|\s)(مدرسه|مدرسة|شركه|شركة|مؤسسه|مؤسسة)(\s|$)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** 'same' (identical after normalising), 'close' (a spelling difference), or 'different'. */
export function compareNames(paper: string | null | undefined, ...system: (string | null | undefined)[]): 'same' | 'close' | 'different' {
  const p = nameKey(paper);
  if (!p) return 'different';
  let best: 'same' | 'close' | 'different' = 'different';
  for (const s of system) {
    const k = nameKey(s);
    if (!k) continue;
    if (k === p) return 'same';
    const longer = Math.max(k.length, p.length);
    const ratio = 1 - levenshtein(k, p) / longer;
    if (ratio >= 0.85 || (Math.min(k.length, p.length) >= 8 && (k.includes(p) || p.includes(k)))) best = 'close';
  }
  return best;
}

/** Reference or invoice number: upper case, western digits, no spaces. */
export const refKey = (v: string | null | undefined) =>
  westernDigits(String(v ?? ''))
    .toUpperCase()
    .replace(/[\s‎‏]+/g, '')
    .replace(/[\\_]/g, '/');

export function sameRef(paper: string | null | undefined, system: string | null | undefined) {
  const p = refKey(paper),
    s = refKey(system);
  if (!p || !s) return false;
  if (p === s) return true;
  // «No. INV-77» or «رقم: ABAF/2026/007» around the reference.
  return (p.length > s.length && p.includes(s)) || (s.length > p.length && s.length - p.length <= 2 && s.includes(p));
}

export const sameAmount = (a: number | null | undefined, b: number | string | null | undefined) =>
  a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01;

/** YYYY-MM-DD from «03/09/2026», «3-9-2026», «2026/09/03» or «2026-09-03»; null when it is not a date. */
export function isoFrom(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = westernDigits(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso ? iso : null;
}

/** dd/mm/yyyy for the report. */
export const showDate = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '—');
export const showAmount = (v: number | string | null | undefined) =>
  v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

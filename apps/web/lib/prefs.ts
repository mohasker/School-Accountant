/**
 * Per-user screen preferences kept in this browser: text size and the simple menu. Storage can be
 * unavailable (private window); the defaults then apply without an error.
 */
export const FONT_SIZES = [
  { key: 'normal', label: 'عادي', zoom: 1 },
  { key: 'large', label: 'كبير', zoom: 1.12 },
  { key: 'xlarge', label: 'كبير جداً', zoom: 1.25 },
] as const;
export type FontSize = (typeof FONT_SIZES)[number]['key'];

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function loadFontSize(user: string): FontSize {
  const v = get('moesas.font.' + user);
  return FONT_SIZES.some((f) => f.key === v) ? (v as FontSize) : 'normal';
}
export function applyFontSize(size: FontSize) {
  const zoom = FONT_SIZES.find((f) => f.key === size)?.zoom ?? 1;
  (document.documentElement.style as any).zoom = zoom === 1 ? '' : String(zoom);
}
export function saveFontSize(user: string, size: FontSize) {
  set('moesas.font.' + user, size);
  applyFontSize(size);
}

/** The simple menu is on by default for accountants and off for the system administrator. */
export function loadSimpleMenu(user: string, admin: boolean) {
  const v = get('moesas.simple.' + user);
  return v === null ? !admin : v === '1';
}
export function saveSimpleMenu(user: string, on: boolean) {
  set('moesas.simple.' + user, on ? '1' : '0');
}

export const tourSeen = (user: string, view: string) => get('moesas.tour.off') === '1' || get(`moesas.tour.${user}.${view}`) === '1';
export const markTourSeen = (user: string, view: string) => set(`moesas.tour.${user}.${view}`, '1');

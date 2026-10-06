/** Screen colour themes: the main colour (buttons, highlights) and the side-bar colour. Saved per browser. */
export type Theme = { key: string; name: string; primary: string; side: string };

export const THEMES: Theme[] = [
  { key: 'qatar', name: 'العنابي القطري', primary: '#861b3a', side: '#142836' },
  { key: 'navy', name: 'الأزرق الملكي', primary: '#1f4e8c', side: '#0f2238' },
  { key: 'emerald', name: 'الأخضر الزمردي', primary: '#0f766e', side: '#0b2a2a' },
  { key: 'gold', name: 'الذهبي', primary: '#9a6b1f', side: '#2a2118' },
  { key: 'violet', name: 'البنفسجي', primary: '#6d28d9', side: '#1e1336' },
  { key: 'graphite', name: 'الرمادي الداكن', primary: '#374151', side: '#111827' },
];

const STORE = 'moesas-theme';

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function applyTheme(t: Pick<Theme, 'primary' | 'side'>) {
  const root = document.documentElement.style;
  root.setProperty('--wine', t.primary);
  root.setProperty('--wine-dark', shade(t.primary, -0.22));
  root.setProperty('--wine-soft', shade(t.primary, 0.9));
  root.setProperty('--wine-line', shade(t.primary, 0.55));
  root.setProperty('--navy', t.side);
  root.setProperty('--navy-2', shade(t.side, 0.12));
}

export function loadTheme(): Pick<Theme, 'primary' | 'side'> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved?.primary && saved?.side) return saved;
  } catch {}
  return THEMES[0];
}

export function saveTheme(t: Pick<Theme, 'primary' | 'side'>) {
  applyTheme(t);
  try {
    localStorage.setItem(STORE, JSON.stringify({ primary: t.primary, side: t.side }));
  } catch {}
}

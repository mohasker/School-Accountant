/** Distance in metres between two points on the earth (haversine). */
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A sign-in within this distance of a school is shown as «at the school». */
export const NEAR_METRES = 500;

/** The school nearest to a point, among schools whose location was entered; null when none has one. */
export function nearestSchool(
  point: { lat: number | null; lng: number | null },
  schools: { name: string; lat: number | null; lng: number | null }[],
) {
  if (point.lat == null || point.lng == null) return null;
  let best: { name: string; metres: number } | null = null;
  for (const s of schools) {
    if (s.lat == null || s.lng == null) continue;
    const metres = Math.round(distance({ lat: point.lat, lng: point.lng }, { lat: s.lat, lng: s.lng }));
    if (!best || metres < best.metres) best = { name: s.name, metres };
  }
  return best && { ...best, near: best.metres <= NEAR_METRES };
}

/** Device and browser from the user agent, for the administrator's technical report. */
export function deviceOf(ua: string) {
  const device = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone/iPad'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'غير معروف';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'آخر';
  return `${device} · ${browser}`;
}

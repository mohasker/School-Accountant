import { fail } from './validation';

const DAY = 86400000;

/** Today's date in Qatar as YYYY-MM-DD. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Qatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Normalises a Date (stored as @db.Date, i.e. UTC midnight) or ISO string to YYYY-MM-DD. */
export const isoDay = (v: Date | string) => (typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10));

const utc = (d: string) => new Date(d + 'T00:00:00Z');
const shift = (d: string, days: number) => new Date(utc(d).getTime() + days * DAY).toISOString().slice(0, 10);

export function inYear(y: { startDate: Date; endDate: Date }, d: string) {
  if (d < isoDay(y.startDate) || d > isoDay(y.endDate)) fail('التاريخ خارج العام المالي');
}

/**
 * Working-day calendar: weekend days (0 = Sunday … 6 = Saturday; Qatar uses Friday/Saturday)
 * plus the official holidays maintained on the holidays screen.
 */
export class Calendar {
  constructor(
    readonly weekend: number[],
    readonly holidays: Set<string>,
  ) {}

  isWorkingDay(d: string) {
    return !this.weekend.includes(utc(d).getUTCDay()) && !this.holidays.has(d);
  }

  /** Deadline: counts `days` working days after the start date (the start date itself is excluded). */
  addWorkingDays(start: string, days: number) {
    if (!Number.isSafeInteger(days) || days < 0) fail('مدة غير صالحة');
    let d = start,
      counted = 0,
      guard = 0;
    while (counted < days) {
      d = shift(d, 1);
      if (this.isWorkingDay(d)) counted++;
      if (++guard > 3660) fail('تعذر حساب الموعد؛ راجع جدول الإجازات');
    }
    return d;
  }

  /** Delay: working days after `from` up to and including `to`; zero when `to` is not after `from`. */
  workingDaysBetween(from: string, to: string) {
    if (to <= from) return 0;
    let n = 0;
    for (let d = shift(from, 1); d <= to; d = shift(d, 1)) if (this.isWorkingDay(d)) n++;
    return n;
  }
}

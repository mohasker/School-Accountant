import { Prisma } from '@prisma/client';

export const D = Prisma.Decimal;
export type Decimal = Prisma.Decimal;

export const round = (v: Decimal) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Fixed two-decimal string for storage and exports. */
export const num = (v: unknown) => new D(String(v ?? 0)).toFixed(2);

/** Grouped display for printed documents, e.g. 12,500.00 */
export function amount(v: unknown) {
  const [whole, fraction] = num(v).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction;
}

export const sum = (values: Decimal[]) => values.reduce((a, v) => a.plus(v), new D(0));

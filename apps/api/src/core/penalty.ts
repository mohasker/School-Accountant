import { D, round } from '../common/money';
import { fail } from '../common/validation';

export type LatePortion = { value: string; lateDays: number };

/**
 * Delay penalty: `rate` per late working day on the value of each late portion,
 * capped once for the whole order at `cap` × order value. `previous` is the penalty already
 * deducted on earlier certificates, so it is never deducted twice.
 */
export function fine(total: string, portions: LatePortion[], previous = '0', rate = '0.01', cap = '0.10') {
  const order = new D(total),
    old = new D(previous);
  if (!order.isFinite() || order.lte(0) || !old.isFinite() || old.lt(0)) fail('قيمة غير صالحة');
  let value = new D(0),
    raw = new D(0);
  for (const p of portions) {
    const v = new D(p.value);
    if (!v.isFinite() || v.lt(0) || !Number.isSafeInteger(p.lateDays) || p.lateDays < 0) fail('تفاصيل غرامة غير صالحة');
    value = value.plus(v);
    raw = raw.plus(v.mul(rate).mul(p.lateDays));
  }
  if (value.gt(order)) fail('قيم التوريدات تتجاوز التكليف');
  const capped = round(D.min(raw, order.mul(cap))),
    current = capped.minus(old);
  if (current.lt(0)) fail('يلزم إجراء تصحيح معتمد للغرامة السابقة');
  return { raw, capped, current };
}

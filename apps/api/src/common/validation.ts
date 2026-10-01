import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { D } from './money';

export function fail(message: string): never {
  throw new BadRequestException(message);
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) fail(result.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('؛ '));
  return result.data;
}

export const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'قيمة مالية غير صالحة');
export const quantity = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'كمية غير صالحة')
  .refine((v) => new D(v).gt(0), 'الكمية موجبة');
export const text = z.string().trim().min(1).max(300);
export const optionalText = (max = 300) => z.string().trim().max(max).default('');
export const id = z.string().uuid();

/** Upper-case IBAN without spaces, with the mod-97 check; empty stays empty. */
export function normaliseIban(iban: string) {
  if (!iban) return iban;
  const v = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) fail('IBAN غير صالح');
  const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (BigInt(digits) % 97n !== 1n) fail('رقم تحقق IBAN غير صالح');
  return v;
}
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'تاريخ غير صالح');

/** JSON round-trip so Decimal/Date values are stored and returned as plain strings. */
export const plain = <T>(value: T): any => JSON.parse(JSON.stringify(value));

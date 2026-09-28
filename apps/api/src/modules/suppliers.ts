import { ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { fail, id, parse, text } from '../common/validation';
import { scope } from '../core/identity';
import type { WriteCtx } from './context';

const EDITORS = ['ACCOUNTANT', 'ADMIN'];

function normaliseIban(iban: string) {
  if (!iban) return iban;
  const v = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) fail('IBAN غير صالح');
  const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  if (BigInt(digits) % 97n !== 1n) fail('رقم تحقق IBAN غير صالح');
  return v;
}

/** Create, update (optimistic version check) or delete a supplier; a used supplier is deactivated instead. */
export async function writeSupplier({ s, school, t, body, rid, method }: WriteCtx) {
  scope(s, school, EDITORS);
  if (method === 'DELETE') {
    const supplier = await t.supplier.findUnique({
      where: { id: parse(id, rid), schoolId: school },
      include: { _count: { select: { quotes: true, cases: true } } },
    });
    if (!supplier) throw new NotFoundException();
    if (supplier._count.quotes || supplier._count.cases)
      return t.supplier.update({ where: { id: supplier.id }, data: { active: false, version: { increment: 1 } } });
    await t.supplier.delete({ where: { id: supplier.id } });
    return { id: rid, deleted: true };
  }
  const p = parse(
    z
      .object({
        name: text,
        cr: text,
        iban: z.string().max(50).default(''),
        phone: z.string().max(40).default(''),
        email: z.string().max(150).default(''),
        active: z.boolean().default(true),
        version: z.number().int().optional(),
      })
      .strict(),
    body,
  );
  const { version, ...data } = p;
  data.iban = normaliseIban(data.iban);
  if (rid) {
    const current = await t.supplier.findUnique({ where: { id: parse(id, rid), schoolId: school } });
    if (!current) throw new NotFoundException();
    if (current.version !== version) throw new ConflictException('تم تعديل المورد؛ أعد تحميله');
    // A bank account change affects where money is paid, so it needs an approver or administrator.
    if (current.iban !== data.iban) scope(s, school, ['APPROVER', 'ADMIN']);
    return t.supplier.update({ where: { id: rid, schoolId: school, version }, data: { ...data, version: { increment: 1 } } });
  }
  return t.supplier.create({ data: { ...data, schoolId: school } });
}

/** All-or-nothing import; an existing commercial registration is never silently replaced. */
export async function importSuppliers({ s, school, t, body }: WriteCtx) {
  scope(s, school, EDITORS);
  const p = parse(
    z
      .object({
        rows: z
          .array(
            z.object({
              name: text,
              cr: text,
              phone: z.string().max(40).default(''),
              email: z.string().max(150).default(''),
            }),
          )
          .min(1)
          .max(1000),
      })
      .strict(),
    body,
  );
  const codes = new Set<string>();
  for (const r of p.rows) {
    if (codes.has(r.cr)) fail('سجل تجاري مكرر داخل الملف');
    codes.add(r.cr);
    if (await t.supplier.findUnique({ where: { schoolId_cr: { schoolId: school, cr: r.cr } } })) fail('مورد موجود بالفعل: ' + r.cr);
  }
  await t.supplier.createMany({ data: p.rows.map((r) => ({ ...r, schoolId: school })) });
  return { count: p.rows.length };
}

import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { D, num } from '../common/money';
import { fail, id, normaliseIban, optionalText, parse, text } from '../common/validation';
import { scope, WORK, type Identity } from '../core/identity';
import type { WriteCtx } from './context';

/**
 * The supplier bank (one card per company for the whole tenant, with full contact and bank data) and
 * the reference register of certificates issued before the system.
 */

const cardSchema = z
  .object({
    name: text,
    legalName: optionalText(200),
    cr: z.string().trim().max(60).default(''),
    iban: z.string().trim().max(50).default(''),
    bank: optionalText(120),
    phone: z.string().trim().max(40).default(''),
    mobile: z.string().trim().max(40).default(''),
    email: z.union([z.literal(''), z.string().trim().email('البريد الإلكتروني غير صحيح').max(150)]).default(''),
    contact: optionalText(120),
    address: optionalText(300),
    category: optionalText(80),
    note: optionalText(500),
    nameEn: optionalText(200),
    crExpiry: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح')]).default(''),
    accountsEmail: z.union([z.literal(''), z.string().trim().email('بريد الحسابات غير صحيح').max(150)]).default(''),
    website: optionalText(200),
    beneficiary: optionalText(150),
    ibanVerified: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .strict();
export type CardInput = z.infer<typeof cardSchema>;

const key = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();

/** Everyone who works in a school may keep the bank; a read-only auditor may not. */
function requireWorker(s: Identity) {
  if (!s.user.isTenantAdmin && !s.user.memberships.some((m) => m.roles.some((r) => WORK.includes(r)))) fail('هذه العملية للمحاسبين');
}

export async function readBank(s: Identity, query: Record<string, any>) {
  const tenantId = s.user.tenantId;
  const q = String(query.q ?? '').trim();
  const [cards, usage, legacy, documents] = await Promise.all([
    db.supplierCard.findMany({
      where: {
        tenantId,
        ...(query.all === '1' ? {} : { active: true }),
        ...(q
          ? {
              OR: ['name', 'legalName', 'nameEn', 'cr', 'phone', 'mobile', 'email', 'accountsEmail', 'contact', 'category'].map((f) => ({
                [f]: { contains: q, mode: 'insensitive' as const },
              })),
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { suppliers: true } } },
    }),
    db.supplier.groupBy({ by: ['cardId'], where: { school: { tenantId }, cardId: { not: null } }, _count: true }),
    db.legacyCertificate.groupBy({ by: ['supplier'], where: { tenantId }, _count: true, _sum: { net: true }, _max: { date: true } }),
    db.archive.groupBy({ by: ['company'], where: { tenantId }, _count: true }),
  ]);
  const docsByKey = new Map(documents.map((d) => [key(d.company), d._count]));
  const soon = new Date(Date.now() + 30 * 86400000);
  const legacyByKey = new Map(legacy.map((l) => [key(l.supplier), l]));
  return cards.map(({ _count, ...c }) => {
    const h = legacyByKey.get(key(c.name)) ?? legacyByKey.get(key(c.legalName));
    return {
      ...c,
      schools: usage.find((u) => u.cardId === c.id)?._count ?? _count.suppliers,
      history: h ? { count: h._count, total: num(h._sum.net ?? 0), last: h._max.date } : null,
      documents: docsByKey.get(key(c.name)) ?? docsByKey.get(key(c.legalName)) ?? 0,
      crStatus: !c.crExpiry ? '' : c.crExpiry < new Date() ? 'expired' : c.crExpiry < soon ? 'soon' : 'valid',
    };
  });
}

/** Adds a card, or merges the given non-empty fields into the card of that name; returns the card. */
export async function upsertCard(t: Tx, tenantId: string, input: Partial<CardInput> & { name: string }) {
  const existing = await t.supplierCard.findFirst({ where: { tenantId, name: { equals: input.name.trim(), mode: 'insensitive' } } });
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (k !== 'name' && v !== undefined && v !== '' && v !== null) fields[k] = v;
  if (typeof fields.iban === 'string') fields.iban = normaliseIban(fields.iban);
  if (existing) return Object.keys(fields).length ? t.supplierCard.update({ where: { id: existing.id }, data: fields }) : existing;
  return t.supplierCard.create({ data: { tenantId, name: input.name.trim(), ...fields } });
}

export async function writeBank(s: Identity, t: Tx, rid: string | undefined, method: string, body: any) {
  requireWorker(s);
  const tenantId = s.user.tenantId;
  if (rid && method === 'DELETE') {
    const card = await t.supplierCard.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!card) throw new NotFoundException();
    // A card used by any school is deactivated, never removed.
    const used = await t.supplier.count({ where: { cardId: card.id } });
    if (used) return t.supplierCard.update({ where: { id: card.id }, data: { active: false } });
    await t.supplierCard.delete({ where: { id: card.id } });
    return { id: card.id, deleted: true };
  }
  const parsed = parse(cardSchema, body);
  const p = { ...parsed, iban: normaliseIban(parsed.iban), crExpiry: parsed.crExpiry ? new Date(parsed.crExpiry) : null };
  if (rid) {
    const card = await t.supplierCard.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!card) throw new NotFoundException();
    const clash = await t.supplierCard.findFirst({
      where: { tenantId, name: { equals: p.name, mode: 'insensitive' }, NOT: { id: card.id } },
    });
    if (clash) fail('يوجد مورد آخر بهذا الاسم في البنك');
    const updated = await t.supplierCard.update({ where: { id: card.id }, data: p });
    // The school copies follow the card for the fields that appear on documents.
    await t.supplier.updateMany({
      where: { cardId: card.id },
      data: { name: p.name, cr: p.cr || null, iban: p.iban, phone: p.phone || p.mobile, email: p.email },
    });
    return updated;
  }
  if (await t.supplierCard.findFirst({ where: { tenantId, name: { equals: p.name, mode: 'insensitive' } } }))
    fail('المورد موجود في البنك بالفعل');
  return t.supplierCard.create({ data: { ...p, tenantId } });
}

/** Adds a bank card to the current school's suppliers (the copy used in its documents). */
export async function supplierFromBank({ s, school, t, body }: WriteCtx) {
  scope(s, school, WORK);
  const p = parse(z.object({ cardId: id }).strict(), body);
  const card = await t.supplierCard.findFirst({ where: { id: p.cardId, tenantId: s.user.tenantId } });
  if (!card) throw new NotFoundException();
  const existing = await t.supplier.findFirst({
    where: { schoolId: school, OR: [{ cardId: card.id }, { name: { equals: card.name, mode: 'insensitive' } }] },
  });
  if (existing) return t.supplier.update({ where: { id: existing.id }, data: { cardId: card.id, active: true } });
  const crTaken = card.cr ? await t.supplier.findFirst({ where: { schoolId: school, cr: card.cr } }) : null;
  return t.supplier.create({
    data: {
      schoolId: school,
      cardId: card.id,
      name: card.name,
      cr: crTaken ? null : card.cr || null,
      iban: card.iban,
      phone: card.phone || card.mobile,
      email: card.email,
    },
  });
}

/** Reference register of earlier certificates: search, totals, Excel. */
export async function readLegacy(s: Identity, query: Record<string, any>) {
  const tenantId = s.user.tenantId;
  const q = String(query.q ?? '').trim();
  const where = {
    tenantId,
    ...(query.school ? { schoolName: String(query.school) } : {}),
    ...(query.supplier ? { supplier: { contains: String(query.supplier), mode: 'insensitive' as const } } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: new Date(String(query.from)) } : {}), ...(query.to ? { lte: new Date(String(query.to)) } : {}) } }
      : {}),
    ...(q
      ? {
          OR: ['supplier', 'orderNo', 'invoice', 'schoolName', 'note'].map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })),
        }
      : {}),
  };
  const [rows, schools, agg] = await Promise.all([
    db.legacyCertificate.findMany({ where, orderBy: [{ date: 'desc' }, { seq: 'desc' }], take: 2000 }),
    db.legacyCertificate.findMany({
      where: { tenantId },
      select: { schoolName: true },
      distinct: ['schoolName'],
      orderBy: { schoolName: 'asc' },
    }),
    db.legacyCertificate.aggregate({ where, _count: true, _sum: { net: true, fine: true, orderValue: true } }),
  ]);
  const out = rows.map((r) => ({
    ...r,
    orderValue: num(r.orderValue),
    delivered: num(r.delivered),
    finePct: num(r.finePct),
    fine: num(r.fine),
    net: num(r.net),
  }));
  if (query.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('الشهادات السابقة', { views: [{ rightToLeft: true }] });
    ws.addRow([
      'م',
      'التاريخ',
      'المدرسة',
      'المورد',
      'رقم التكليف',
      'الفاتورة',
      'قيمة التكليف',
      'تاريخ التكليف',
      'تاريخ التوريد',
      'المورَّد فعلياً',
      'أيام التأخير',
      'الغرامة',
      'الصافي',
      'ملاحظات',
    ]).font = { bold: true };
    for (const r of out)
      ws.addRow([
        r.seq,
        r.date,
        r.schoolName,
        r.supplier,
        r.orderNo,
        r.invoice,
        Number(r.orderValue),
        r.orderDate,
        r.deliveryDate,
        Number(r.delivered),
        r.lateDays,
        Number(r.fine),
        Number(r.net),
        r.note,
      ]);
    ws.columns.forEach((c) => (c.width = 18));
    return {
      base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      name: 'legacy-certificates.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  return {
    rows: out,
    schools: schools.map((x) => x.schoolName).filter(Boolean),
    totals: { count: agg._count, net: num(agg._sum.net ?? 0), fine: num(agg._sum.fine ?? 0), orderValue: num(agg._sum.orderValue ?? 0) },
  };
}

/** Sum of the net of earlier certificates per supplier name (for the supplier bank and the file). */
export const legacyTotal = (rows: { net: unknown }[]) => num(rows.reduce((v, r) => v.plus(r.net as any), new D(0)));

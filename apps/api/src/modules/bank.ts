import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { D, num } from '../common/money';
import { fail, id, normaliseIban, optionalText, parse, text } from '../common/validation';
import { requireTenantAdmin, scope, WORK, type Identity } from '../core/identity';
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
  const perf = await performance(tenantId, cards);
  return cards.map(({ _count, ...c }) => {
    const h = legacyByKey.get(key(c.name)) ?? legacyByKey.get(key(c.legalName));
    return {
      ...c,
      schools: usage.find((u) => u.cardId === c.id)?._count ?? _count.suppliers,
      history: h ? { count: h._count, total: num(h._sum.net ?? 0), last: h._max.date } : null,
      documents: docsByKey.get(key(c.name)) ?? docsByKey.get(key(c.legalName)) ?? 0,
      crStatus: !c.crExpiry ? '' : c.crExpiry < new Date() ? 'expired' : c.crExpiry < soon ? 'soon' : 'valid',
      performance: perf.get(c.id) ?? null,
    };
  });
}

/** Adds a card, or merges the given non-empty fields into the card of that name; returns the card. */
export async function upsertCard(t: Tx, tenantId: string, input: Partial<CardInput> & { name: string }) {
  const existing = await t.supplierCard.findFirst({ where: { tenantId, name: { equals: input.name.trim(), mode: 'insensitive' } } });
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (k !== 'name' && v !== undefined && v !== '' && v !== null) fields[k] = v;
  if (typeof fields.iban === 'string') fields.iban = normaliseIban(fields.iban);
  // A school edit never replaces an existing IBAN while second-person approval is on: it waits on the card.
  if (existing && existing.iban && typeof fields.iban === 'string' && fields.iban !== existing.iban) {
    const { fourEyes } = await t.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { fourEyes: true } });
    if (fourEyes) {
      fields.pendingIban = fields.iban;
      fields.pendingAt = new Date();
      delete fields.iban;
    }
  }
  if (existing) return Object.keys(fields).length ? t.supplierCard.update({ where: { id: existing.id }, data: fields }) : existing;
  return t.supplierCard.create({ data: { tenantId, name: input.name.trim(), ...fields } });
}

export async function writeBank(s: Identity, t: Tx, rid: string | undefined, method: string, body: any, action?: string) {
  requireWorker(s);
  const tenantId = s.user.tenantId;
  if (rid && action === 'merge') return mergeCards(s, t, rid, body);
  if (rid && action === 'iban-decision') return decideIban(s, t, rid, body);
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
    // With second-person approval on, a new IBAN for a card that already has one waits for another user.
    const fourEyes = (await t.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { fourEyes: true } })).fourEyes;
    let pending = false;
    if (fourEyes && card.iban && p.iban !== card.iban) {
      pending = true;
      await t.audit.create({
        data: {
          tenantId,
          actor: s.user.id,
          action: 'supplier-bank:iban-requested',
          entity: card.id,
          detail: { name: card.name, current: card.iban, requested: p.iban },
        },
      });
      Object.assign(p, { iban: card.iban, ibanVerified: card.ibanVerified });
    }
    // A changed IBAN or registration loses its «verified» mark and is logged with before/after for review.
    const ibanChanged = p.iban !== card.iban;
    if (ibanChanged) p.ibanVerified = false;
    if (ibanChanged || p.cr !== card.cr)
      await t.audit.create({
        data: {
          tenantId,
          actor: s.user.id,
          action: 'supplier-bank:bank-data-change',
          entity: card.id,
          detail: { name: card.name, before: { iban: card.iban, cr: card.cr }, after: { iban: p.iban, cr: p.cr } },
        },
      });
    const updated = await t.supplierCard.update({
      where: { id: card.id },
      data: { ...p, ...(pending ? { pendingIban: normaliseIban(String(parsed.iban)), pendingBy: s.user.id, pendingAt: new Date() } : {}) },
    });
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
          OR: ['supplier', 'subject', 'orderNo', 'invoice', 'schoolName', 'note'].map((f) => ({
            [f]: { contains: q, mode: 'insensitive' as const },
          })),
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
      'الموضوع',
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
        r.subject,
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

export type Performance = {
  files: number;
  late: number;
  lateRate: number;
  fines: string;
  avgLateDays: number;
  returns: number;
  rating: 'GOOD' | 'WATCH' | 'POOR';
};

/**
 * Delivery record of each supplier: the certificates issued before the system (reference register)
 * and those issued in it, with late deliveries, penalties, and the files sent back by the auditors.
 * A supplier late in 35% or more of its files (with at least 3 files) is «poor»; 15% or more «watch».
 */
export async function performance(tenantId: string, cards: { id: string; name: string; legalName: string }[]) {
  const [legacy, certs, returned] = await Promise.all([
    db.legacyCertificate.findMany({ where: { tenantId }, select: { supplier: true, lateDays: true, fine: true } }),
    db.certificate.findMany({
      where: { case: { school: { tenantId }, supplier: { cardId: { not: null } } } },
      select: { fine: true, portions: { select: { lateDays: true } }, case: { select: { supplier: { select: { cardId: true } } } } },
    }),
    db.caseReturn.findMany({
      where: { case: { school: { tenantId }, supplier: { cardId: { not: null } } } },
      select: { case: { select: { supplier: { select: { cardId: true } } } } },
    }),
  ]);
  const out = new Map<string, Performance>();
  for (const c of cards) {
    const names = new Set([key(c.name), key(c.legalName)].filter(Boolean));
    const old = legacy.filter((l) => names.has(key(l.supplier)));
    const mine = certs.filter((x) => x.case.supplier?.cardId === c.id);
    const files = old.length + mine.length;
    if (!files) continue;
    const lateDays = [...old.map((l) => l.lateDays), ...mine.map((x) => Math.max(0, ...x.portions.map((p) => p.lateDays)))];
    const late = lateDays.filter((d) => d > 0).length;
    const fines = [...old.map((l) => Number(l.fine)), ...mine.map((x) => Number(x.fine))].reduce((a, b) => a + b, 0);
    const returns = returned.filter((r) => r.case.supplier?.cardId === c.id).length;
    const lateRate = late / files;
    out.set(c.id, {
      files,
      late,
      lateRate: Math.round(lateRate * 100),
      fines: num(new D(fines.toFixed(2))),
      avgLateDays: late ? Math.round(lateDays.filter((d) => d > 0).reduce((a, b) => a + b, 0) / late) : 0,
      returns,
      rating: files >= 3 && lateRate >= 0.35 ? 'POOR' : lateRate >= 0.15 || returns >= 2 ? 'WATCH' : 'GOOD',
    });
  }
  return out;
}

/**
 * Merges a duplicate card into another (administrator only): school copies and documents move to the
 * kept card, empty fields of the kept card are filled from the duplicate, and the duplicate is deleted.
 * Issued documents are snapshots and stay exactly as issued.
 */
async function mergeCards(s: Identity, t: Tx, rid: string, body: any) {
  requireTenantAdmin(s);
  const p = parse(z.object({ into: id }).strict(), body);
  const tenantId = s.user.tenantId;
  const [from, into] = await Promise.all([
    t.supplierCard.findFirst({ where: { id: parse(id, rid), tenantId } }),
    t.supplierCard.findFirst({ where: { id: p.into, tenantId } }),
  ]);
  if (!from || !into) throw new NotFoundException();
  if (from.id === into.id) fail('اختر مورداً آخر للدمج');
  const fill: Record<string, unknown> = {};
  for (const k of [
    'legalName',
    'nameEn',
    'cr',
    'iban',
    'bank',
    'phone',
    'mobile',
    'email',
    'accountsEmail',
    'website',
    'beneficiary',
    'contact',
    'address',
    'category',
  ] as const)
    if (!into[k] && from[k]) fill[k] = from[k];
  if (!into.crExpiry && from.crExpiry) fill.crExpiry = from.crExpiry;
  if (from.note) fill.note = [into.note, from.note].filter(Boolean).join(' — ');
  const moved = await t.supplier.updateMany({ where: { cardId: from.id }, data: { cardId: into.id } });
  const merged = await t.supplierCard.update({ where: { id: into.id }, data: fill });
  await t.supplierCard.delete({ where: { id: from.id } });
  await t.audit.create({
    data: {
      tenantId,
      actor: s.user.id,
      action: 'supplier-bank:merge',
      entity: into.id,
      detail: { from: { id: from.id, name: from.name }, into: { id: into.id, name: into.name }, schools: moved.count },
    },
  });
  return { ...merged, moved: moved.count };
}

/** Another user approves or rejects a pending IBAN change; the requester cannot decide their own request. */
async function decideIban(s: Identity, t: Tx, rid: string, body: any) {
  const p = parse(z.object({ approve: z.boolean() }).strict(), body);
  const card = await t.supplierCard.findFirst({ where: { id: parse(id, rid), tenantId: s.user.tenantId } });
  if (!card) throw new NotFoundException();
  if (!card.pendingIban) fail('لا يوجد تغيير IBAN بانتظار الموافقة');
  if (card.pendingBy === s.user.id) fail('لا يوافق صاحب الطلب على طلبه؛ يلزم مستخدم آخر');
  if (!p.approve) {
    await t.audit.create({
      data: {
        tenantId: s.user.tenantId,
        actor: s.user.id,
        action: 'supplier-bank:iban-rejected',
        entity: card.id,
        detail: { requested: card.pendingIban },
      },
    });
    return t.supplierCard.update({ where: { id: card.id }, data: { pendingIban: '', pendingBy: null, pendingAt: null } });
  }
  await t.audit.create({
    data: {
      tenantId: s.user.tenantId,
      actor: s.user.id,
      action: 'supplier-bank:bank-data-change',
      entity: card.id,
      detail: {
        name: card.name,
        before: { iban: card.iban, cr: card.cr },
        after: { iban: card.pendingIban, cr: card.cr },
        requestedBy: card.pendingBy,
        approvedBy: s.user.id,
      },
    },
  });
  await t.supplier.updateMany({ where: { cardId: card.id }, data: { iban: card.pendingIban } });
  return t.supplierCard.update({
    where: { id: card.id },
    data: { iban: card.pendingIban, ibanVerified: false, pendingIban: '', pendingBy: null, pendingAt: null },
  });
}

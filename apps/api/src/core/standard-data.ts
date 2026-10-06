import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, type Tx } from '../common/db';
import { STANDARD_SUPPLIERS } from './suppliers-list';

const key = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();

/** One card in the supplier bank for every supplier of the approved workbooks that has none yet. */
export async function ensureSupplierCards(t: Tx | typeof db, tenantId: string) {
  const have = new Set((await t.supplierCard.findMany({ where: { tenantId }, select: { name: true } })).map((c) => key(c.name)));
  const missing = STANDARD_SUPPLIERS.filter((n) => !have.has(key(n)));
  if (missing.length) await t.supplierCard.createMany({ data: missing.map((name) => ({ tenantId, name })) });
  // School suppliers that still point at no card are linked by name.
  const cards = await t.supplierCard.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const byName = new Map(cards.map((c) => [key(c.name), c.id]));
  const loose = await t.supplier.findMany({ where: { cardId: null, school: { tenantId } }, select: { id: true, name: true } });
  for (const s of loose) {
    const id = byName.get(key(s.name));
    if (id) await t.supplier.update({ where: { id: s.id }, data: { cardId: id } });
  }
  return missing.length;
}

type LegacyRow = {
  seq: number;
  date: string;
  supplier: string;
  orderNo: string;
  invoice: string;
  orderValue: number;
  orderDate: string;
  deliveryDate: string;
  delivered: number;
  lateDays: number;
  finePct: number;
  fine: number;
  net: number;
  note: string;
  school: string;
  subject?: string;
};

/** The certificates of 2022–2026 from the approved workbook: reference only, never posted to any ledger. */
export async function loadLegacyCertificates(t: Tx | typeof db, tenantId: string) {
  if (await t.legacyCertificate.count({ where: { tenantId } })) return 0;
  const file = resolve(process.cwd(), 'scripts/legacy-certificates.json');
  const raw = readFileSync(file, 'utf8');
  const rows: LegacyRow[] = JSON.parse(raw);
  const day = (v: string) => (v ? new Date(v) : null);
  await t.legacyCertificate.createMany({
    data: rows.map((r) => ({
      tenantId,
      seq: r.seq,
      date: new Date(r.date),
      schoolName: r.school,
      supplier: r.supplier,
      subject: r.subject ?? '',
      orderNo: r.orderNo,
      invoice: r.invoice,
      orderValue: r.orderValue,
      orderDate: day(r.orderDate),
      deliveryDate: day(r.deliveryDate),
      delivered: r.delivered,
      lateDays: r.lateDays,
      finePct: r.finePct,
      fine: r.fine,
      net: r.net,
      note: r.note,
    })),
    skipDuplicates: true,
  });
  // The import is recorded in the audit log with the file's fingerprint, so the batch can always be traced.
  const admin = await t.user.findFirst({ where: { tenantId, isTenantAdmin: true }, select: { id: true } });
  await t.audit.create({
    data: {
      tenantId,
      actor: admin?.id ?? tenantId,
      action: 'import:legacy-certificates',
      entity: tenantId,
      detail: {
        batch: 'legacy-v1',
        file: 'scripts/legacy-certificates.json',
        sha256: createHash('sha256').update(raw).digest('hex'),
        rows: rows.length,
      },
    },
  });
  return rows.length;
}

/** Installations that loaded the register before the subject column existed get the subjects once. */
export async function fillLegacySubjects(t: Tx | typeof db, tenantId: string) {
  const rows: LegacyRow[] = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/legacy-certificates.json'), 'utf8'));
  let n = 0;
  for (const r of rows.filter((x) => x.subject))
    n += (await t.legacyCertificate.updateMany({ where: { tenantId, seq: r.seq, subject: '' }, data: { subject: r.subject } })).count;
  return n;
}

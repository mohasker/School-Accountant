import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { hash } from '../common/crypto';
import { fail, id, optionalText, parse, text } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { audit } from '../core/transaction';

/**
 * Shared, tenant-wide helpers for every accountant:
 *  - the document archive (commercial registrations, undertakings, IBAN letters… of companies):
 *    anyone reads and adds, the administrator removes;
 *  - the notes board (general entries, settlements, depreciation…): everyone reads, the administrator writes;
 *  - the sign-in log with the device location (when the user allowed it): administrator only.
 */

export const ARCHIVE_KINDS: Record<string, string> = {
  CR: 'سجل تجاري',
  UNDERTAKING: 'تعهد / إقرار',
  IBAN: 'شهادة IBAN',
  LICENSE: 'رخصة / تصريح',
  OTHER: 'مستند آخر',
};
const MIMES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_BYTES = 6 * 1024 * 1024;

export async function readArchive(s: Identity, rid: string | undefined, query: Record<string, any>) {
  const tenantId = s.user.tenantId;
  if (rid) {
    const doc = await db.archive.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!doc) throw new NotFoundException();
    return { name: doc.fileName, mime: doc.mime, base64: Buffer.from(doc.data).toString('base64') };
  }
  const q = String(query.q ?? '')
    .trim()
    .slice(0, 200);
  const kind = String(query.kind ?? '').trim();
  const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
  const rows = await db.archive.findMany({
    where: {
      tenantId,
      ...(kind && ARCHIVE_KINDS[kind] ? { kind } : {}),
      ...(q ? { OR: [{ company: contains(q) }, { title: contains(q) }, { note: contains(q) }] } : {}),
    },
    select: {
      id: true,
      kind: true,
      company: true,
      title: true,
      note: true,
      fileName: true,
      mime: true,
      size: true,
      uploaderName: true,
      createdAt: true,
    },
    orderBy: [{ company: 'asc' }, { createdAt: 'desc' }],
    take: 1000,
  });
  return { rows, kinds: ARCHIVE_KINDS, canDelete: s.user.isTenantAdmin };
}

export async function writeArchive(s: Identity, t: Tx, rid: string | undefined, method: string, body: any) {
  const tenantId = s.user.tenantId;
  if (rid && method === 'DELETE') {
    requireTenantAdmin(s);
    const doc = await t.archive.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!doc) throw new NotFoundException();
    await audit(t, s, tenantId, 'ARCHIVE_DELETE', doc.id, { company: doc.company, title: doc.title });
    return t.archive.delete({ where: { id: doc.id } });
  }
  const p = parse(
    z
      .object({
        kind: z.enum(Object.keys(ARCHIVE_KINDS) as [string, ...string[]]),
        company: text,
        title: text,
        note: optionalText(500),
        name: z.string().trim().min(1).max(200),
        mime: z.enum(MIMES as [string, ...string[]]),
        base64: z.string().min(10),
      })
      .strict(),
    body,
  );
  const data = Buffer.from(p.base64, 'base64');
  if (!data.length || data.length > MAX_BYTES) fail('حجم الملف حتى 6 ميجابايت');
  const { base64: _b, name, ...fields } = p;
  const doc = await t.archive.create({
    data: {
      ...fields,
      fileName: name,
      size: data.length,
      hash: hash(data),
      data,
      tenantId,
      uploadedBy: s.user.id,
      uploaderName: s.user.name,
    },
    select: { id: true, company: true, title: true },
  });
  await audit(t, s, tenantId, 'ARCHIVE_ADD', doc.id, { company: doc.company, title: doc.title });
  return doc;
}

export function readNotes(s: Identity) {
  return db.note.findMany({
    where: { tenantId: s.user.tenantId },
    orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, body: true, category: true, sort: true, updatedAt: true },
  });
}

export async function writeNotes(s: Identity, t: Tx, rid: string | undefined, method: string, body: any) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  if (rid && method === 'DELETE') {
    const n = await t.note.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!n) throw new NotFoundException();
    return t.note.delete({ where: { id: n.id } });
  }
  const p = parse(
    z
      .object({
        title: text,
        body: z.string().trim().min(1).max(20000),
        category: optionalText(60),
        sort: z.coerce.number().int().min(0).max(9999).default(0),
      })
      .strict(),
    body,
  );
  if (rid) {
    const n = await t.note.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!n) throw new NotFoundException();
    return t.note.update({ where: { id: n.id }, data: { ...p, updatedBy: s.user.id } });
  }
  return t.note.create({ data: { ...p, tenantId, updatedBy: s.user.id } });
}

/** Last sign-ins of every account (administrator): address, browser and the device location if shared. */
export async function readLogins(s: Identity, query: Record<string, any>) {
  requireTenantAdmin(s);
  const user = query.user ? parse(id, query.user) : undefined;
  return db.loginLog.findMany({
    where: { user: { tenantId: s.user.tenantId }, ...(user ? { userId: user } : {}) },
    include: { user: { select: { name: true, username: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(query.take) || 300, 2000),
  });
}

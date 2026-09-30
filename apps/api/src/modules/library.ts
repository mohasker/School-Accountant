import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { hash } from '../common/crypto';
import { fail, id, optionalText, parse, text } from '../common/validation';
import { nearestSchool } from '../core/geo';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { audit } from '../core/transaction';
import { download, isConnected, remove, upload } from './onedrive';

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
    const bytes = doc.storage === 'ONEDRIVE' ? await download(tenantId, doc.remoteId) : doc.data && Buffer.from(doc.data);
    if (!bytes) throw new NotFoundException('محتوى الملف غير موجود');
    return { name: doc.fileName, mime: doc.mime, base64: bytes.toString('base64') };
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
      storage: true,
      remoteUrl: true,
      uploaderName: true,
      createdAt: true,
    },
    orderBy: [{ company: 'asc' }, { createdAt: 'desc' }],
    take: 1000,
  });
  // The OneDrive address opens only for the account that owns the drive, so it is shown to the administrator alone.
  return {
    rows: rows.map((r) => (s.user.isTenantAdmin ? r : { ...r, remoteUrl: '' })),
    kinds: ARCHIVE_KINDS,
    canDelete: s.user.isTenantAdmin,
    storage: (await isConnected(tenantId)) ? 'ONEDRIVE' : 'DATABASE',
  };
}

const preparedSchema = z
  .object({
    kind: z.enum(Object.keys(ARCHIVE_KINDS) as [string, ...string[]]),
    company: text,
    title: text,
    note: optionalText(500),
    name: z.string().trim().min(1).max(200),
    mime: z.enum(MIMES as [string, ...string[]]),
    size: z.number().int().positive().max(MAX_BYTES),
    hash: z.string().length(64),
    storage: z.enum(['DATABASE', 'ONEDRIVE']),
    remoteId: z.string().max(300).default(''),
    remoteUrl: z.string().max(2000).default(''),
    dataBase64: z.string().optional(),
  })
  .strict();
export type PreparedArchive = z.infer<typeof preparedSchema>;

/**
 * First half of adding a document: validates it and, when OneDrive is connected, uploads it there
 * BEFORE the database transaction (an upload can take seconds; the row is written only afterwards).
 */
export async function prepareArchive(s: Identity, body: any): Promise<PreparedArchive> {
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
  const { base64, ...fields } = p;
  const common = { ...fields, size: data.length, hash: hash(data) };
  if (await isConnected(s.user.tenantId)) {
    const stored = await upload(s.user.tenantId, p.company, p.name, p.mime, data);
    return { ...common, storage: 'ONEDRIVE', remoteId: stored.id, remoteUrl: stored.url };
  }
  return { ...common, storage: 'DATABASE', remoteId: '', remoteUrl: '', dataBase64: base64 };
}

/** After the transaction: a file uploaded to OneDrive that ended up with no row (failure or replay) is removed. */
export async function discardOrphan(tenantId: string, prepared: PreparedArchive) {
  if (prepared.storage !== 'ONEDRIVE' || !prepared.remoteId) return;
  const kept = await db.archive.count({ where: { tenantId, remoteId: prepared.remoteId } });
  if (!kept) await remove(tenantId, prepared.remoteId);
}

/**
 * Archive writes: deletion (administrator) and creation from the object `prepareArchive` produced on
 * the server. The prepared object is never accepted from the client: it carries trusted fields
 * (storage, remoteId, hash) that would otherwise let a user point a row at any OneDrive item.
 */
export async function writeArchive(s: Identity, t: Tx, rid: string | undefined, method: string, prepared: PreparedArchive | undefined) {
  const tenantId = s.user.tenantId;
  if (rid && method === 'DELETE') {
    requireTenantAdmin(s);
    const doc = await t.archive.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!doc) throw new NotFoundException();
    // The OneDrive copy is removed by the caller after this transaction ends (Microsoft is never called inside it).
    await audit(t, s, tenantId, 'ARCHIVE_DELETE', doc.id, {
      company: doc.company,
      title: doc.title,
      storage: doc.storage,
      remoteId: doc.remoteId,
    });
    await t.archive.delete({ where: { id: doc.id } });
    return { id: doc.id, storage: doc.storage, remoteId: doc.remoteId };
  }
  if (rid || method !== 'POST' || !prepared) throw new NotFoundException();
  const { name, dataBase64, ...p } = parse(preparedSchema, prepared);
  if (p.storage === 'ONEDRIVE' ? !p.remoteId : !dataBase64) fail('بيانات الملف ناقصة');
  const doc = await t.archive.create({
    data: {
      ...p,
      fileName: name,
      data: p.storage === 'DATABASE' ? Buffer.from(dataBase64!, 'base64') : null,
      tenantId,
      uploadedBy: s.user.id,
      uploaderName: s.user.name,
    },
    select: { id: true, company: true, title: true },
  });
  await audit(t, s, tenantId, 'ARCHIVE_ADD', doc.id, { company: doc.company, title: doc.title, storage: p.storage });
  return doc;
}

/** Deletes the OneDrive copy of a removed document; when OneDrive cannot be reached the file is left there and the audit says so. */
export async function removeRemote(s: Identity, docId: string, remoteId: string) {
  const removed = await remove(s.user.tenantId, remoteId);
  await db.audit.create({
    data: {
      tenantId: s.user.tenantId,
      actor: s.user.id,
      action: removed ? 'ARCHIVE_REMOTE_REMOVED' : 'ARCHIVE_REMOTE_LEFT',
      entity: docId,
      detail: { remoteId },
    },
  });
}

/** Moves the documents kept in the database to OneDrive, one by one; stops at the first failure and says how far it got. */
export async function migrateArchive(s: Identity) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  if (!(await isConnected(tenantId))) fail('اربط حساب OneDrive أولاً');
  // Ids first; each document's bytes are loaded only while it is being moved (files are up to 6 MB each).
  const docs = await db.archive.findMany({
    where: { tenantId, storage: 'DATABASE', data: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  let moved = 0,
    error = '';
  for (const { id: docId } of docs) {
    const d = await db.archive.findUnique({ where: { id: docId } });
    if (!d?.data) continue;
    let stored: { id: string; url: string } | undefined;
    try {
      stored = await upload(tenantId, d.company, d.fileName, d.mime, Buffer.from(d.data));
      await db.archive.update({
        where: { id: d.id },
        data: { storage: 'ONEDRIVE', remoteId: stored.id, remoteUrl: stored.url, data: null },
      });
      moved++;
    } catch (e: any) {
      // The row was not updated: the copy just uploaded would be an orphan, so it is removed.
      if (stored) await remove(tenantId, stored.id);
      error = e?.message || String(e);
      break;
    }
  }
  await db.audit.create({
    data: {
      tenantId,
      actor: s.user.id,
      action: 'ARCHIVE_MIGRATE',
      entity: tenantId,
      detail: { moved, remaining: docs.length - moved, error },
    },
  });
  return { moved, remaining: docs.length - moved, error };
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
  const [rows, schools] = await Promise.all([
    db.loginLog.findMany({
      where: { user: { tenantId: s.user.tenantId }, ...(user ? { userId: user } : {}) },
      include: { user: { select: { name: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(query.take) || 300, 2000),
    }),
    db.school.findMany({ where: { tenantId: s.user.tenantId, lat: { not: null } }, select: { name: true, lat: true, lng: true } }),
  ]);
  // With every located sign-in: the nearest school whose location was entered.
  return rows.map((r) => ({ ...r, nearest: nearestSchool(r, schools) }));
}

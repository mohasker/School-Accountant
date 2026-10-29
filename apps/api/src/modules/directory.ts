import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { fail, id, parse } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { openSchool } from './tenant';

/**
 * The ministry's list of schools (about 300): the administrator chooses, for any school, the accountant
 * who holds its accounts and the financial supervisor who audits it. The school record (with its fiscal
 * year, budget lines and suppliers) is opened on its first assignment; a school whose accountant changes
 * stays reachable by the previous accountant as an inactive school, so the history is kept.
 */
type Row = {
  sn: number;
  nameAr: string;
  nameEn: string;
  status: string;
  building: string;
  stage: string;
  gender: string;
  district: string;
};

/** Names as written in different lists: «مدرسة», hamza forms, ة/ه, ى/ي, «للبنبن» and spaces ignored. */
export const nameKey = (v: string) =>
  v
    .replace(/^\s*(مدرسة|روضة)\s+/, '')
    .replace(/للبنبن/g, 'للبنين')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s_\-–—()]+/g, '')
    .trim();

async function load(t: Tx | typeof db, tenantId: string, rows: Row[]) {
  const schools = await t.school.findMany({ where: { tenantId }, select: { id: true, name: true } });
  const byKey = new Map(schools.map((x) => [nameKey(x.name), x.id]));
  let added = 0,
    linked = 0;
  for (const r of rows) {
    const schoolId = byKey.get(nameKey(r.nameAr)) ?? null;
    if (schoolId) linked++;
    const found = await t.schoolDirectory.findUnique({ where: { tenantId_sn: { tenantId, sn: r.sn } } });
    if (found) await t.schoolDirectory.update({ where: { id: found.id }, data: { ...r, schoolId: found.schoolId ?? schoolId } });
    else {
      await t.schoolDirectory.create({ data: { ...r, tenantId, schoolId } });
      added++;
    }
  }
  return { rows: rows.length, added, linked };
}

/** The list shipped with the system (scripts/schools-directory.json), loaded once per installation. */
export async function loadStandardDirectory(t: Tx | typeof db, tenantId: string) {
  if (await t.schoolDirectory.count({ where: { tenantId } })) return null;
  const rows: Row[] = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/schools-directory.json'), 'utf8'));
  return load(t, tenantId, rows);
}

/** GET admin/directory — every school of the list with its accountant and supervisor. */
export async function readDirectory(s: Identity) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  const [rows, users, links] = await Promise.all([
    db.schoolDirectory.findMany({ where: { tenantId }, orderBy: { sn: 'asc' } }),
    db.user.findMany({
      where: { tenantId, isTenantAdmin: false, active: true },
      select: { id: true, name: true, username: true },
      orderBy: { name: 'asc' },
    }),
    db.membership.findMany({ where: { tenantId }, select: { schoolId: true, userId: true, roles: true, active: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    users,
    rows: rows.map((r) => {
      const own = links.filter((l) => r.schoolId && l.schoolId === r.schoolId && nameOf.has(l.userId));
      const accountant = own.find((l) => l.roles.includes('ACCOUNTANT') && l.active);
      const supervisor = own.find((l) => l.roles.includes('SUPERVISOR'));
      return {
        ...r,
        accountantId: accountant?.userId ?? null,
        accountant: accountant ? nameOf.get(accountant.userId) : null,
        supervisorId: supervisor?.userId ?? null,
        supervisor: supervisor ? nameOf.get(supervisor.userId) : null,
      };
    }),
  };
}

/** Membership of a user in a school with one role added (created if missing, kept active). */
async function grant(t: Tx, tenantId: string, schoolId: string, userId: string, role: string) {
  const m = await t.membership.findFirst({ where: { schoolId, userId } });
  if (!m) return t.membership.create({ data: { tenantId, schoolId, userId, roles: [role] } });
  return t.membership.update({ where: { id: m.id }, data: { roles: m.roles.includes(role) ? m.roles : [...m.roles, role], active: true } });
}

/**
 * POST admin/directory/assign {ids, accountantId?, supervisorId?} — for the chosen schools of the list:
 * the accountant who holds them ('' = none) and the supervisor who audits them ('' = none). A field left
 * out is not changed.
 */
export async function assignDirectory(s: Identity, t: Tx, body: unknown) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  const who = z.union([id, z.literal('')]).optional();
  const p = parse(z.object({ ids: z.array(id).min(1).max(400), accountantId: who, supervisorId: who }).strict(), body);
  if (p.accountantId === undefined && p.supervisorId === undefined) fail('اختر المحاسب أو المراقب');
  for (const userId of [p.accountantId, p.supervisorId].filter((x): x is string => !!x))
    if (!(await t.user.findFirst({ where: { id: userId, tenantId, isTenantAdmin: false } })))
      throw new NotFoundException('الحساب غير موجود');
  const rows = await t.schoolDirectory.findMany({ where: { tenantId, id: { in: p.ids } } });
  if (rows.length !== p.ids.length) throw new NotFoundException();
  let opened = 0;
  for (const r of rows) {
    let schoolId = r.schoolId;
    if (!schoolId) {
      const school = await openSchool(t, tenantId, s.user.id, {
        name: r.nameAr.replace(/^\s*مدرسة\s+/, ''),
        principal: 'مدير / ة المدرسة',
      });
      schoolId = school.id;
      opened++;
      await t.schoolDirectory.update({ where: { id: r.id }, data: { schoolId } });
    }
    const members = await t.membership.findMany({ where: { schoolId }, include: { user: { select: { isTenantAdmin: true } } } });
    if (p.accountantId !== undefined) {
      // The previous accountant keeps the school as inactive (history and reprints), out of their totals.
      for (const m of members.filter(
        (x) => !x.user.isTenantAdmin && x.roles.includes('ACCOUNTANT') && x.userId !== p.accountantId && x.active,
      ))
        await t.membership.update({ where: { id: m.id }, data: { active: false } });
      if (p.accountantId) await grant(t, tenantId, schoolId, p.accountantId, 'ACCOUNTANT');
    }
    if (p.supervisorId !== undefined) {
      for (const m of members.filter((x) => x.roles.includes('SUPERVISOR') && x.userId !== p.supervisorId)) {
        const roles = m.roles.filter((r) => r !== 'SUPERVISOR');
        if (roles.length) await t.membership.update({ where: { id: m.id }, data: { roles } });
        else await t.membership.delete({ where: { id: m.id } });
      }
      if (p.supervisorId) await grant(t, tenantId, schoolId, p.supervisorId, 'SUPERVISOR');
    }
  }
  return { id: tenantId, schools: rows.length, opened };
}

/** POST admin/directory/import {base64} — an updated schools workbook (same columns), matched by its serial number. */
export async function importDirectory(s: Identity, t: Tx, body: unknown) {
  requireTenantAdmin(s);
  const p = parse(z.object({ base64: z.string().min(10).max(12_000_000) }).strict(), body);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(p.base64, 'base64') as any);
  } catch {
    fail('تعذر قراءة الملف؛ يجب أن يكون ملف Excel (xlsx)');
  }
  const ws = wb.worksheets[0];
  if (!ws) fail('الملف فارغ');
  const text = (v: unknown) =>
    String(v && typeof v === 'object' && 'result' in (v as any) ? (v as any).result : (v ?? ''))
      .replace(/\s+/g, ' ')
      .trim();
  const rows: Row[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = (i: number) => text(row.getCell(i).value);
    const sn = Number(v(1));
    if (!sn || !v(3)) return;
    rows.push({ sn, nameEn: v(2), nameAr: v(3), status: v(4), building: v(5), stage: v(6), gender: v(7), district: v(8) });
  });
  if (!rows.length) fail('لم يُعثر على مدارس؛ الأعمدة: م، الاسم بالإنجليزية، اسم المدرسة، الحالة، تصنيف المبنى، المرحلة، النوع، المنطقة');
  return { id: s.user.tenantId, ...(await load(t, s.user.tenantId, rows)) };
}

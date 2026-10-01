import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { isoDay, today } from '../common/dates';
import { date, fail, id, optionalText, parse, text } from '../common/validation';
import { passwordHash, requireTenantAdmin, ROLES, schoolIds, WORK, type Identity } from '../core/identity';
import { loadPolicy, POLICY, policyKeys, type PolicyKey } from '../core/policy';
import { accountantsReport, accountProfile, adminOverview, manageUser, userReport } from './admin';
import { readArchive, readLogins, readNotes, writeArchive, writeNotes, type PreparedArchive } from './library';
import { connectUrl, disconnect, saveConfig, status as oneDriveStatus } from './onedrive';
import { purge } from './purge';
import { followUp } from './overview';
import { emailStatus, saveEmailConfig } from './email';
import { addStandardSuppliers } from '../core/suppliers-list';
import { STANDARD_SCHOOLS } from '../core/standard-schools';
import { ensureSupplierCards } from '../core/standard-data';
import { readBank, readLegacy, writeBank } from './bank';
import { tenantAddressees } from './cases/fulfilment';
import { saveTelegramConfig, telegramStatus } from './telegram';

/**
 * Tenant-wide settings under /api/admin/…. Every user may maintain the official holidays and add
 * schools (with their principal and custodians); the financial policy, the budget catalog, user
 * accounts and data purges belong to the system administrator.
 */
export async function readTenant(
  s: Identity,
  resource: string,
  rid: string | undefined,
  action: string | undefined,
  query: Record<string, any>,
) {
  const tenantId = s.user.tenantId;
  switch (resource) {
    case 'holidays': {
      const year = query.year ? Number(query.year) : undefined;
      return db.holiday.findMany({
        where: {
          tenantId,
          ...(year ? { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } } : {}),
        },
        orderBy: { date: 'asc' },
      });
    }
    case 'policy': {
      requireTenantAdmin(s);
      const history = await db.policySetting.findMany({
        where: { tenantId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return {
        current: await loadPolicy(db, tenantId),
        definitions: policyKeys.map((k) => ({ key: k, label: POLICY[k].label, help: POLICY[k].help, default: POLICY[k].value })),
        history,
      };
    }
    case 'budget-catalog':
      return db.budgetCatalog.findMany({ where: { tenantId }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
    case 'archive':
      return readArchive(s, rid, query);
    case 'onedrive':
      return rid === 'connect' ? connectUrl(s) : oneDriveStatus(s);
    case 'notes':
      return readNotes(s);
    case 'logins':
      return readLogins(s, query);
    case 'schools':
      return db.school.findMany({
        where: { tenantId, ...(s.user.isTenantAdmin ? {} : { id: { in: schoolIds(s) } }) },
        orderBy: { name: 'asc' },
      });
    case 'overview':
      return adminOverview(s);
    case 'followup':
      return followUp(s);
    case 'email':
      return emailStatus(s);
    case 'help-videos':
      return (await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { helpVideos: true } })).helpVideos;
    case 'accountants-report':
      return accountantsReport(s, query);
    case 'school-names': {
      // Names only (no data), to pick a school name when adding one; each accountant enters the data.
      const rows = await db.school.findMany({ where: { tenantId }, select: { name: true }, distinct: ['name'], orderBy: { name: 'asc' } });
      return [...new Set([...rows.map((r) => r.name), ...STANDARD_SCHOOLS])].sort((a, b) => a.localeCompare(b, 'ar'));
    }
    case 'addressees':
      return tenantAddressees(db, tenantId);
    case 'supplier-bank':
      return readBank(s, query);
    case 'legacy-certificates':
      return readLegacy(s, query);
    case 'telegram':
      return telegramStatus(s);
    case 'users':
      if (rid && action === 'report') return userReport(s, rid, query);
      if (rid && action === 'profile') return accountProfile(s, rid);
      requireTenantAdmin(s);
      return db.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          username: true,
          active: true,
          isTenantAdmin: true,
          memberships: { select: { schoolId: true, roles: true } },
        },
        orderBy: { name: 'asc' },
      });
  }
  throw new NotFoundException();
}

export async function writeTenant(
  s: Identity,
  t: Tx,
  resource: string,
  rid: string | undefined,
  action: string | undefined,
  method: string,
  body: any,
  /** The archive file already validated and uploaded by the controller (creation only). */
  prepared?: PreparedArchive,
) {
  const tenantId = s.user.tenantId;
  if (!['holidays', 'schools', 'archive', 'notes', 'supplier-bank'].includes(resource)) requireTenantAdmin(s);
  // Holidays and schools change fine calculations and documents: an account whose only role anywhere is the
  // read-only auditor may not touch them. A new account with no school yet may add its first one.
  const auditorOnly = s.user.memberships.length > 0 && !s.user.memberships.some((m) => m.roles.some((r) => WORK.includes(r)));
  if (['holidays', 'schools'].includes(resource) && !s.user.isTenantAdmin && auditorOnly)
    throw new ForbiddenException('هذه العملية للمحاسبين ومسؤول النظام');
  switch (resource) {
    case 'holidays': {
      if (method === 'DELETE') {
        const h = await t.holiday.findFirst({ where: { id: parse(id, rid), tenantId } });
        if (!h) throw new NotFoundException();
        await t.holiday.delete({ where: { id: h.id } });
        return { id: h.id, deleted: true };
      }
      // A range (e.g. spring break) is stored day by day; existing days are kept as they are.
      const p = parse(z.object({ from: date, to: date, name: text }).strict(), body);
      if (p.to < p.from) fail('الفترة غير صحيحة');
      const days: string[] = [];
      for (let d = p.from; d <= p.to; d = isoDay(new Date(new Date(d).getTime() + 86400000))) days.push(d);
      if (days.length > 120) fail('الفترة طويلة؛ أدخل الإجازة على فترات');
      const existing = new Set(
        (await t.holiday.findMany({ where: { tenantId, date: { in: days.map((d) => new Date(d)) } } })).map((h) => isoDay(h.date)),
      );
      const fresh = days.filter((d) => !existing.has(d));
      await t.holiday.createMany({ data: fresh.map((d) => ({ tenantId, date: new Date(d), name: p.name, createdBy: s.user.id })) });
      return { id: tenantId, created: fresh.length, skipped: days.length - fresh.length };
    }
    case 'policy': {
      const p = parse(
        z
          .object({ key: z.enum(policyKeys as [PolicyKey, ...PolicyKey[]]), value: z.unknown(), effectiveFrom: date, reason: text })
          .strict(),
        body,
      );
      const value = parse(POLICY[p.key].schema as z.ZodType<unknown>, p.value);
      if (p.effectiveFrom < today()) fail('تاريخ السريان لا يكون في الماضي حتى لا تتغير معاملات سابقة');
      return t.policySetting.create({
        data: {
          tenantId,
          key: p.key,
          value: value as any,
          effectiveFrom: new Date(p.effectiveFrom),
          reason: p.reason,
          createdBy: s.user.id,
        },
      });
    }
    case 'budget-catalog': {
      const p = parse(
        z
          .object({
            code: text,
            nameAr: text,
            nameEn: optionalText(150),
            assetCode: z.string().trim().max(30).default(''),
            groupKey: z.enum(['INSTRUCTIONAL', 'NON_INSTRUCTIONAL', 'MAINTENANCE', 'STUDENT', 'OTHER']),
            note: optionalText(500),
            sort: z.number().int().min(0).max(1000).default(0),
            active: z.boolean().default(true),
          })
          .strict(),
        body,
      );
      if (rid) {
        const row = await t.budgetCatalog.findFirst({ where: { id: parse(id, rid), tenantId } });
        if (!row) throw new NotFoundException();
        return t.budgetCatalog.update({ where: { id: row.id }, data: p });
      }
      return t.budgetCatalog.create({ data: { ...p, tenantId } });
    }
    case 'schools': {
      const p = parse(
        z
          .object({
            code: z.string().trim().max(30).optional(),
            name: text,
            principal: text,
            pettyCustodian: optionalText(100),
            educationCustodian: optionalText(100),
            bookCustodian: optionalText(100),
            purchasingOfficer: optionalText(100),
            orderPrefix: z
              .string()
              .trim()
              .regex(/^[A-Za-z0-9]{0,12}$/, 'رمز أوامر الشراء: حروف إنجليزية وأرقام فقط')
              .default(''),
            active: z.boolean().optional(),
            erpCode: z.string().trim().max(40).optional(),
            lat: z.number().min(-90).max(90).nullable().optional(),
            lng: z.number().min(-180).max(180).nullable().optional(),
          })
          .strict(),
        body,
      );
      if ((p.lat == null) !== (p.lng == null)) fail('موقع المدرسة: خط العرض وخط الطول معاً');
      if (rid) {
        const row = await t.school.findFirst({ where: { id: parse(id, rid), tenantId } });
        if (!row) throw new NotFoundException();
        // Members edit their own schools; suspending a school is for the system administrator.
        if (!s.user.isTenantAdmin && (!schoolIds(s).includes(row.id) || p.active !== undefined)) requireTenantAdmin(s);
        return t.school.update({ where: { id: row.id }, data: { ...p, code: p.code || row.code } });
      }
      const code = p.code || `SCH-${String((await t.school.count({ where: { tenantId } })) + 1).padStart(3, '0')}`;
      if (await t.school.findFirst({ where: { tenantId, code } })) fail('رمز المدرسة مستخدم');
      const created = await t.school.create({ data: { ...p, code, active: p.active ?? true, tenantId, createdBy: s.user.id } });
      // The user who adds a school works in it right away; the current fiscal year is opened for it.
      await t.membership.create({
        data: { tenantId, schoolId: created.id, userId: s.user.id, roles: s.user.isTenantAdmin ? ['ACCOUNTANT', 'ADMIN'] : ['ACCOUNTANT'] },
      });
      const year = new Date().getFullYear();
      await t.fiscalYear.create({
        data: { schoolId: created.id, label: String(year), startDate: new Date(`${year}-01-01`), endDate: new Date(`${year}-12-31`) },
      });
      const catalog = await t.budgetCatalog.findMany({ where: { tenantId, active: true }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
      const y = await t.fiscalYear.findFirstOrThrow({ where: { schoolId: created.id } });
      await t.budget.createMany({
        data: catalog.map((c, i) => ({
          schoolId: created.id,
          yearId: y.id,
          code: c.code,
          name: c.nameAr,
          nameEn: c.nameEn,
          assetCode: c.assetCode,
          groupKey: c.groupKey,
          sort: i,
          approved: 0,
        })),
      });
      await addStandardSuppliers(t, created.id);
      return created;
    }
    case 'supplier-bank':
      if (rid === 'standard') {
        if (!s.user.isTenantAdmin && auditorOnly) throw new ForbiddenException('هذه العملية للمحاسبين');
        return { added: await ensureSupplierCards(t, tenantId) };
      }
      return writeBank(s, t, rid, method, body);
    case 'addressees': {
      // The departments a certificate or covering letter may be addressed to; the list grows as needed.
      const p = parse(z.object({ list: z.array(z.string().trim().min(2).max(120)).min(1).max(30) }).strict(), body);
      const list = [...new Set(p.list)];
      return t.tenant.update({ where: { id: tenantId }, data: { addressees: list }, select: { addressees: true } });
    }
    case 'telegram':
      if (rid === 'config') return saveTelegramConfig(s, t, body);
      throw new NotFoundException();
    case 'purge':
      return purge(s, t, body);
    case 'archive':
      return writeArchive(s, t, rid, method, prepared);
    case 'onedrive':
      if (rid === 'disconnect') return disconnect(s, t);
      if (rid === 'config') return saveConfig(s, t, body);
      throw new NotFoundException();
    case 'notes':
      return writeNotes(s, t, rid, method, body);
    case 'email':
      if (rid === 'config') return saveEmailConfig(s, t, body);
      throw new NotFoundException();
    case 'help-videos': {
      const p = parse(
        z.record(
          z.string().max(40),
          z.union([
            z.literal(''),
            z
              .string()
              .trim()
              .max(500)
              .regex(/^https:\/\/\S+$/i, 'الرابط يجب أن يبدأ بـ https://'),
          ]),
        ),
        body,
      );
      return t.tenant.update({ where: { id: tenantId }, data: { helpVideos: p }, select: { helpVideos: true } });
    }
    case 'users':
      return manageUser(s, t, rid, action, body);
    case 'memberships': {
      const p = parse(
        z
          .object({
            username: z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),
            name: z.string().trim().max(150).optional(),
            password: z.string().min(8).max(128).optional(),
            schoolId: id,
            roles: z.array(z.enum(ROLES)),
          })
          .strict(),
        body,
      );
      const school = await t.school.findFirst({ where: { id: p.schoolId, tenantId } });
      if (!school) throw new NotFoundException('المدرسة غير موجودة');
      let user = await t.user.findUnique({ where: { username: p.username } });
      if (user && user.tenantId !== tenantId) fail('اسم المستخدم محجوز');
      if (!p.roles.length) {
        // No roles: the user is removed from the school; the account and its history stay.
        if (!user) throw new NotFoundException();
        await t.membership.deleteMany({ where: { userId: user.id, schoolId: p.schoolId } });
        return { id: user.id, removed: true };
      }
      if (!user) {
        if (!p.name || !p.password) fail('مستخدم جديد: الاسم وكلمة المرور (8 أحرف على الأقل) مطلوبان');
        user = await t.user.create({
          data: { tenantId, username: p.username, name: p.name, passwordHash: await passwordHash(p.password), mustChangePassword: true },
        });
      }
      return t.membership.upsert({
        where: { userId_schoolId: { userId: user.id, schoolId: p.schoolId } },
        create: { tenantId, userId: user.id, schoolId: p.schoolId, roles: p.roles },
        update: { roles: p.roles },
      });
    }
  }
  throw new NotFoundException();
}

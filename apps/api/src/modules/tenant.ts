import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { isoDay, today } from '../common/dates';
import { date, fail, id, optionalText, parse, text } from '../common/validation';
import { passwordHash, requireTenantAdmin, ROLES, schoolIds, type Identity } from '../core/identity';
import { loadPolicy, POLICY, policyKeys, type PolicyKey } from '../core/policy';

/**
 * Tenant-wide settings under /api/admin/…: official holidays, financial policy, the official
 * budget catalog, schools and user memberships. Reading is open to every signed-in user of the
 * tenant (screens need them); changes are for the system administrator only.
 */
export async function readTenant(s: Identity, resource: string, query: Record<string, any>) {
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
      const history = await db.policySetting.findMany({ where: { tenantId }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 200 });
      return {
        current: await loadPolicy(db, tenantId),
        definitions: policyKeys.map((k) => ({ key: k, label: POLICY[k].label, help: POLICY[k].help, default: POLICY[k].value })),
        history,
      };
    }
    case 'budget-catalog':
      return db.budgetCatalog.findMany({ where: { tenantId }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
    case 'schools':
      return db.school.findMany({
        where: { tenantId, ...(s.user.isTenantAdmin ? {} : { id: { in: schoolIds(s) } }) },
        orderBy: { name: 'asc' },
      });
    case 'users':
      requireTenantAdmin(s);
      return db.user.findMany({
        where: { tenantId },
        select: { id: true, name: true, username: true, active: true, isTenantAdmin: true, memberships: { select: { schoolId: true, roles: true } } },
        orderBy: { name: 'asc' },
      });
  }
  throw new NotFoundException();
}

export async function writeTenant(s: Identity, t: Tx, resource: string, rid: string | undefined, method: string, body: any) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
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
      const existing = new Set((await t.holiday.findMany({ where: { tenantId, date: { in: days.map((d) => new Date(d)) } } })).map((h) => isoDay(h.date)));
      const fresh = days.filter((d) => !existing.has(d));
      await t.holiday.createMany({ data: fresh.map((d) => ({ tenantId, date: new Date(d), name: p.name, createdBy: s.user.id })) });
      return { id: tenantId, created: fresh.length, skipped: days.length - fresh.length };
    }
    case 'policy': {
      const p = parse(
        z.object({ key: z.enum(policyKeys as [PolicyKey, ...PolicyKey[]]), value: z.unknown(), effectiveFrom: date, reason: text }).strict(),
        body,
      );
      const value = parse(POLICY[p.key].schema as z.ZodType<unknown>, p.value);
      if (p.effectiveFrom < today()) fail('تاريخ السريان لا يكون في الماضي حتى لا تتغير معاملات سابقة');
      return t.policySetting.create({
        data: { tenantId, key: p.key, value: value as any, effectiveFrom: new Date(p.effectiveFrom), reason: p.reason, createdBy: s.user.id },
      });
    }
    case 'budget-catalog': {
      const p = parse(
        z
          .object({
            code: text,
            nameAr: text,
            nameEn: optionalText(150),
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
            code: z.string().trim().min(1).max(30),
            name: text,
            principal: text,
            pettyCustodian: optionalText(100),
            orderPrefix: z.string().regex(/^[A-Za-z0-9]{0,12}$/).default(''),
            active: z.boolean().default(true),
          })
          .strict(),
        body,
      );
      if (rid) {
        const row = await t.school.findFirst({ where: { id: parse(id, rid), tenantId } });
        if (!row) throw new NotFoundException();
        return t.school.update({ where: { id: row.id }, data: p });
      }
      const created = await t.school.create({ data: { ...p, tenantId } });
      // The creating administrator gets the ADMIN role so the school appears in their workspace.
      await t.membership.create({ data: { tenantId, schoolId: created.id, userId: s.user.id, roles: ['ADMIN'] } });
      const year = new Date().getFullYear();
      await t.fiscalYear.create({
        data: { schoolId: created.id, label: String(year), startDate: new Date(`${year}-01-01`), endDate: new Date(`${year}-12-31`) },
      });
      return created;
    }
    case 'memberships': {
      const p = parse(
        z
          .object({
            username: z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),
            name: z.string().trim().max(150).optional(),
            password: z.string().min(12).max(128).optional(),
            schoolId: id,
            roles: z.array(z.enum(ROLES)).min(1),
          })
          .strict(),
        body,
      );
      const school = await t.school.findFirst({ where: { id: p.schoolId, tenantId } });
      if (!school) throw new NotFoundException('المدرسة غير موجودة');
      let user = await t.user.findUnique({ where: { username: p.username } });
      if (user && user.tenantId !== tenantId) fail('اسم المستخدم محجوز');
      if (!user) {
        if (!p.name || !p.password) fail('مستخدم جديد: الاسم وكلمة المرور (12 حرفاً على الأقل) مطلوبان');
        user = await t.user.create({ data: { tenantId, username: p.username, name: p.name, passwordHash: await passwordHash(p.password) } });
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

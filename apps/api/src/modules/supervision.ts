import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { D, num } from '../common/money';
import { id, parse } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { positionRows } from './overview';

/**
 * The ministry's financial supervisor (المراقب المالي): an account given read-only access (role
 * SUPERVISOR) to the schools it audits, usually thirty or more. Its screen groups those schools by the
 * accountant working in each one, with the budget position, files in progress, late assignments,
 * certificates of the year, returns from audit and the warnings of every school.
 */
export async function supervision(s: Identity, query: Record<string, any>) {
  const tenantId = s.user.tenantId;
  let who = { id: s.user.id, name: s.user.name };
  let schoolIds: string[];
  if (query.user && query.user !== s.user.id) {
    // The administrator previews the screen of a supervisor.
    requireTenantAdmin(s);
    const u = await db.user.findFirst({ where: { id: parse(id, query.user), tenantId }, include: { memberships: true } });
    if (!u) throw new NotFoundException();
    who = { id: u.id, name: u.name };
    schoolIds = u.memberships.filter((m) => m.roles.includes('SUPERVISOR')).map((m) => m.schoolId);
  } else if (s.user.isTenantAdmin) {
    schoolIds = s.user.memberships.map((m) => m.schoolId);
  } else {
    schoolIds = s.user.memberships.filter((m) => m.roles.includes('SUPERVISOR')).map((m) => m.schoolId);
    if (!schoolIds.length) throw new ForbiddenException('هذه الشاشة للمراقب المالي');
  }
  const schools = await db.school.findMany({ where: { tenantId, active: true, id: { in: schoolIds } }, orderBy: { name: 'asc' } });
  const ids = schools.map((x) => x.id);
  const [rows, links, certs, returns] = await Promise.all([
    positionRows(tenantId, schools),
    db.membership.findMany({
      where: { schoolId: { in: ids }, active: true, roles: { has: 'ACCOUNTANT' }, user: { active: true, isTenantAdmin: false } },
      include: { user: { select: { id: true, name: true } } },
    }),
    db.certificate.findMany({
      where: { case: { schoolId: { in: ids }, year: { closed: false } } },
      select: { net: true, fine: true, case: { select: { schoolId: true } } },
    }),
    db.caseReturn.groupBy({ by: ['schoolId'], where: { schoolId: { in: ids }, resolvedAt: null }, _count: true }),
  ]);
  const extra = (school: string) => {
    const own = certs.filter((c) => c.case.schoolId === school);
    return {
      certificates: own.length,
      net: num(own.reduce((v, c) => v.plus(c.net), new D(0))),
      fines: num(own.reduce((v, c) => v.plus(c.fine), new D(0))),
      returns: returns.find((r) => r.schoolId === school)?._count ?? 0,
    };
  };
  const full = rows.map((r) => ({ ...r, ...extra(r.id) }));
  const groups = new Map<string, { id: string; name: string; schools: typeof full }>();
  for (const r of full) {
    const owners = links.filter((l) => l.schoolId === r.id);
    const key = owners.length
      ? owners
          .map((o) => o.user.id)
          .sort()
          .join('+')
      : '';
    const name = owners.length ? owners.map((o) => o.user.name).join(' و ') : 'بدون محاسب فعال';
    const g = groups.get(key) ?? { id: key, name, schools: [] };
    g.schools.push(r);
    groups.set(key, g);
  }
  const sum = (list: typeof full, k: 'approved' | 'committed' | 'spent' | 'available' | 'net' | 'fines') =>
    num(list.reduce((v, r) => v.plus(r[k]), new D(0)));
  const count = (list: typeof full, k: 'pending' | 'late' | 'erp' | 'certificates' | 'returns') => list.reduce((n, r) => n + r[k], 0);
  const totalsOf = (list: typeof full) => {
    const approved = Number(sum(list, 'approved')),
      used = Number(sum(list, 'committed')) + Number(sum(list, 'spent'));
    return {
      schools: list.length,
      approved: sum(list, 'approved'),
      committed: sum(list, 'committed'),
      spent: sum(list, 'spent'),
      available: sum(list, 'available'),
      used: approved > 0 ? used / approved : 0,
      pending: count(list, 'pending'),
      late: count(list, 'late'),
      erp: count(list, 'erp'),
      certificates: count(list, 'certificates'),
      net: sum(list, 'net'),
      fines: sum(list, 'fines'),
      returns: count(list, 'returns'),
      warnings: list.reduce((n, r) => n + r.warnings.filter((w) => w.level === 'danger').length, 0),
    };
  };
  const accountants = [...groups.values()]
    .map((g) => ({ ...g, totals: totalsOf(g.schools) }))
    .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || b.totals.late - a.totals.late || a.name.localeCompare(b.name, 'ar'));
  return { supervisor: who, totals: totalsOf(full), accountants };
}

/** Supervisor accounts and the schools each one audits (administrator). */
export async function supervisors(s: Identity) {
  requireTenantAdmin(s);
  const users = await db.user.findMany({
    where: { tenantId: s.user.tenantId, isTenantAdmin: false },
    select: { id: true, name: true, username: true, active: true, memberships: { select: { schoolId: true, roles: true } } },
    orderBy: { name: 'asc' },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    active: u.active,
    schools: u.memberships.filter((m) => m.roles.includes('SUPERVISOR')).map((m) => m.schoolId),
  }));
}

/**
 * POST admin/users/:id/supervise {schoolIds} — the schools this account audits as financial supervisor
 * (read-only). Other roles the account holds in a school are kept; a link left with no role is removed.
 */
export async function setSupervised(s: Identity, t: Tx, userId: string, body: unknown) {
  requireTenantAdmin(s);
  const p = parse(z.object({ schoolIds: z.array(id).max(500) }).strict(), body);
  const tenantId = s.user.tenantId;
  const user = await t.user.findFirst({ where: { id: parse(id, userId), tenantId }, include: { memberships: true } });
  if (!user) throw new NotFoundException();
  if (user.isTenantAdmin) throw new ForbiddenException('مدير النظام يرى كل المدارس');
  const valid = new Set((await t.school.findMany({ where: { tenantId, id: { in: p.schoolIds } }, select: { id: true } })).map((x) => x.id));
  const wanted = [...valid];
  for (const m of user.memberships) {
    const keep = wanted.includes(m.schoolId);
    const has = m.roles.includes('SUPERVISOR');
    if (keep && !has) await t.membership.update({ where: { id: m.id }, data: { roles: [...m.roles, 'SUPERVISOR'] } });
    if (!keep && has) {
      const roles = m.roles.filter((r) => r !== 'SUPERVISOR');
      if (roles.length) await t.membership.update({ where: { id: m.id }, data: { roles } });
      else await t.membership.delete({ where: { id: m.id } });
    }
  }
  const linked = new Set(user.memberships.map((m) => m.schoolId));
  const fresh = wanted.filter((x) => !linked.has(x));
  if (fresh.length)
    await t.membership.createMany({ data: fresh.map((schoolId) => ({ tenantId, userId: user.id, schoolId, roles: ['SUPERVISOR'] })) });
  return { id: user.id, schools: wanted.length };
}

/** POST admin/my-schools {schoolId, active} — the accountant marks a school active (counted) or not. */
export async function setMySchool(s: Identity, t: Tx, body: unknown) {
  const p = parse(z.object({ schoolId: id, active: z.boolean() }).strict(), body);
  const m = await t.membership.findFirst({ where: { userId: s.user.id, schoolId: p.schoolId } });
  if (!m) throw new NotFoundException();
  return t.membership.update({ where: { id: m.id }, data: { active: p.active } });
}

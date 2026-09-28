import { ForbiddenException, UnauthorizedException, HttpException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { db } from '../common/db';
import { hash } from '../common/crypto';

export const ROLES = ['ACCOUNTANT', 'REVIEWER', 'APPROVER', 'ERP', 'AUDITOR', 'ADMIN'] as const;
/**
 * The accountant prepares and issues the whole file (quote report, assignment, completion certificate,
 * covering letter) and runs the imprests, so every working role may do every step in its schools.
 * AUDITOR alone is read-only.
 */
export const WORK = ['ACCOUNTANT', 'REVIEWER', 'APPROVER', 'ERP', 'ADMIN'];
export const ACCOUNT = WORK,
  REVIEW = WORK,
  APPROVE = WORK,
  ERP = WORK;

const SESSION_HOURS = 8,
  IDLE_MINUTES = 30,
  COOKIE = 'sa_session';

export const passwordHash = (p: string) => argon2.hash(p, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

/** In-memory login throttling: 10 attempts per key per 10 minutes (single-instance deployment). */
const buckets = new Map<string, { n: number; start: number }>();
export function throttle(key: string) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > 600000) {
    b = { n: 0, start: now };
    buckets.set(key, b);
  }
  if (++b.n > 10) throw new HttpException('محاولات كثيرة؛ حاول بعد عشر دقائق', 429);
  if (buckets.size > 10000) for (const [k, v] of buckets) if (now - v.start > 600000) buckets.delete(k);
}

let dummy: Promise<string>;
export async function login(username: string, password: string, req: Request, res: Response) {
  throttle(req.ip || 'unknown');
  throttle('u:' + hash(username.toLowerCase()));
  const user = await db.user.findUnique({ where: { username } });
  dummy ??= passwordHash(randomBytes(30).toString('hex'));
  const valid = await argon2.verify(user?.passwordHash ?? (await dummy), password).catch(() => false);
  if (!valid || !user?.active) throw new UnauthorizedException('بيانات الدخول غير صحيحة');
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = randomBytes(32).toString('hex'),
    csrf = randomBytes(32).toString('hex');
  await db.session.create({
    data: { tokenHash: hash(token), userId: user.id, csrf, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600000) },
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_HOURS * 3600000,
    path: '/',
  });
  return { csrf, user: { id: user.id, name: user.name } };
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

export async function authenticate(req: Request) {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new UnauthorizedException('سجّل الدخول');
  const session = await db.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { include: { memberships: { include: { school: true } } } } },
  });
  const now = Date.now();
  if (!session || !session.user.active || session.expiresAt.getTime() < now || now - session.lastSeen.getTime() > IDLE_MINUTES * 60000) {
    if (session) await db.session.deleteMany({ where: { tokenHash: session.tokenHash } });
    throw new UnauthorizedException('انتهت الجلسة');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const csrf = String(req.headers['x-csrf-token'] ?? '');
    if (csrf.length !== session.csrf.length || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)))
      throw new ForbiddenException('رمز حماية الطلب غير صالح');
  }
  if (now - session.lastSeen.getTime() > 60000)
    await db.session.update({ where: { tokenHash: session.tokenHash }, data: { lastSeen: new Date() } });
  if (session.user.isTenantAdmin) await withAllSchools(session);
  return session;
}

export type Identity = Awaited<ReturnType<typeof authenticate>>;

/** The system administrator has full rights in every school of the tenant. */
const ADMIN_ROLES = ['ACCOUNTANT', 'ADMIN', 'AUDITOR'];
async function withAllSchools(session: { user: { tenantId: string; id: string; memberships: any[] } }) {
  const schools = await db.school.findMany({ where: { tenantId: session.user.tenantId } });
  for (const school of schools) {
    const m = session.user.memberships.find((x) => x.schoolId === school.id);
    if (m) m.roles = [...new Set([...m.roles, ...ADMIN_ROLES])];
    else
      session.user.memberships.push({
        id: 'tenant-admin:' + school.id,
        tenantId: school.tenantId,
        userId: session.user.id,
        schoolId: school.id,
        roles: [...ADMIN_ROLES],
        school,
      });
  }
}
export type Membership = Identity['user']['memberships'][number];

/** Membership of the user in an active school of their tenant, optionally requiring one of `roles`. */
export function scope(s: Identity, schoolId: string, roles: string[] = []): Membership {
  const m = s.user.memberships.find((m) => m.schoolId === schoolId && m.school.active);
  if (!m || m.school.tenantId !== s.user.tenantId || (roles.length && !roles.some((r) => m.roles.includes(r))))
    throw new ForbiddenException('غير مصرح بهذا الإجراء في المدرسة');
  return m;
}

/** Financial policy, the budget catalog, user accounts and data purges belong to the system administrator. */
export function requireTenantAdmin(s: Identity) {
  if (!s.user.isTenantAdmin) throw new ForbiddenException('هذا الإجراء لمسؤول النظام فقط');
}

export const schoolIds = (s: Identity) =>
  s.user.memberships.filter((m) => m.school.active && m.school.tenantId === s.user.tenantId).map((m) => m.schoolId);

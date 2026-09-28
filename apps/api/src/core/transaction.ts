import { ConflictException, NotFoundException } from '@nestjs/common';
import { db, type Tx } from '../common/db';
import { hash } from '../common/crypto';
import { fail, plain } from '../common/validation';
import type { Identity } from './identity';

/** Audit rows carry the school, or the tenant for tenant-wide settings. */
export async function audit(t: Tx, s: Identity, scopeId: string, action: string, entity: string, detail: any = {}) {
  const where = scopeId === s.user.tenantId ? { tenantId: scopeId } : { schoolId: scopeId };
  await t.audit.create({ data: { ...where, actor: s.user.id, action, entity, detail: plain(detail) } });
}

/**
 * Runs a mutation in a serializable transaction with an idempotency key: repeating the same
 * request returns the stored result, reusing a key for a different body is rejected.
 */
export async function transact(
  s: Identity,
  scopeId: string,
  op: string,
  body: any,
  key: string,
  fn: (t: Tx) => Promise<any>,
) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) fail('مفتاح الطلب مطلوب');
  const full = `${s.user.id}:${scopeId}:${op}:${key}`,
    requestHash = hash(JSON.stringify(body));
  for (let attempt = 0; attempt < 4; attempt++)
    try {
      return await db.$transaction(
        async (t) => {
          const old = await t.idempotency.findUnique({ where: { key: full } });
          if (old) {
            if (old.hash !== requestHash) throw new ConflictException('المفتاح مستخدم لطلب آخر');
            return old.result;
          }
          const result = plain(await fn(t)) ?? {};
          await audit(t, s, scopeId, op, result.id ?? scopeId, { requestHash });
          await t.idempotency.create({ data: { key: full, hash: requestHash, result } });
          return result;
        },
        { isolationLevel: 'Serializable', timeout: 20000, maxWait: 15000 },
      );
    } catch (e: any) {
      if ((e.code === 'P2034' || e.code === 'P2002') && attempt < 3) continue;
      throw e;
    }
}

/** Per school/year/type counter, e.g. TR-00001. */
export async function nextNumber(t: Tx, school: string, yearId: string, type: string) {
  const key = `${school}/${yearId}/${type}`;
  const row = await t.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export const formatNumber = (type: string, n: number) => `${type}-${n.toString().padStart(5, '0')}`;

export async function openYear(t: Tx, schoolId: string, yearId: string) {
  const y = await t.fiscalYear.findUnique({ where: { id: yearId, schoolId } });
  if (!y) throw new NotFoundException('العام غير موجود');
  if (y.closed) fail('العام المالي مغلق');
  return y;
}

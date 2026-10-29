import { db } from '../common/db';
import { seal } from './secrets';

const SEALED = 'enc:v1:';
const SECRET_FIELDS = ['aiKey', 'odSecret', 'odRefresh', 'smtpPass'] as const;

/**
 * Secrets saved before encryption existed are re-saved encrypted at start-up, so a plain-text secret
 * never stays in the database; `unseal` keeps reading both forms meanwhile.
 */
export async function resealLegacySecrets() {
  const tenants = await db.tenant.findMany({ select: { id: true, aiKey: true, odSecret: true, odRefresh: true, smtpPass: true } });
  let changed = 0;
  for (const t of tenants) {
    const data: Record<string, string> = {};
    for (const f of SECRET_FIELDS) if (t[f] && !t[f].startsWith(SEALED)) data[f] = seal(t[f]);
    if (Object.keys(data).length) {
      await db.tenant.update({ where: { id: t.id }, data });
      changed++;
    }
  }
  if (changed) console.warn('secrets_resealed', changed);
}

/** Expired sessions and idempotency keys older than a week are removed; nothing financial is touched. */
export async function cleanupExpired() {
  const day = 86400000;
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - day) } } });
  await db.idempotency.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * day) } } });
}

import { ConflictException } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { db } from '../common/db';
import { fail, parse } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { localStore } from '../core/local-store';

/** The backups screen of the system administrator. */
export function readBackups(s: Identity) {
  requireTenantAdmin(s);
  const store = localStore();
  if (!store) return { local: false };
  return {
    local: true,
    dataDir: store.dataDir,
    backupDir: store.backupDir,
    externalDir: store.externalDir(),
    busy: store.busy(),
    backups: store.list(),
  };
}

const log = (s: Identity, action: string, detail: Record<string, unknown>) =>
  db.audit.create({ data: { tenantId: s.user.tenantId, actor: s.user.id, action, entity: s.user.tenantId, detail: detail as any } });

/**
 * POST admin/backups/now — a copy now; POST admin/backups/restore {name, confirm} — back to a copy (the
 * service restarts and everyone signs in again); POST admin/backups/external {dir} — a second folder
 * (flash drive or a synced OneDrive folder) that receives every copy. Run outside the database transaction.
 */
export async function writeBackups(s: Identity, action: string | undefined, body: any) {
  requireTenantAdmin(s);
  const store = localStore();
  if (!store) fail('النسخ الاحتياطي على الخادم يعمل تلقائياً كل ليلة (انظر دليل الخادم المشترك)');
  if (store!.busy()) throw new ConflictException('عملية نسخ أو استعادة جارية؛ انتظر قليلاً');
  switch (action) {
    case 'now': {
      const b = await store!.backup('manual');
      await log(s, 'backup:manual', { name: b.name, bytes: b.bytes, external: b.external ?? '' });
      return b;
    }
    case 'restore': {
      const p = parse(z.object({ name: z.string().max(120), confirm: z.literal('استعادة') }).strict(), body);
      if (!store!.list().some((b) => b.name === p.name)) fail('النسخة غير موجودة');
      // Logged before the switch so the request stays in the current data; the restored data gets its own entry.
      await log(s, 'backup:restore-requested', { name: p.name });
      await store!.restore(p.name, s.user.id);
      return { restarting: true };
    }
    case 'external': {
      const p = parse(z.object({ dir: z.string().trim().max(400) }).strict(), body);
      if (p.dir && (!isAbsolute(p.dir) || !existsSync(p.dir) || !statSync(p.dir).isDirectory()))
        fail('اكتب مسار مجلد موجود كاملاً، مثل D:\\Backups أو مجلد OneDrive على الجهاز');
      store!.setExternalDir(p.dir);
      await log(s, 'backup:external', { dir: p.dir });
      return { externalDir: p.dir };
    }
  }
  fail('عملية غير معروفة');
}

/** Before a purge from the administrator console: a copy, so a deletion by mistake can be undone. */
export async function backupBeforePurge() {
  const store = localStore();
  if (!store) return null;
  if (store.busy()) throw new ConflictException('عملية نسخ أو استعادة جارية؛ انتظر قليلاً');
  return store.backup('purge');
}

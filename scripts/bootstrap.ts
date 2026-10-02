import { db } from '../apps/api/src/common/db';
import { passwordHash } from '../apps/api/src/core/identity';
import { BUDGET_CATALOG } from './catalog';

/**
 * First start of a real installation (empty database): creates the tenant, the system
 * administrator and the official budget catalog. Schools, users and holidays are then added from
 * the settings screens. Never creates demo data.
 *
 *   ADMIN_USERNAME=... ADMIN_NAME='...' ADMIN_PASSWORD='...' TENANT_NAME='...' npm run bootstrap
 */
async function main() {
  const { ADMIN_USERNAME, ADMIN_NAME, ADMIN_PASSWORD, TENANT_NAME } = process.env;
  if (!ADMIN_USERNAME || !/^[a-zA-Z0-9_.-]{3,50}$/.test(ADMIN_USERNAME)) throw new Error('Set ADMIN_USERNAME (letters, digits, . _ -).');
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) throw new Error('Set ADMIN_PASSWORD with 8+ characters.');
  if (await db.tenant.count()) throw new Error('Database already initialised; bootstrap runs once on an empty database.');
  const tenant = await db.tenant.create({ data: { name: TENANT_NAME || 'MOESAS' } });
  await db.user.create({
    data: {
      tenantId: tenant.id,
      username: ADMIN_USERNAME,
      name: ADMIN_NAME || ADMIN_USERNAME,
      passwordHash: await passwordHash(ADMIN_PASSWORD),
      isTenantAdmin: true,
    },
  });
  await db.budgetCatalog.createMany({ data: BUDGET_CATALOG.map((c) => ({ ...c, tenantId: tenant.id })) });
  console.log(`Initialised. Sign in as ${ADMIN_USERNAME}, then add schools from Settings and holidays from the holidays screen.`);
}

main().finally(() => db.$disconnect());

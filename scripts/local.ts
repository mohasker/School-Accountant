import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createStore, dailyBackup } from './local-backups';

/**
 * Runs MOESAS on this computer with an embedded PostgreSQL (PGlite) kept in a data folder.
 *  - regular (Start-Madar.bat): real work, data in .data/moesas, no trial data; the fixed accounts are
 *    created once (each chooses its own password at the first sign-in); the data folder is copied once a day to .data/backups (last 14 kept).
 *  - demo (npm run demo): synthetic trial data in .data/demo, for trying the system and screenshots.
 */
export async function runLocal(demo: boolean) {
  process.env.DEMO_MODE = demo ? 'true' : 'false';
  if (!demo) process.env.UPLOAD_SCANNER ||= 'none';
  process.env.NODE_ENV = 'development';
  process.env.PORT = '3001';
  process.env.DB_POOL_SIZE = '1';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres';
  // In GitHub Codespaces the app is opened through the forwarded https address of port 3000.
  const codespace = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  process.env.WEB_ORIGIN = codespace
    ? `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : process.env.WEB_ORIGIN || 'http://localhost:3000';
  const dataDir = process.env.PGLITE_DATA || (demo ? '.data/demo' : '.data/moesas');
  const backupRoot = resolve(dataDir, '..', demo ? 'demo-backups' : 'backups');
  if (!demo) dailyBackup(dataDir, backupRoot);
  let engine = await openEngine(dataDir);
  const listen = async () => {
    const server = new PGLiteSocketServer({ db: engine, host: '127.0.0.1', port: 55432, maxConnections: 20 });
    await server.start();
    return server;
  };
  let socket = await listen();
  const count = await engine.query<{ n: number }>('SELECT count(*)::int as n FROM "Tenant"');
  const fresh = count.rows[0].n === 0;
  if (fresh && !demo) {
    // A new installation: the tenant and the official budget catalog; the accounts follow in prepareRegular.
    const { BUDGET_CATALOG } = await import('./catalog');
    await engine.transaction(async (t) => {
      const tenant = await t.query<{ id: string }>(
        `INSERT INTO "Tenant" ("id", "name") VALUES (gen_random_uuid(), 'MOESAS') RETURNING "id"`,
      );
      for (const c of BUDGET_CATALOG)
        await t.query(
          `INSERT INTO "BudgetCatalog" ("id", "tenantId", "code", "nameAr", "nameEn", "assetCode", "groupKey", "note", "sort", "active")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true)`,
          [tenant.rows[0].id, c.code, c.nameAr, c.nameEn ?? '', c.assetCode ?? '', c.groupKey, c.note ?? '', c.sort ?? 0],
        );
    });
  }
  if (fresh && demo) {
    if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12)
      throw Error('Set DEMO_PASSWORD (12+ characters) before the first run.');
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { env: process.env });
  }
  const { start } = await import('../apps/api/src/main');
  let api = await start();
  if (!demo) await prepareRegular(engine);
  const { setLocalStore } = await import('../apps/api/src/core/local-store');
  setLocalStore(
    createStore({
      dataDir,
      root: backupRoot,
      engine: () => engine,
      async restart(whileClosed) {
        const { db } = await import('../apps/api/src/common/db');
        await api.close();
        await db.$disconnect();
        await socket.stop();
        await engine.close();
        try {
          await whileClosed();
        } finally {
          engine = await openEngine(dataDir);
          socket = await listen();
          api = await start();
          if (!demo) await prepareRegular(engine);
        }
      },
      async restored({ from, kept, actor }) {
        const { db } = await import('../apps/api/src/common/db');
        for (const t of await db.tenant.findMany({ select: { id: true } }))
          await db.audit.create({ data: { tenantId: t.id, actor, action: 'backup:restored', entity: t.id, detail: { from, kept } } });
      },
    }),
  );
  if (fresh && demo && process.env.DEMO_SCENARIO !== 'false') {
    console.log('Preparing the trial files (quote reports, assignments, certificates, imprests)…');
    const { runScenario } = await import('./demo-scenario');
    await runScenario('http://127.0.0.1:3001/api', process.env.WEB_ORIGIN!, process.env.DEMO_PASSWORD!).catch((e) =>
      console.error('Trial files were not completed:', e.message),
    );
  }
  const web = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      process.env.DEMO_DEV === 'true' ? 'dev' : 'start',
      'apps/web',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        API_URL: 'http://127.0.0.1:3001',
        NEXT_TELEMETRY_DISABLED: '1',
        NODE_ENV: process.env.DEMO_DEV === 'true' ? 'development' : 'production',
      },
    },
  );
  console.log(
    demo
      ? `Demo: ${process.env.WEB_ORIGIN} | Accounts: admin, accountant, other. Use your DEMO_PASSWORD.`
      : `MOESAS: ${process.env.WEB_ORIGIN} | data folder: ${resolve(dataDir)}`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    web.kill('SIGTERM');
    await api.close();
    await (await import('../apps/api/src/core/pdf')).closePdf();
    const { db } = await import('../apps/api/src/common/db');
    await db.$disconnect();
    await socket.stop();
    await engine.close();
    process.exit();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  web.on('exit', stop);
}
/** The fixed accounts of the regular installation; nobody can register from the sign-in page. */
export const LOCAL_ACCOUNTS = [
  { username: 'Admin', name: 'محمد عبد اللاه عسكر', password: 'Admin1122334455', isTenantAdmin: true },
  { username: 'accountant', name: 'المحاسب', password: 'Accountant2026', isTenantAdmin: false },
  { username: 'guest', name: 'ضيف', password: 'Guest2026', isTenantAdmin: false },
];
// The initial passwords are printed in the guide, so each account must choose its own at the first sign-in.

/**
 * One-time steps of the regular installation, each recorded so it never repeats: the three accounts
 * (created only when missing, so a changed password or a deleted account stays as the administrator
 * left it), and the suppliers of the approved workbooks in schools added before they existed.
 */
async function prepareRegular(engine: PGlite) {
  const { db } = await import('../apps/api/src/common/db');
  const { passwordHash } = await import('../apps/api/src/core/identity');
  const { addStandardSuppliers } = await import('../apps/api/src/core/suppliers-list');
  const { ensureSupplierCards, fillLegacySubjects, loadLegacyCertificates } = await import('../apps/api/src/core/standard-data');
  const once = async (name: string, step: () => Promise<void>) => {
    if ((await engine.query('SELECT 1 FROM local_migrations WHERE name=$1', [name])).rows.length) return;
    await step();
    await engine.query('INSERT INTO local_migrations VALUES ($1,$2)', [name, 'step']);
  };
  await once('step:accounts-v1', async () => {
    const tenant = await db.tenant.findFirstOrThrow();
    for (const a of LOCAL_ACCOUNTS) {
      if (await db.user.findFirst({ where: { username: { equals: a.username, mode: 'insensitive' } } })) continue;
      await db.user.create({
        data: {
          tenantId: tenant.id,
          username: a.username,
          name: a.name,
          isTenantAdmin: a.isTenantAdmin,
          passwordHash: await passwordHash(a.password),
        },
      });
      console.log('Account created: ' + a.username);
    }
  });
  await once('step:suppliers-v1', async () => {
    for (const s of await db.school.findMany({ select: { id: true } })) await db.$transaction((t) => addStandardSuppliers(t, s.id));
  });
  // The supplier bank and the reference register of the certificates issued before the system (once each).
  await once('step:cards-v1', async () => {
    for (const t of await db.tenant.findMany({ select: { id: true } })) await ensureSupplierCards(db, t.id);
  });
  await once('step:legacy-v1', async () => {
    for (const t of await db.tenant.findMany({ select: { id: true } })) await loadLegacyCertificates(db, t.id);
  });
  await once('step:legacy-subject-v1', async () => {
    for (const t of await db.tenant.findMany({ select: { id: true } })) await fillLegacySubjects(db, t.id);
  });
}

/** Opens the data folder and applies the migrations it has not seen yet (also after a restore of an older copy). */
async function openEngine(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const engine = await PGlite.create(dataDir);
  await engine.exec('CREATE TABLE IF NOT EXISTS local_migrations (name text PRIMARY KEY, hash text NOT NULL)');
  for (const name of readdirSync('prisma/migrations')
    .filter((n) => existsSync('prisma/migrations/' + n + '/migration.sql'))
    .sort()) {
    const sql = readFileSync('prisma/migrations/' + name + '/migration.sql', 'utf8'),
      hash = createHash('sha256').update(sql).digest('hex');
    const found = await engine.query<{ hash: string }>('SELECT hash FROM local_migrations WHERE name=$1', [name]);
    if (found.rows.length) {
      if (found.rows[0].hash !== hash) throw Error('Migration changed after application. Use a new migration.');
      continue;
    }
    await engine.transaction(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO local_migrations VALUES ($1,$2)', [name, hash]);
    });
  }
  return engine;
}

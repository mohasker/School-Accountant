import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

async function main() {
  process.env.DEMO_MODE = 'true';
  process.env.NODE_ENV = 'development';
  process.env.PORT = '3001';
  process.env.DB_POOL_SIZE = '1';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/postgres';
  // In GitHub Codespaces the app is opened through the forwarded https address of port 3000.
  const codespace = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  process.env.WEB_ORIGIN = codespace
    ? `https://${process.env.CODESPACE_NAME}-3000.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : process.env.WEB_ORIGIN || 'http://localhost:3000';
  const dataDir = process.env.PGLITE_DATA || '.data/demo';
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
  const socket = new PGLiteSocketServer({ db: engine, host: '127.0.0.1', port: 55432, maxConnections: 20 });
  await socket.start();
  const count = await engine.query<{ n: number }>('SELECT count(*)::int as n FROM "Tenant"');
  if (count.rows[0].n === 0) {
    if (!process.env.DEMO_PASSWORD || process.env.DEMO_PASSWORD.length < 12)
      throw Error('Set DEMO_PASSWORD (12+ characters) before the first run.');
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { env: process.env });
  }
  const { start } = await import('../apps/api/src/main');
  const api = await start();
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
    { stdio: 'inherit', env: { ...process.env, API_URL: 'http://127.0.0.1:3001', NEXT_TELEMETRY_DISABLED: '1' } },
  );
  console.log(`Demo: ${process.env.WEB_ORIGIN} | Accounts: accountant, approver, admin, other. Use your DEMO_PASSWORD.`);
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
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

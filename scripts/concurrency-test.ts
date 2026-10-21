/**
 * Concurrency test on a real PostgreSQL server (many connections), which the PGlite test suite
 * (one connection) cannot cover. It needs an EMPTY database:
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/moesas_concurrency npm run test:concurrency
 *
 * It applies the migrations, seeds the trial data, starts the API with a pool of 10 connections and
 * fires simultaneous requests at the places where a race would cost money or numbering:
 *   1. assignment numbers issued in parallel stay unique and consecutive;
 *   2. the same file issued by parallel requests is issued once;
 *   3. the same request repeated with one idempotency key has one effect;
 *   4. parallel orders cannot overcommit one budget line;
 *   5. parallel completion of one file issues one certificate;
 *   6. parallel imprest invoices cannot overdraw the imprest.
 * Exit code 0 only when every scenario holds.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: any };

const PASSWORD = 'Concurrency-Test-2026!';
const PORT = Number(process.env.CONCURRENCY_PORT || 3191);
const base = `http://127.0.0.1:${PORT}/api`;
const origin = 'http://localhost:3000';

type Session = { cookie: string; csrf: string };
async function req(s: Session | null, path: string, method = 'GET', body?: unknown, key: string = randomUUID()) {
  const r = await fetch(`${base}/${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      ...(s ? { Cookie: s.cookie, 'X-CSRF-Token': s.csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to an empty PostgreSQL database.');
  const pg = new Client({ connectionString: url });
  await pg.connect();
  const { rows } = await pg.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
  if (rows[0].n > 0) throw new Error('The database is not empty; use a fresh one (this script never touches real data).');
  for (const dir of readdirSync('prisma/migrations')
    .filter((n) => n.startsWith('2026'))
    .sort())
    await pg.query(readFileSync(`prisma/migrations/${dir}/migration.sql`, 'utf8'));
  await pg.end();
  const env = {
    ...process.env,
    DEMO_MODE: 'true',
    DEMO_PASSWORD: PASSWORD,
    SECRETS_KEY: process.env.SECRETS_KEY || 'concurrency-test-key-0123456789',
  };
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { env, stdio: 'inherit' });
  Object.assign(process.env, env, { PORT: String(PORT), DB_POOL_SIZE: '10', TELEGRAM_POLLING: 'off', WEB_ORIGIN: origin });
  const app = await (await import('../apps/api/src/main')).start();

  const login = await req(null, 'auth/login', 'POST', { username: 'accountant', password: PASSWORD });
  const s: Session = { cookie: login.cookie, csrf: login.body.csrf };
  const me = (await req(s, 'auth/me')).body;
  const school = me.schools[0].id;
  const root = (p: string) => `schools/${school}/${p}`;
  const setup = (await req(s, root('setup'))).body;
  const year = setup.years[0].id;
  const line = setup.budgets.find((b: any) => Number(b.approved) >= 50000) ?? setup.budgets[0];
  const suppliers = setup.suppliers;

  const results: [string, boolean, string][] = [];
  const check = (name: string, okay: boolean, detail: string) => results.push([name, okay, detail]);

  async function approvedCase(amount: number, budgetId = line.id) {
    const c = (
      await req(s, root('cases'), 'POST', {
        yearId: year,
        subject: 'اختبار التزامن',
        origin: 'SCHOOL',
        items: [{ name: 'صنف', unit: 'عدد', qty: '10', budgetId }],
      })
    ).body;
    const full = (await req(s, root('cases/' + c.id))).body;
    for (let i = 0; i < 3; i++)
      await req(s, root(`cases/${c.id}/quotes`), 'POST', {
        supplierId: suppliers[i].id,
        reference: 'Q' + i,
        prices: [{ itemId: full.items[0].id, price: String(amount / 10 + i) }],
        compliant: true,
        note: '',
      });
    const r = await req(s, root(`cases/${c.id}/evaluate`), 'POST', { date: '2026-08-30', reason: 'الأقل' });
    if (r.status >= 300) throw new Error('evaluate: ' + JSON.stringify(r.body));
    return c.id as string;
  }
  const issue = (id: string, key?: string) =>
    req(s, root(`cases/${id}/issue`), 'POST', { trigger: '2026-09-01', days: 10, policyConfirmed: true }, key);

  // 1. Assignment numbers.
  const ten = [];
  for (let i = 0; i < 10; i++) ten.push(await approvedCase(100));
  const issued = await Promise.all(ten.map((id) => issue(id)));
  const numbers = issued.filter((r) => r.status < 300).map((r) => r.body.orderNumber as string);
  const seq = numbers.map((n) => Number(n.split('/').pop())).sort((a, b) => a - b);
  check(
    '1. أرقام التكليف المتزامنة فريدة ومتتالية',
    numbers.length === 10 && new Set(numbers).size === 10 && seq.every((n, i) => i === 0 || n === seq[i - 1] + 1),
    `${numbers.join(' ')} — ${issued.map((r) => r.status + (r.status >= 300 ? ':' + String(r.body.message).slice(0, 70) : '')).join(', ')}`,
  );

  // 2. One file issued by parallel requests.
  const one = await approvedCase(100);
  const race = await Promise.all(Array.from({ length: 5 }, () => issue(one)));
  check(
    '2. نفس المعاملة من 5 طلبات متزامنة تصدر مرة واحدة',
    race.filter((r) => r.status < 300).length === 1,
    race.map((r) => r.status).join(','),
  );

  // 3. Idempotency key.
  const idem = await approvedCase(100);
  const key = randomUUID();
  const same = await Promise.all(Array.from({ length: 5 }, () => issue(idem, key)));
  const ok3 = same.filter((r) => r.status < 300);
  check(
    '3. نفس الطلب بنفس مفتاح التكرار له أثر واحد',
    ok3.length >= 1 && new Set(ok3.map((r) => r.body.orderNumber)).size === 1,
    same.map((r) => r.status).join(','),
  );

  // 4. Budget overcommit: two orders each above half of what is left on a fresh line.
  const fresh = setup.budgets.find((b: any) => Number(b.approved) > 0 && b.id !== line.id) ?? line;
  const left =
    Number((await req(s, root('setup'))).body.budgets.find((b: any) => b.id === fresh.id).approved) -
    Number(fresh.spent) -
    Number(fresh.committed);
  const big = Math.floor((left * 0.6) / 10) * 10;
  const [x1, x2] = [await approvedCase(big, fresh.id), await approvedCase(big, fresh.id)];
  const both = await Promise.all([issue(x1), issue(x2)]);
  check(
    '4. أمران متزامنان لا يتجاوزان رصيد البند',
    both.filter((r) => r.status < 300).length === 1,
    `${both.map((r) => r.status).join(',')} (قيمة كل أمر ${big} من ${left})`,
  );

  // 5. One certificate.
  const done = await approvedCase(100);
  await issue(done);
  const finish = await Promise.all(
    Array.from({ length: 3 }, () =>
      req(s, root(`cases/${done}/finish`), 'POST', { completionDate: '2026-09-10', invoice: 'INV-C', date: '2026-09-10' }),
    ),
  );
  const certs = (await req(s, root('cases/' + done))).body.certificates.length;
  check('5. إتمام متزامن يصدر شهادة واحدة', certs === 1, `${finish.map((r) => r.status).join(',')} — شهادات ${certs}`);

  // 6. Imprest balance.
  const imp = (
    await req(s, root('imprests'), 'POST', {
      yearId: year,
      name: 'عهدة تزامن',
      custodian: 'أمين',
      type: 'EDUCATION',
      amount: '1000',
      reference: 'C',
    })
  ).body;
  const spend = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      req(s, root(`imprests/${imp.id}/expense`), 'POST', {
        budgetId: line.id,
        vendor: 'مورد ' + i,
        invoice: 'C-' + i,
        date: '2026-09-20',
        description: 'شراء',
        amount: '400',
      }),
    ),
  );
  const balance = Number((await req(s, root('imprests?year=' + year))).body.find((a: any) => a.id === imp.id).balance);
  check(
    '6. فواتير متزامنة لا تسحب العهدة بالسالب',
    balance >= 0 && spend.filter((r) => r.status < 300).length === 2,
    `${spend.map((r) => r.status).join(',')} — الرصيد ${balance}`,
  );

  await app.close();
  (await import('../apps/api/src/core/pdf')).closePdf?.();
  const { db } = await import('../apps/api/src/common/db');
  await db.$disconnect();
  console.log('\nاختبار التزامن على PostgreSQL حقيقي');
  for (const [name, okay, detail] of results) console.log(`${okay ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed ? `\n${failed} فشل` : '\nكل السيناريوهات ناجحة');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

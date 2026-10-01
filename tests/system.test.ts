import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fine } from '../apps/api/src/core/penalty';
import { Calendar } from '../apps/api/src/common/dates';
let engine: PGlite,
  server: PGLiteSocketServer,
  app: any,
  db: any,
  school: string,
  year: string,
  budget: string,
  suppliers: any[],
  acc: any,
  other: any,
  admin: any,
  c: any;
const password = 'Synthetic-Only-Test-2026!';
const origin = 'http://localhost:3000';
const base = 'http://127.0.0.1:3101/api';
async function req(session: any, path: string, method = 'GET', data?: any, key: string = randomUUID()) {
  const r = await fetch(base + '/' + path, {
    method,
    headers: {
      Origin: origin,
      ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  return { status: r.status, body: b, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function log(username: string) {
  const r = await req(null, 'auth/login', 'POST', { username, password });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  return { cookie: r.cookie, csrf: r.body.csrf };
}
const route = (p: string) => `schools/${school}/${p}`;
async function ok(s: any, p: string, b: any, method = 'POST', key?: string) {
  const r = await req(s, route(p), method, b, key);
  assert.ok(r.status < 300, JSON.stringify(r));
  return r.body;
}
async function load(id: string) {
  const r = await req(acc, route('cases/' + id));
  assert.equal(r.status, 200);
  return r.body;
}
async function makeCase(amount = '10000.00') {
  const row = await ok(acc, 'cases', {
    yearId: year,
    subject: 'اختبار دورة كاملة',
    origin: 'SCHOOL',
    items: [{ name: 'مستلزمات تعليمية', unit: 'مجموعة', qty: '100', budgetId: budget }],
  });
  let full = await load(row.id);
  for (let i = 0; i < 3; i++)
    await ok(acc, `cases/${row.id}/quotes`, {
      supplierId: suppliers[i].id,
      reference: 'Q-' + i,
      prices: [{ itemId: full.items[0].id, price: String(Number(amount) / 100 + i * 10) }],
      compliant: true,
      note: '',
    });
  full = await load(row.id);
  await ok(acc, `cases/${row.id}/evaluate`, {
    quoteId: full.quotes.sort((a: any, b: any) => Number(a.total) - Number(b.total))[0].id,
    reason: 'الأقل المطابق',
  });
  return load(row.id);
}
async function issue(row: any) {
  await ok(acc, `cases/${row.id}/issue`, { trigger: '2026-09-01', days: 10, policyConfirmed: true });
  return load(row.id);
}
async function docs(row: any) {
  for (const code of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15]) {
    if ([11, 12, 15].includes(code)) {
      await ok(acc, `cases/${row.id}/not-applicable`, {
        code,
        reason: 'لا ينطبق على المعاملة وفق الاعتماد التجريبي',
      });
      continue;
    }
    const file = await ok(acc, `cases/${row.id}/evidence`, {
      code,
      name: 'test.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.4\nSYNTHETIC TEST DOCUMENT\n%%EOF').toString('base64'),
    });
    await ok(acc, `cases/${row.id}/verify`, {
      evidenceId: file.id,
      decision: 'VERIFIED',
      reason: 'تمت مراجعة الدليل التجريبي',
    });
  }
}
before(
  async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=1';
    process.env.DEMO_MODE = 'true';
    process.env.DB_POOL_SIZE = '1';
    process.env.SECRETS_KEY = 'test-secrets-key-0123456789';
    process.env.PORT = '3101';
    process.env.WEB_ORIGIN = origin;
    engine = await PGlite.create();
    for (const dir of readdirSync('prisma/migrations')
      .filter((n) => n.startsWith('2026'))
      .sort())
      await engine.exec(readFileSync('prisma/migrations/' + dir + '/migration.sql', 'utf8'));
    server = new PGLiteSocketServer({ db: engine, port: 55433, host: '127.0.0.1', maxConnections: 20 });
    await server.start();
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], {
      env: { ...process.env, DEMO_PASSWORD: password },
      timeout: 60000,
    });
    const api = await import('../apps/api/src/main');
    app = await api.start();
    db = (await import('../apps/api/src/common/db')).db;
    acc = await log('accountant');
    other = await log('other');
    admin = await log('admin');
    const me = await req(acc, 'auth/me');
    school = me.body.schools[0].id;
    const setup = await req(acc, route('setup'));
    year = setup.body.years[0].id;
    budget = setup.body.budgets.find((b: any) => b.code === '510401').id;
    suppliers = setup.body.suppliers;
  },
  { timeout: 120000 },
);
after(async () => {
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t = Date.now();
    await fn();
    if (process.env.DEBUG_TEARDOWN) console.error('teardown', name, Date.now() - t);
  };
  await step('app', () => app?.close());
  await step('pdf', async () => (await import('../apps/api/src/core/pdf')).closePdf());
  await step('db', () => db?.$disconnect());
  await step('server', () => server?.stop());
  await step('engine', () => engine?.close());
});
test('PEN: exact partial delivery and single cumulative cap', () => {
  assert.equal(
    fine('10000', [
      { value: '6000', lateDays: 0 },
      { value: '4000', lateDays: 5 },
    ]).current.toFixed(2),
    '200.00',
  );
  assert.equal(
    fine('10000', [
      { value: '3000', lateDays: 2 },
      { value: '4000', lateDays: 7 },
      { value: '3000', lateDays: 12 },
    ]).capped.toFixed(2),
    '700.00',
  );
  assert.equal(fine('10000', [{ value: '10000', lateDays: 20 }]).capped.toFixed(2), '1000.00');
  assert.equal(
    fine(
      '10000',
      [
        { value: '5000', lateDays: 15 },
        { value: '5000', lateDays: 15 },
      ],
      '750',
    ).current.toFixed(2),
    '250.00',
  );
  // Working days: Friday/Saturday weekend and official holidays are excluded, the start day is not counted.
  const cal = new Calendar([5, 6], new Set(['2026-09-08']));
  assert.equal(cal.addWorkingDays('2026-09-01', 10), '2026-09-16');
  assert.equal(new Calendar([5, 6], new Set()).addWorkingDays('2026-09-01', 10), '2026-09-15');
  assert.equal(cal.workingDaysBetween('2026-09-16', '2026-09-16'), 0);
  assert.equal(cal.workingDaysBetween('2026-09-16', '2026-09-19'), 1);
  assert.equal(cal.workingDaysBetween('2026-09-16', '2026-09-20'), 2);
  assert.equal(fine('10000', [{ value: '10000', lateDays: 3 }], '0', '0.02', '0.05').current.toFixed(2), '500.00');
  assert.throws(() => fine('10000', [{ value: '-1', lateDays: 1 }]));
  assert.throws(() => fine('10000', [{ value: '10001', lateDays: 1 }]));
  assert.throws(() => fine('NaN', []));
});
test('AUTH: school isolation on list, search, dashboard and mutation', async () => {
  for (const p of ['setup', 'cases?year=' + year, 'dashboard?year=' + year, 'reports?year=' + year + '&from=2026-01-01&to=2026-12-31'])
    assert.equal((await req(other, route(p))).status, 403);
  assert.equal((await req(other, route('suppliers'), 'POST', { name: 'x', cr: 'x' })).status, 403);
});
test('AUTH: CSRF rejected and logout revokes copied session', async () => {
  const session = await log('accountant');
  const bad = await req({ ...session, csrf: 'wrong' }, 'auth/logout', 'POST', {});
  assert.equal(bad.status, 403);
  assert.ok((await req(session, 'auth/logout', 'POST', {})).status < 300);
  assert.equal((await req(session, 'auth/me')).status, 401);
});
test('SUPPLIER: create/update conflict/delete/atomic duplicate import', async () => {
  const s = await ok(acc, 'suppliers', { name: 'مورد مؤقت', cr: 'TMP-1' });
  await ok(acc, 'suppliers/' + s.id, { name: 'مورد معدل', cr: 'TMP-1', version: 1 }, 'PATCH');
  assert.equal((await req(acc, route('suppliers/' + s.id), 'PATCH', { name: 'قديم', cr: 'TMP-1', version: 1 })).status, 409);
  await ok(acc, 'suppliers/' + s.id, {}, 'DELETE');
  const count = await db.supplier.count();
  assert.equal(
    (
      await req(acc, route('supplier-import'), 'POST', {
        rows: [
          { name: 'one', cr: 'DUP' },
          { name: 'two', cr: 'DUP' },
        ],
      })
    ).status,
    400,
  );
  assert.equal(await db.supplier.count(), count);
});
test('WORKFLOW: quote report awards the lowest, the accountant issues the assignment and reserves budget', async () => {
  c = await makeCase();
  assert.equal(c.total, '10000');
  assert.equal(c.state, 'APPROVED');
  assert.ok(c.evaluationHtml && c.reportDate);
  c = await issue(c);
  const b = await db.budget.findUnique({ where: { id: budget } });
  assert.equal(b.committed.toFixed(2), '10000.00');
  assert.equal(b.spent.toFixed(2), '0.00');
  // 10 working days after Tuesday 1 September 2026 (Fri/Sat excluded).
  assert.equal(day(c.dueDate), '2026-09-15');
  assert.equal(c.method, 'THREE_QUOTES');
  assert.match(c.orderNumber, /^SHFI\/2026\/\d{3}$/);
});
const day = (v: string) => v.slice(0, 10);
test('WORKFLOW: cross-school case and attachment inaccessible', async () => {
  assert.equal((await req(other, route('cases/' + c.id))).status, 403);
});
test('DELIVERY: idempotent partial acceptance, reject oversupply, rollback', async () => {
  const payload = {
      date: '2026-09-10',
      note: 'DN-01',
      invoice: 'INV-01',
      lines: [{ itemId: c.items[0].id, received: '60', accepted: '60' }],
    },
    key = randomUUID();
  const a = await ok(acc, `cases/${c.id}/deliver`, payload, 'POST', key),
    b = await ok(acc, `cases/${c.id}/deliver`, payload, 'POST', key);
  assert.equal(a.id, b.id);
  assert.equal((await load(c.id)).items[0].acceptedQty, '60');
  const bad = await req(acc, route(`cases/${c.id}/deliver`), 'POST', {
    ...payload,
    note: 'DN-BAD',
    lines: [{ itemId: c.items[0].id, received: '50', accepted: '50' }],
  });
  assert.equal(bad.status, 400);
  assert.equal((await load(c.id)).deliveries.length, 1);
});
test('DOCS: attachments are optional; forged file rejected', async () => {
  assert.equal(
    (
      await req(acc, route(`cases/${c.id}/evidence`), 'POST', {
        code: 6,
        name: 'bad.pdf',
        mime: 'application/pdf',
        base64: Buffer.from('not a PDF').toString('base64'),
      })
    ).status,
    400,
  );
  await docs(c);
});
test('FINANCE: partial certificate consumes only accepted quantity once', async () => {
  const cert = await ok(acc, `cases/${c.id}/certificate`, { kind: 'PARTIAL' });
  assert.equal(cert.gross, '6000');
  assert.equal(cert.fine, '0');
  await ok(acc, `cases/${c.id}/cover`, { certificateId: cert.id });
  assert.equal((await req(acc, route(`cases/${c.id}/certificate`), 'POST', { kind: 'PARTIAL' })).status, 400);
  const b = await db.budget.findUnique({ where: { id: budget } });
  assert.equal(b.committed.toString(), '4000');
  assert.equal(b.spent.toString(), '6000');
});
test('FINANCE: late remainder fine 200, final certificate, covering letter, completeness, ERP no double posting', async () => {
  await ok(acc, `cases/${c.id}/deliver`, {
    date: '2026-09-22',
    note: 'DN-02',
    invoice: 'INV-02',
    lines: [{ itemId: c.items[0].id, received: '40', accepted: '40' }],
  });
  const cert = await ok(acc, `cases/${c.id}/certificate`, { kind: 'FINAL' });
  assert.equal(cert.gross, '4000');
  assert.equal(cert.fine, '200');
  assert.equal(cert.net, '3800');
  await ok(acc, `cases/${c.id}/cover`, { certificateId: cert.id });
  for (const cert of (await load(c.id)).certificates)
    for (const code of [13, 14]) {
      const e = await ok(acc, `cases/${c.id}/evidence`, {
        code,
        certificateId: cert.id,
        name: 'signed.pdf',
        mime: 'application/pdf',
        base64: Buffer.from('%PDF-1.4\nSIGNED DEMO\n%%EOF').toString('base64'),
      });
      await ok(acc, `cases/${c.id}/verify`, {
        evidenceId: e.id,
        decision: 'VERIFIED',
        reason: 'تمت مراجعة النسخة الموقعة',
      });
    }
  await ok(acc, `cases/${c.id}/complete`, {});
  const before = await db.ledger.count();
  await ok(acc, `cases/${c.id}/erp`, {
    reference: 'ERP-TEST-01',
    date: '2026-09-20',
    evidence: 'دليل قيد تجريبي',
  });
  assert.equal(await db.ledger.count(), before);
  const b = await db.budget.findUnique({ where: { id: budget } });
  assert.equal(b.committed.toString(), '0');
  assert.equal(b.spent.toString(), '10000');
  assert.equal((await load(c.id)).state, 'REGISTERED');
});
test('ARCHIVE: old certificate stays unchanged after supplier rename', async () => {
  const full = await load(c.id),
    cert = full.certificates[0],
    before = (await req(acc, route('certificates/' + cert.id))).body.html;
  const s = await db.supplier.findUnique({ where: { id: full.supplierId } });
  await ok(acc, 'suppliers/' + s.id, { name: 'اسم مورد جديد', cr: s.cr, version: s.version }, 'PATCH');
  assert.equal((await req(acc, route('certificates/' + cert.id))).body.html, before);
});
test('MINISTRY: independent direct order with no fabricated quote', async () => {
  const row = await ok(acc, 'cases', {
    yearId: year,
    subject: 'تكليف وزاري تجريبي',
    origin: 'MINISTRY',
    ministryReference: 'MIN-001',
    items: [{ name: 'مواد', unit: 'عدد', qty: '1', budgetId: budget }],
  });
  const full = await load(row.id);
  await ok(acc, `cases/${row.id}/direct-order`, {
    supplierId: suppliers[0].id,
    reason: 'الأسعار حسب كتاب الوزارة',
    prices: [{ itemId: full.items[0].id, price: '100' }],
  });
  const direct = await issue(await load(row.id));
  assert.equal(direct.quotes.length, 0);
  assert.equal(direct.orderNumber, 'MIN-001');
  await ok(acc, `cases/${row.id}/cancel`, { reason: 'إلغاء تجريبي قبل الاستلام' });
});
test('BUDGET: competing orders cannot overcommit and cancellation releases residual', async () => {
  // 50,000 remain on the line after the first file: two files of 30,000 cannot both be assigned.
  const a = await makeCase('30000'),
    b = await makeCase('30000');
  const results = await Promise.all(
    [a, b].map((x) =>
      req(acc, route(`cases/${x.id}/issue`), 'POST', {
        trigger: '2026-09-01',
        days: 10,
        policyConfirmed: true,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status < 300).length, 1);
  assert.equal(results.filter((r) => r.status === 400).length, 1);
  const winner = results[0].status < 300 ? a : b;
  await ok(acc, `cases/${winner.id}/cancel`, { reason: 'اختبار تحرير الارتباط' });
  assert.equal((await db.budget.findUnique({ where: { id: budget } })).committed.toString(), '0');
});
test('IMPREST: 75% replenishment rule, petty invoice limit, settlement documents, replenishment and close', async () => {
  const a = await ok(acc, 'imprests', {
    yearId: year,
    name: 'العهدة النثرية',
    custodian: 'مسؤول تجريبي',
    type: 'PETTY',
    amount: '4000',
    reference: 'FUND-1',
  });
  const expense = (n: number, amount: string) =>
    req(acc, route(`imprests/${a.id}/expense`), 'POST', {
      budgetId: budget,
      vendor: 'مورد نثرية ' + n,
      invoice: 'I-' + n,
      date: '2026-09-20',
      description: 'شراء مواد',
      amount,
    });
  assert.equal((await expense(0, '1200')).status, 400, 'petty invoice above the single-quote limit');
  assert.ok((await expense(1, '1000')).status < 300);
  assert.equal(
    (await req(acc, route(`imprests/${a.id}/settle`), 'POST', { type: 'REPLENISH' })).status,
    400,
    'replenishment before reaching 75%',
  );
  assert.ok((await expense(2, '1000')).status < 300);
  assert.ok((await expense(3, '1000')).status < 300);
  assert.equal(
    (
      await req(acc, route(`imprests/${a.id}/expense`), 'POST', {
        budgetId: budget,
        vendor: 'x',
        date: '2026-09-20',
        description: 'بدون فاتورة',
        amount: '10',
      })
    ).status,
    400,
    'no invoice without a note',
  );
  assert.equal((await db.imprest.findUnique({ where: { id: a.id } })).balance.toString(), '1000');
  const before = await db.ledger.count();
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'REPLENISH', date: '2026-09-21' });
  assert.equal(st.number, 1);
  const docs = (await req(acc, route(`imprests/${a.id}/${st.id}`))).body;
  assert.ok(docs.html.includes('كشف استعاضة النثرية رقم ( 1 )'));
  assert.ok(docs.html.includes('510401'));
  assert.ok(docs.cover.includes('فقط ثلاثة آلاف ريال قطري لا غير'));
  assert.equal((await db.imprest.findUnique({ where: { id: a.id } })).balance.toString(), '1000');
  await ok(acc, `imprests/${a.id}/replenish`, { settlementId: st.id, reference: 'RECEIPT-1' });
  assert.equal((await db.imprest.findUnique({ where: { id: a.id } })).balance.toString(), '4000');
  assert.equal(await db.ledger.count(), before);
  assert.equal((await req(acc, route(`imprests/${a.id}/replenish`), 'POST', { settlementId: st.id, reference: 'REPEAT' })).status, 400);
  await ok(acc, `imprests/${a.id}/erp`, { settlementId: st.id, reference: 'ERP-IMP-1' });
  await ok(acc, `imprests/${a.id}/close`, { returnReference: 'CASH-RETURN-1' });
  assert.equal((await db.imprest.findUnique({ where: { id: a.id } })).balance.toString(), '0');
});
test('IMPREST: book fair imprest is settled and closed, never replenished', async () => {
  const a = await ok(acc, 'imprests', {
    yearId: year,
    name: 'معرض الكتاب',
    custodian: 'أمين المكتبة',
    type: 'BOOK',
    amount: '3000',
    reference: 'BOOK-1',
  });
  await ok(acc, `imprests/${a.id}/expense`, {
    budgetId: budget,
    vendor: 'دار نشر',
    invoice: 'B-1',
    date: '2026-09-20',
    description: 'كتب',
    amount: '2500',
  });
  assert.equal((await req(acc, route(`imprests/${a.id}/settle`), 'POST', { type: 'REPLENISH' })).status, 400);
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'CLOSE', returnReference: 'إيصال 55' });
  assert.ok((await req(acc, route(`imprests/${a.id}/${st.id}`))).body.cover.includes('تسوية وإغلاق'));
  const closed = (await req(acc, route('imprests?year=' + year))).body.find((x: any) => x.id === a.id);
  assert.equal(closed.closed, true, 'settlement and closure are one step');
  assert.equal(Number(closed.balance), 0);
});
test('REPORTS: headers include school accountant period and isolation', async () => {
  const r = await req(acc, route(`reports?year=${year}&from=2026-01-01&to=2026-12-31`));
  assert.equal(r.status, 200);
  assert.ok(r.body.header.school);
  assert.ok(r.body.header.accountant);
  assert.ok(r.body.html.includes('01/01/2026'));
  assert.ok(r.body.rows.find((r: any) => r.id === c.id));
});
test('DATABASE: audit history immutable; invalid budget fails constraint', async () => {
  await assert.rejects(() => db.$executeRawUnsafe('UPDATE "Audit" SET action = \'tampered\''));
  await assert.rejects(() => db.budget.update({ where: { id: budget }, data: { approved: '1' } }));
});
test('CLOSED YEAR: disallows new financial writes', async () => {
  await db.fiscalYear.update({ where: { id: year }, data: { closed: true } });
  assert.equal(
    (
      await req(acc, route('cases'), 'POST', {
        yearId: year,
        subject: 'مرفوض',
        origin: 'SCHOOL',
        items: [{ name: 'x', unit: 'x', qty: '1', budgetId: budget }],
      })
    ).status,
    400,
  );
  await db.fiscalYear.update({ where: { id: year }, data: { closed: false } });
});
test('TAFQEET: Qatari riyal amount in words', async () => {
  const { tafqeet } = await import('../apps/api/src/core/tafqeet');
  assert.equal(tafqeet('2500'), 'فقط ألفان و خمسمائة ريال قطري لا غير');
  assert.equal(tafqeet('14981.25'), 'فقط أربعة عشر ألفاً و تسعمائة و واحد و ثمانون ريالاً قطرياً و خمسة و عشرون درهماً لا غير');
  assert.equal(tafqeet('3'), 'فقط ثلاثة ريالات قطرية لا غير');
  assert.equal(tafqeet('1'), 'فقط ريال قطري لا غير');
  assert.equal(tafqeet('100'), 'فقط مائة ريال قطري لا غير');
  assert.equal(tafqeet('0.5'), 'فقط خمسون درهماً لا غير');
});
test('PRINT: official templates carry the logo, order number, working-day terms and amount in words', async () => {
  const full = await load(c.id);
  const text = (html: string) => html.replace(/<[^>]+>/g, '');
  const order = text((await req(acc, route(`cases/${c.id}/order-print`))).body.html);
  assert.ok((await req(acc, route(`cases/${c.id}/order-print`))).body.html.includes('/brand/moehe-logo.png'));
  assert.ok(order.includes('رقم أمر الشراء المحلي: ' + full.orderNumber));
  assert.ok(order.includes('فقط عشرة آلاف ريال قطري لا غير'));
  assert.ok(order.includes('1% عن كل يوم عمل تأخير وبحد أقصى 10%'));
  const report = text((await req(acc, route(`cases/${c.id}/report-print`))).body.html);
  assert.ok(report.includes('تقرير دراسة عروض أسعار الشركات'));
  const final = full.certificates.find((x: any) => x.kind === 'FINAL');
  const cert = text((await req(acc, route('certificates/' + final.id))).body.html);
  assert.ok(cert.includes('شهادة إنجاز أعمال'));
  assert.ok(cert.includes('عدد أيام التأخير 5 أيام عمل'));
  assert.ok(cert.includes('قيمة الفاتورة بعد خصم قيمة غرامة التأخير'));
  assert.ok(cert.includes('فقط ثلاثة آلاف و ثمانمائة ريال قطري لا غير'));
  const cover = text((await req(acc, route(`certificates/${final.id}/cover`))).body.html);
  assert.ok(cover.includes('صرف مستحقات شركة'));
});
async function draftWithQuotes(prices: string[], subject = 'اختبار سياسة الشراء') {
  const row = await ok(acc, 'cases', {
    yearId: year,
    subject,
    origin: 'SCHOOL',
    items: [{ name: 'صنف', unit: 'عدد', qty: '1', budgetId: budget }],
  });
  const full = await load(row.id);
  for (const [i, price] of prices.entries())
    await ok(acc, `cases/${row.id}/quotes`, {
      supplierId: suppliers[i].id,
      reference: 'PQ-' + i,
      quoteDate: '2026-09-01',
      prices: [{ itemId: full.items[0].id, price }],
      compliant: true,
      note: '',
    });
  return load(row.id);
}
test('PROCUREMENT: one quote up to 1000, three above it unless exclusive, tender above 200000', async () => {
  const small = await draftWithQuotes(['950']);
  const preview = await req(acc, route(`cases/${small.id}/report-print`));
  assert.equal(preview.body.preview, true);
  await ok(acc, `cases/${small.id}/evaluate`, {});
  assert.equal((await load(small.id)).method, 'SINGLE_QUOTE');

  const mid = await draftWithQuotes(['1500']);
  const refused = await req(acc, route(`cases/${mid.id}/evaluate`), 'POST', { quoteId: mid.quotes[0].id, reason: 'عرض واحد' });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /3 عروض أسعار/);
  await ok(acc, `cases/${mid.id}/evaluate`, {
    quoteId: mid.quotes[0].id,
    reason: 'مورد وحيد',
    exclusiveReason: 'الوكيل الحصري للصنف في قطر',
  });
  const exclusive = await load(mid.id);
  assert.equal(exclusive.method, 'EXCLUSIVE');
  assert.ok(exclusive.checklist.find((x: any) => x.code === 1).waivable);

  const tender = await draftWithQuotes(['250000', '260000', '270000']);
  const blocked = await req(acc, route(`cases/${tender.id}/evaluate`), 'POST', { quoteId: tender.quotes[0].id, reason: 'الأقل' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.message, /إدارة المشتريات والمناقصات/);
  for (const x of [small, mid, tender]) await ok(acc, `cases/${x.id}/cancel`, { reason: 'تنظيف بيانات الاختبار' });
});
test('HOLIDAYS: every user maintains the official holidays', async () => {
  const r = await req(acc, 'admin/holidays', 'POST', { from: '2027-03-21', to: '2027-03-25', name: 'إجازة الربيع' });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  assert.equal(r.body.created, 5);
  const again = await req(acc, 'admin/holidays', 'POST', { from: '2027-03-25', to: '2027-03-26', name: 'إجازة الربيع' });
  assert.equal(again.body.skipped, 1);
  const list = (await req(acc, 'admin/holidays?year=2027')).body;
  assert.ok(list.some((h: any) => h.date.startsWith('2027-03-23')));
  const del = list.find((h: any) => h.date.startsWith('2027-03-26'));
  assert.equal((await req(acc, 'admin/holidays/' + del.id, 'DELETE', {})).status, 200);
});
test('POLICY: threshold changes are dated history and apply to new evaluations', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar' }).format(new Date());
  assert.equal(
    (await req(admin, 'admin/policy', 'POST', { key: 'singleQuoteLimit', value: '2000', effectiveFrom: '2020-01-01', reason: 'x' })).status,
    400,
  );
  assert.equal(
    (await req(acc, 'admin/policy', 'POST', { key: 'singleQuoteLimit', value: '2000', effectiveFrom: today, reason: 'x' })).status,
    403,
  );
  assert.equal(
    (await req(admin, 'admin/policy', 'POST', { key: 'minQuotes', value: 'three', effectiveFrom: today, reason: 'x' })).status,
    400,
  );
  const r = await req(admin, 'admin/policy', 'POST', {
    key: 'singleQuoteLimit',
    value: '2000',
    effectiveFrom: today,
    reason: 'تعميم السياسة المالية',
  });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  assert.equal((await req(acc, 'admin/policy')).status, 403, 'the financial policy is for the system administrator');
  assert.equal((await req(admin, 'admin/policy')).body.current.singleQuoteLimit, '2000');
  const x = await draftWithQuotes(['1500'], 'بعد تعديل السياسة');
  await ok(acc, `cases/${x.id}/evaluate`, { quoteId: x.quotes[0].id, reason: 'ضمن الحد الجديد' });
  assert.equal((await load(x.id)).method, 'SINGLE_QUOTE');
  await ok(acc, `cases/${x.id}/cancel`, { reason: 'تنظيف' });
  await assert.rejects(() => db.$executeRawUnsafe('DELETE FROM "PolicySetting"'));
});
test('REGISTRY: certificate register across own schools only, with Excel export', async () => {
  const full = await load(c.id);
  const mine = (await req(acc, 'registry/certificates?q=' + encodeURIComponent(full.orderNumber))).body;
  assert.equal(mine.rows?.length, 2, JSON.stringify(mine));
  const bySupplier = (await req(acc, 'registry/certificates?supplier=' + encodeURIComponent('اسم مورد جديد'))).body;
  assert.equal(bySupplier.rows?.length, 2, JSON.stringify(bySupplier));
  assert.equal(mine.heads[0], 'م');
  assert.ok(mine.rows.every((r: any) => r.schoolId === school));
  const others = await req(other, 'registry/certificates');
  assert.equal(others.body.rows?.length, 0, JSON.stringify(others));
  assert.equal((await req(other, 'registry/certificates?school=' + school)).status, 400);
  const x = (await req(acc, 'registry/certificates?format=xlsx')).body;
  assert.ok(x.base64?.length > 100, JSON.stringify(x));
});
test('BUDGET: catalog lines, school/kindergarten split, assumptions and estimate print', async () => {
  const setup = (await req(acc, route('setup?year=' + year))).body;
  const career = setup.budgets.find((b: any) => b.code === '10001');
  assert.equal(
    (
      await req(acc, route('budgets/' + career.id), 'PATCH', {
        yearId: year,
        code: '10001',
        name: career.name,
        amount: '900',
        schoolAmount: '500',
        kgAmount: '300',
        reason: 'x',
      })
    ).status,
    400,
  );
  await ok(
    acc,
    'budgets/' + career.id,
    { yearId: year, code: '10001', name: career.name, amount: '800', schoolAmount: '500', kgAmount: '300', reason: 'اعتماد' },
    'PATCH',
  );
  await ok(acc, 'budget-plan', {
    yearId: year,
    schoolBuildings: 1,
    kgBuildings: 1,
    studentsSchool: 400,
    studentsKg: 60,
    teachersSchool: 40,
    teachersKg: 6,
    adminSchool: 12,
    adminKg: 3,
  });
  assert.equal((await ok(acc, 'budgets/init', { yearId: year })).count, 0);
  const html = (await req(acc, route('budget-estimate?year=' + year))).body.html;
  assert.ok(html.includes('الموازنة التقديرية 2026'));
  assert.ok(html.includes('مواد مسار مهني'));
  assert.ok(html.includes('460'));
});
test('DASHBOARD: late orders and replenishment alerts', async () => {
  const d = (await req(acc, route('dashboard?year=' + year))).body;
  assert.ok(Array.isArray(d.alerts.replenish));
  assert.ok(Array.isArray(d.alerts.lateOrders));
});
test('LIBRARY: expense account 510201 with books on asset account 110805', async () => {
  const setup = (await req(acc, route('setup?year=' + year))).body;
  const library = setup.budgets.find((b: any) => b.code === '510201');
  assert.equal(library.assetCode, '110805');
  await ok(
    acc,
    'budgets/' + library.id,
    { yearId: year, code: '510201', name: library.name, amount: '3000', reason: 'اعتماد المكتبة' },
    'PATCH',
  );
  const a = await ok(acc, 'imprests', {
    yearId: year,
    name: 'نثرية المكتبة',
    custodian: 'أمين',
    type: 'PETTY',
    amount: '2000',
    reference: 'LIB',
  });
  const base = { budgetId: library.id, date: '2026-09-20', description: 'مكتبة', vendor: 'مكتبة تجريبية' };
  await ok(acc, `imprests/${a.id}/expense`, { ...base, invoice: 'L-1', amount: '800', asset: true });
  await ok(acc, `imprests/${a.id}/expense`, { ...base, invoice: 'L-2', amount: '700' });
  const rows = await db.expense.findMany({ where: { imprestId: a.id }, orderBy: { invoice: 'asc' } });
  assert.deepEqual(
    rows.map((r: any) => r.accountCode),
    ['110805', '510201'],
  );
  const other = setup.budgets.find((b: any) => b.code === '520601');
  assert.equal(
    (await req(acc, route(`imprests/${a.id}/expense`), 'POST', { ...base, budgetId: other.id, invoice: 'L-3', amount: '10', asset: true }))
      .status,
    400,
  );
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'CLOSE', returnReference: 'إيصال 56' });
  const html = (await req(acc, route(`imprests/${a.id}/${st.id}`))).body.html;
  assert.ok(html.includes('110805') && html.includes('510201') && html.includes('المكتبة (أصول)'));
});
test('ADMIN: system administrator sees every school, account overview and per-account report', async () => {
  const me = (await req(admin, 'auth/me')).body;
  assert.ok(me.user.isTenantAdmin);
  assert.equal((await req(acc, 'admin/overview')).status, 403);
  const o = (await req(admin, 'admin/overview')).body;
  assert.equal(o.totals.schools, 7);
  const accountant = o.accounts.find((a: any) => a.username === 'accountant');
  assert.ok(accountant.cases.done >= 1, JSON.stringify(accountant.cases));
  assert.ok(accountant.cases.open >= 0 && accountant.pettyInvoices >= 5);
  assert.ok(accountant.lastLoginAt);
  assert.ok(accountant.approvals >= 1 && accountant.certificates >= 2);
  const r = (await req(admin, `admin/users/${accountant.id}/report`)).body;
  assert.ok(r.prepared.some((c: any) => c.status === 'منجزة'));
  assert.equal(r.summary.done, r.prepared.filter((c: any) => c.status === 'منجزة').length);
  const printed = (await req(admin, `admin/users/${accountant.id}/report?format=print`)).body.html;
  assert.ok(printed.includes('تقرير أعمال الحساب'));
  assert.ok((await req(admin, `admin/users/${accountant.id}/report?format=xlsx`)).body.base64.length > 100);
  // The system administrator has full rights in every school.
  assert.equal((await req(admin, route('cases?year=' + year))).status, 200);
  const draft = await ok(acc, 'cases', {
    yearId: year,
    subject: 'فحص صلاحيات المسؤول',
    origin: 'SCHOOL',
    items: [{ name: 'x', unit: 'عدد', qty: '1', budgetId: budget }],
  });
  assert.equal((await req(admin, route(`cases/${draft.id}/cancel`), 'POST', { reason: 'إلغاء من مدير النظام' })).status, 200);
});
test('ADMIN: password reset, deactivation, role removal', async () => {
  const o = (await req(admin, 'admin/overview')).body;
  const target = o.accounts.find((a: any) => a.username === 'other');
  const session = await log('other');
  assert.ok((await req(admin, `admin/users/${target.id}/password`, 'POST', { password: 'Brand-New-Password-1' })).status < 300);
  assert.equal((await req(session, 'auth/me')).status, 401, 'reset signs out existing sessions');
  const r = await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-1' });
  assert.equal(r.status, 201);
  // A reset password is temporary: the user chooses their own before anything else.
  assert.equal((await req({ cookie: r.cookie, csrf: r.body.csrf }, 'auth/me')).body.user.mustChangePassword, true);
  assert.ok(
    (
      await req({ cookie: r.cookie, csrf: r.body.csrf }, 'auth/password', 'POST', {
        current: 'Brand-New-Password-1',
        password: 'Brand-New-Password-2',
      })
    ).status < 300,
  );
  assert.ok((await req(admin, `admin/users/${target.id}/status`, 'POST', { active: false })).status < 300);
  assert.equal((await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-2' })).status, 401);
  await req(admin, `admin/users/${target.id}/status`, 'POST', { active: true });
  const self = o.accounts.find((a: any) => a.username === 'admin');
  assert.equal((await req(admin, `admin/users/${self.id}/status`, 'POST', { active: false })).status, 400);
  const otherSchool = o.schools.find((x: any) => x.id !== school).id;
  assert.equal((await req(admin, 'admin/memberships', 'POST', { username: 'other', schoolId: otherSchool, roles: [] })).body.removed, true);
  await req(admin, 'admin/memberships', 'POST', { username: 'other', schoolId: otherSchool, roles: ['ACCOUNTANT'] });
});
test('PDF: server-side export of a stored document', async () => {
  const full = await load(c.id);
  const r = await req(acc, route(`cases/${c.id}/order-print?pdf=1`));
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.mime, 'application/pdf');
  assert.equal(Buffer.from(r.body.base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.ok(r.body.name.includes(full.orderNumber.replace(/\//g, '-')));
  const cover = await req(acc, route(`certificates/${full.certificates[0].id}/cover?pdf=1`));
  assert.equal(cover.body.mime, 'application/pdf');
});
test('FLOW: four documents — quote report (lowest wins), assignment, certificate and covering letter in one step', async () => {
  const row = await ok(acc, 'cases', {
    yearId: year,
    subject: 'توريد أقلام سبورة تفاعلية',
    origin: 'SCHOOL',
    items: [
      { name: 'قلم سبورة تفاعلية', unit: 'عدد', qty: '10', budgetId: budget },
      { name: 'بطارية احتياطية', unit: 'عدد', qty: '5', budgetId: budget },
    ],
  });
  let f = await load(row.id);
  assert.deepEqual(
    f.items.map((i: any) => i.name),
    ['قلم سبورة تفاعلية', 'بطارية احتياطية'],
    'items keep their entry order',
  );
  const quote = (supplierName: string, a: string, b: string) =>
    ok(acc, `cases/${row.id}/quotes`, {
      supplierName,
      quoteDate: '2026-09-01',
      prices: [
        { itemId: f.items[0].id, price: a },
        { itemId: f.items[1].id, price: b },
      ],
    });
  await quote('شركة جديدة للتجارة', '300', '40');
  await quote('المؤيد للخدمات التجارية ذ. م. م.', '250', '20');
  await quote('SMARTQAT TRADING', '280', '30');
  assert.equal((await req(acc, route(`cases/${row.id}/quotes`), 'POST', { supplierName: 'SMARTQAT TRADING', prices: [] })).status, 400);
  const created = await db.supplier.findFirst({ where: { schoolId: school, name: 'شركة جديدة للتجارة' } });
  assert.ok(created && created.cr === null, 'a company typed in a quote joins the supplier list');
  await ok(acc, `cases/${row.id}/evaluate`, { date: '2026-09-02' });
  f = await load(row.id);
  assert.equal(f.state, 'APPROVED');
  assert.equal(f.supplier.name, 'المؤيد للخدمات التجارية ذ. م. م.');
  assert.equal(f.total, '2600');
  assert.ok(f.evaluationHtml.includes('نوصي بتكليف شركة / المؤيد للخدمات التجارية'));
  await ok(acc, `cases/${row.id}/issue`, { trigger: '2026-09-03', days: 5, policyConfirmed: true });
  f = await load(row.id);
  assert.equal(day(f.dueDate), '2026-09-10');
  // Completed 2 working days late (Fri/Sat excluded): 2% of 2600 = 52.
  const cert = await ok(acc, `cases/${row.id}/finish`, { completionDate: '2026-09-14', invoice: 'INV-77', date: '2026-09-15' });
  assert.equal(cert.fine, '52');
  assert.equal(cert.net, '2548');
  f = await load(row.id);
  assert.equal(f.state, 'CERTIFIED');
  assert.ok(f.certificates[0].coverHtml, 'the covering letter is issued with the certificate');
  const cover = (await req(acc, route(`certificates/${cert.id}/cover`))).body.html;
  assert.ok(cover.includes('شهادة إنجاز الأعمال') && cover.includes('فاتورة بالمبلغ المستحق'));
  const d = (await req(acc, route(`dashboard?year=${year}&from=2026-09-01&to=2026-09-30`))).body;
  assert.ok(d.documents.reports.count >= 1 && d.documents.orders.count >= 1 && d.documents.certificates.count >= 1);
  assert.ok(d.monthly.length === 1 && Number(d.monthly[0].certificates) >= 2548);
  assert.ok(Number(d.budget.approved) > 0 && d.budget.lines.length > 0);
  c = f;
});
test('PERMISSIONS: accountants add schools and fiscal years; policy and purge are for the administrator', async () => {
  const sc = await req(acc, 'admin/schools', 'POST', {
    name: 'مدرسة أضافها المحاسب',
    principal: 'مدير تجريبي',
    purchasingOfficer: 'مسؤول مشتريات',
    orderPrefix: 'NEW',
  });
  assert.ok(sc.status < 300, JSON.stringify(sc.body));
  const session = await log('accountant');
  const me = (await req(session, 'auth/me')).body;
  assert.ok(me.schools.some((x: any) => x.id === sc.body.id));
  const setup = (await req(session, `schools/${sc.body.id}/setup`)).body;
  assert.equal(setup.years.length, 1);
  assert.ok(
    setup.budgets.some((b: any) => b.code === '510401'),
    'the new school starts with the official budget lines',
  );
  const y = await req(session, `schools/${sc.body.id}/years`, 'POST', { label: '2027', start: '2027-01-01', end: '2027-12-31' });
  assert.ok(y.status < 300, JSON.stringify(y.body));
  assert.equal((await req(acc, 'admin/purge', 'POST', { scope: 'transactions', confirm: 'حذف' })).status, 403);
  assert.equal((await req(acc, 'admin/budget-catalog', 'POST', { code: '1', nameAr: 'x', groupKey: 'OTHER' })).status, 403);
});
test('PURGE: the administrator deletes a file or an imprest and the budget balances are restored', async () => {
  const before = await db.budget.findUnique({ where: { id: budget } });
  assert.equal((await req(admin, 'admin/purge', 'POST', { scope: 'case', id: c.id, confirm: 'نعم' })).status, 400);
  const r = await req(admin, 'admin/purge', 'POST', { scope: 'case', id: c.id, confirm: 'حذف' });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  const after = await db.budget.findUnique({ where: { id: budget } });
  assert.equal(after.spent.toString(), before.spent.minus('2600').toString());
  assert.equal(await db.case.count({ where: { id: c.id } }), 0);
  const a = await ok(acc, 'imprests', {
    yearId: year,
    name: 'عهدة للحذف',
    custodian: 'أمين',
    type: 'OTHER',
    amount: '500',
    reference: 'DEL',
  });
  await ok(acc, `imprests/${a.id}/expense`, {
    budgetId: budget,
    vendor: 'مورد',
    invoice: 'D-1',
    date: '2026-09-20',
    description: 'بند',
    amount: '100',
  });
  const spent = (await db.budget.findUnique({ where: { id: budget } })).spent;
  assert.ok((await req(admin, 'admin/purge', 'POST', { scope: 'imprest', id: a.id, confirm: 'حذف' })).status < 300);
  assert.equal((await db.budget.findUnique({ where: { id: budget } })).spent.toString(), spent.minus(100).toString());
  await assert.rejects(() => db.$executeRawUnsafe('DELETE FROM "Ledger"'), 'history stays protected outside a purge');
});

test('QUOTES: the quote report takes only company and value; item values are set for the awarded company', async () => {
  const row = await ok(acc, 'cases', {
    yearId: year,
    subject: 'توريد أجهزة وملحقات',
    origin: 'SCHOOL',
    items: [
      { name: 'جهاز', unit: 'عدد', qty: '2', budgetId: budget },
      { name: 'ملحقات', unit: 'مجموعة', qty: '1', budgetId: budget },
    ],
  });
  for (const [name, total] of [
    ['شركة أ للتجارة', '3000'],
    ['شركة ب للتجارة', '2800'],
    ['شركة ج للتجارة', '3100'],
  ])
    await ok(acc, `cases/${row.id}/quotes`, { supplierName: name, total });
  const f = await load(row.id);
  assert.equal((await req(acc, route(`cases/${row.id}/evaluate`), 'POST', {})).status, 400, 'item values required for several items');
  const bad = await req(acc, route(`cases/${row.id}/evaluate`), 'POST', {
    values: [
      { itemId: f.items[0].id, value: '2000' },
      { itemId: f.items[1].id, value: '700' },
    ],
  });
  assert.match(bad.body.message, /لا يساوي/);
  await ok(acc, `cases/${row.id}/evaluate`, {
    values: [
      { itemId: f.items[0].id, value: '2400' },
      { itemId: f.items[1].id, value: '400' },
    ],
  });
  const done = await load(row.id);
  assert.equal(done.total, '2800');
  assert.equal(done.supplier.name, 'شركة ب للتجارة');
  assert.equal(done.items[0].unitPrice, '1200');
  // Accountants see only their own account in the school set-up.
  const setup = (await req(acc, route('setup'))).body;
  assert.ok(setup.users.every((u: any) => u.user.username === 'accountant'));
  assert.ok((await req(admin, route('setup'))).body.users.length > 1);
  await ok(acc, `cases/${row.id}/cancel`, { reason: 'تنظيف' });
});
test('REGISTERS: quote reports and assignment letters by school, accountant, company and period, with print and Excel', async () => {
  const reports = (await req(acc, 'registry/cases?type=report')).body;
  assert.ok(reports.rows.length >= 1, JSON.stringify(reports).slice(0, 200));
  assert.equal(reports.heads[1], 'رقم التقرير');
  const orders = (await req(acc, 'registry/cases?type=order&from=2026-09-01&to=2026-09-30')).body;
  assert.ok(orders.rows.length >= 1 && orders.rows.every((r: any) => r.schoolId === school));
  const me = (await req(admin, 'admin/users')).body.find((u: any) => u.username === 'accountant');
  const byAccountant = (await req(admin, `registry/cases?type=order&accountant=${me.id}`)).body;
  assert.equal(byAccountant.rows.length, (await req(admin, 'registry/cases?type=order')).body.rows.length);
  const none = (await req(acc, 'registry/cases?type=order&supplier=' + encodeURIComponent('لا توجد شركة بهذا الاسم'))).body;
  assert.equal(none.rows.length, 0);
  const printed = (await req(acc, `registry/cases?type=report&school=${school}&format=print`)).body.html;
  assert.ok(printed.includes('سجل تقارير دراسة عروض الأسعار') && printed.includes('المدرسة:'));
  assert.ok((await req(acc, 'registry/cases?type=order&format=xlsx')).body.base64.length > 100);
  // The password of 'other' was reset by the administrator test; sign in again.
  const r = await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-2' });
  const o = { cookie: r.cookie, csrf: r.body.csrf };
  assert.equal((await req(o, 'registry/cases?type=order')).body.rows.length, 0, 'another school sees nothing');
  assert.equal((await req(o, `registry/cases?type=order&school=${school}`)).status, 400);
});
test('SETTLEMENT: all invoices entered once on the settlement screen (Arabic digits accepted by the client)', async () => {
  const a = await ok(acc, 'imprests', {
    yearId: year,
    name: 'عهدة يوم التعليم',
    custodian: 'أمين العهدة',
    type: 'EDUCATION',
    amount: '2000',
    reference: 'EDU-1',
  });
  const invoices = [
    { vendor: 'مكتبة الجامعة', invoice: 'S-1', date: '2026-09-20', description: 'مستلزمات', budgetId: budget, amount: '350.5', note: '' },
    { vendor: 'مطبعة الدوحة', invoice: '', date: '2026-09-21', description: 'طباعة', budgetId: budget, amount: '120', note: 'بدون فاتورة' },
  ];
  const bad = await req(acc, route(`imprests/${a.id}/settle`), 'POST', { type: 'CLOSE', invoices: [{ ...invoices[0], amount: '9999' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /الفاتورة 1/);
  assert.equal((await req(acc, route('imprests?year=' + year))).body.find((x: any) => x.id === a.id).expenses.length, 0, 'rolled back');
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'CLOSE', invoices, returnReference: 'إيصال 57' });
  assert.equal(Number(st.amount), 470.5);
  const after = (await req(acc, route('imprests?year=' + year))).body.find((x: any) => x.id === a.id);
  assert.equal(after.expenses.length, 2);
  assert.ok(after.expenses.every((e: any) => e.settlementId === st.id));
});
test('FINANCIAL REPORT: figures and charts by group and line, with Excel; home shows incomplete files', async () => {
  const r = (await req(acc, route(`financial-report?year=${year}&from=2026-01-01&to=2026-12-31`))).body;
  for (const part of ['التقرير المالي الشامل', 'المؤشرات الرئيسية', 'شكل (1)', 'شكل (4)', '<svg', 'الموردون'])
    assert.ok(r.html.includes(part), part);
  assert.ok(!r.html.includes('التوصيات') && !r.html.includes('أبرز الملاحظات'), 'figures and charts only');
  assert.ok((await req(acc, route(`financial-report?year=${year}&format=xlsx`))).body.base64.length > 1000);
  const d = (await req(acc, route('dashboard?year=' + year))).body;
  assert.equal(typeof d.incomplete.count, 'number');
  assert.ok(Array.isArray(d.budget.groups) && d.budget.groups.length >= 1);
  assert.equal((await req(acc, `schools/00000000-0000-4000-8000-000000000000/financial-report?year=${year}`)).status, 403);
});
test('NUMBERS: hand-typed amounts in Arabic or English digits are cleaned for entry', async () => {
  const { toNumberText } = await import('../apps/web/components/NumberInput');
  assert.equal(toNumberText('١٢٬٣٤٥٫٥٠'.replace('٬', ',')), '12345.50');
  assert.equal(toNumberText('1,250.75'), '1250.75');
  assert.equal(toNumberText('۳۵۰'), '350');
  assert.equal(toNumberText('12.5.3'), '12.53');
  assert.equal(toNumberText('15.7', true), '15');
});
test('REFERENCES: assignment letters numbered SCHOOL/YEAR/NNN; certificates carry no reference box', async () => {
  const cert = (await req(acc, 'registry/certificates')).body.rows[0];
  const html = (await req(acc, `schools/${cert.schoolId}/certificates/${cert.id}`)).body.html;
  assert.ok(!html.includes('<th>المرجع</th>'), 'certificate without reference');
  const orders = (await req(acc, 'registry/cases?type=order')).body.rows;
  const numbered = orders.map((r: any) => String(r.cells[1])).filter((n: string) => /^[A-Z]+\/\d{4}\/\d{3}$/.test(n));
  assert.ok(numbered.length >= 1, JSON.stringify(orders.map((r: any) => r.cells[1])));
  const order = orders.find((r: any) => /\/\d{3}$/.test(String(r.cells[1])));
  const letter = (await req(acc, `schools/${order.schoolId}/cases/${order.id}/order-print`)).body.html;
  assert.ok(letter.includes('<th>المرجع</th>') && letter.includes(order.cells[1]));
});
test('ARCHIVE: every accountant adds and downloads shared documents; only the administrator removes', async () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  const doc = await req(acc, 'admin/archive', 'POST', {
    kind: 'CR',
    company: 'شركة الاختبار للتجارة',
    title: 'سجل تجاري ساري حتى 2027',
    note: 'رقم 123456',
    name: 'cr.pdf',
    mime: 'application/pdf',
    base64: pdf,
  });
  assert.ok(doc.status < 300, JSON.stringify(doc.body));
  // 'other' was signed out by the administrator's password reset above; sign in again with the new password.
  const o = await (async () => {
    const r = await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-2' });
    return { cookie: r.cookie, csrf: r.body.csrf };
  })();
  const list = (await req(o, 'admin/archive?q=' + encodeURIComponent('الاختبار'))).body;
  assert.equal(list.rows.length, 1, 'another school sees the shared document');
  assert.equal(list.canDelete, false);
  const file = (await req(o, 'admin/archive/' + doc.body.id)).body;
  assert.equal(file.base64, pdf);
  assert.equal((await req(acc, 'admin/archive/' + doc.body.id, 'DELETE')).status, 403);
  assert.equal(
    (
      await req(acc, 'admin/archive', 'POST', {
        ...{ kind: 'CR', company: 'x', title: 'y', name: 'a.exe', mime: 'application/x-msdownload', base64: pdf },
      })
    ).status,
    400,
  );
  assert.ok((await req(admin, 'admin/archive/' + doc.body.id, 'DELETE')).status < 300);
  assert.equal((await req(acc, 'admin/archive')).body.rows.length, 0);
});
test('NOTES: shared board is read by everyone and written by the administrator only', async () => {
  assert.equal((await req(acc, 'admin/notes', 'POST', { title: 'x', body: 'y' })).status, 403);
  const n = await req(admin, 'admin/notes', 'POST', {
    title: 'قيد تسوية العهدة',
    body: 'من حـ/ المصروفات\n  إلى حـ/ العهدة',
    category: 'قيود عامة',
    sort: 1,
  });
  assert.ok(n.status < 300, JSON.stringify(n.body));
  assert.ok((await req(acc, 'admin/notes')).body.some((x: any) => x.id === n.body.id));
  assert.ok(
    (await req(admin, 'admin/notes/' + n.body.id, 'PATCH', { title: 'قيد تسوية العهدة (محدث)', body: 'نص', sort: 2 })).status < 300,
  );
  assert.equal((await req(acc, 'admin/notes')).body.find((x: any) => x.id === n.body.id).title, 'قيد تسوية العهدة (محدث)');
});
test('LOGINS: sign-ins are recorded with the shared location and shown to the administrator only', async () => {
  const r = await req(null, 'auth/login', 'POST', {
    username: 'accountant',
    password,
    location: { lat: 25.2854, lng: 51.531, accuracy: 20 },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await req(acc, 'admin/logins')).status, 403);
  const rows = (await req(admin, 'admin/logins?take=5')).body;
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].user.username, 'accountant');
  assert.equal(rows[0].lat, 25.2854);
  assert.ok(rows[0].ip);
  assert.equal((await req(null, 'auth/login', 'POST', { username: 'accountant', password, location: { lat: 200, lng: 0 } })).status, 400);
});
test('ERP CODE: the school keeps its ERP code for the accountant', async () => {
  const s = (await req(acc, route('setup'))).body.school;
  await ok(
    acc,
    'school',
    {
      name: s.name,
      principal: s.principal,
      pettyCustodian: s.pettyCustodian,
      educationCustodian: s.educationCustodian,
      bookCustodian: s.bookCustodian,
      erpCode: 'ERP-9021',
    },
    'PATCH',
  );
  assert.equal((await req(acc, route('setup'))).body.school.erpCode, 'ERP-9021');
});
test('DIRECT EXPENSES: post to the line at once; Excel template imports all rows or nothing; administrator deletes with reversal', async () => {
  const before = (await req(acc, route('setup'))).body.budgets.find((b: any) => b.id === budget);
  const e = await ok(acc, 'direct-expenses', {
    yearId: year,
    budgetId: budget,
    date: '2026-09-10',
    description: 'شراء طابعة',
    vendor: 'مكتبة الجامعة',
    reference: 'INV-77',
    amount: '350.25',
  });
  let line = (await req(acc, route('setup'))).body.budgets.find((b: any) => b.id === budget);
  assert.equal((Number(line.spent) - Number(before.spent)).toFixed(2), '350.25');
  assert.equal(
    (
      await req(acc, route('direct-expenses'), 'POST', {
        yearId: year,
        budgetId: budget,
        date: '2099-01-01',
        description: 'x',
        amount: '1',
      })
    ).status,
    400,
  );
  const template = (await req(acc, route(`direct-expenses/template?year=${year}`))).body;
  assert.ok(template.base64.length > 1000 && template.name.endsWith('.xlsx'));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(template.base64, 'base64') as any);
  const ws = wb.getWorksheet('المصروفات')!;
  ws.spliceRows(2, 1);
  ws.addRow(['2026-09-11', '510401', 'مستلزمات معمل', 'شركة المعامل', 'A-1', 120.5, '']);
  ws.addRow(['2026-09-12', '510401', 'أحبار', 'مكتبة', 'A-2', '٧٩٫٥٠'.replace('٫', '.'), 'أرقام عربية']);
  const good = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  ws.addRow(['2026-09-13', '999999', 'بند غير موجود', '', '', 10, '']);
  const bad = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  const rejected = await req(acc, route('direct-expenses/import'), 'POST', { yearId: year, base64: bad });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.message, /الصف 4/);
  assert.equal((await req(acc, route('direct-expenses?year=' + year))).body.rows.length, 1, 'nothing saved from a bad file');
  const imported = await ok(acc, 'direct-expenses/import', { yearId: year, base64: good });
  assert.equal(imported.count, 2);
  assert.equal(imported.total, '200.00');
  line = (await req(acc, route('setup'))).body.budgets.find((b: any) => b.id === budget);
  assert.equal((Number(line.spent) - Number(before.spent)).toFixed(2), '550.25');
  const d = (await req(acc, route('dashboard?year=' + year))).body;
  assert.equal(d.documents.direct.count, 3);
  assert.equal((await req(acc, route('direct-expenses/' + e.id), 'DELETE')).status, 400);
  assert.ok((await req(admin, route('direct-expenses/' + e.id), 'DELETE')).status < 300);
  line = (await req(acc, route('setup'))).body.budgets.find((b: any) => b.id === budget);
  assert.equal((Number(line.spent) - Number(before.spent)).toFixed(2), '200.00');
});
test('REPEAT SUPPLIERS: companies bought from more than twice in the calendar year appear on the home screen', async () => {
  const buy = (vendor: string, date: string) =>
    ok(acc, 'direct-expenses', { yearId: year, budgetId: budget, date, description: 'قرطاسية', vendor, reference: '', amount: '10' });
  const list = async () => (await req(acc, route('dashboard?year=' + year))).body.alerts.repeatSuppliers;
  await buy('مؤسسة التكرار للتجارة', '2026-02-01');
  await buy('مؤسسة  التكرار للتجارة ', '2026-03-01');
  assert.ok(!(await list()).rows.some((r: any) => r.name.includes('التكرار')), 'twice is not a repeat');
  await buy('مؤسسة التكرار للتجارة', '2026-04-01');
  const r = await list();
  assert.equal(r.year, '2026');
  const row = r.rows.find((x: any) => x.name.includes('التكرار'));
  assert.ok(row, JSON.stringify(r));
  assert.equal(row.count, 3);
  assert.equal(row.direct, 3);
  for (const x of r.rows) assert.ok(x.count > 2);
});
test('AI: status and a clear message when no key is configured; only the administrator sets the key', async () => {
  const st = (await req(acc, 'ai/status')).body;
  assert.equal(typeof st.configured, 'boolean');
  if (!st.configured) {
    const r = await req(acc, 'ai/chat', 'POST', { school, year, messages: [{ role: 'user', content: 'مرحبا' }] });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /غير مفعّل/);
  }
  assert.equal((await req(acc, 'ai/key', 'POST', { key: 'sk-ant-abcdefghijklmnopqrstuvwxyz' })).status, 403);
  assert.equal((await req(admin, 'ai/key', 'POST', { key: 'bad-key' })).status, 400);
  assert.equal((await req(acc, 'ai/chat', 'POST', { school, year, messages: [{ role: 'assistant', content: 'x' }] })).status, 400);
});
test('ONEDRIVE: archive files go to the linked OneDrive; secrets stay encrypted; falls back to the database when unlinked', async () => {
  const { createServer } = await import('node:http');
  const files = new Map<string, Buffer>();
  const counters = { n: 0, refreshValid: true, refreshUses: 0 };
  const chunks = (q: any) =>
    new Promise<Buffer>((res) => {
      const parts: Buffer[] = [];
      q.on('data', (d: Buffer) => parts.push(d)).on('end', () => res(Buffer.concat(parts)));
    });
  let mock = '';
  const ms = createServer(async (q, r) => {
    const url = q.url || '';
    const body = await chunks(q);
    const json = (code: number, o: any) => (r.writeHead(code, { 'Content-Type': 'application/json' }), r.end(JSON.stringify(o)));
    if (url.endsWith('/oauth2/v2.0/token')) {
      const p = new URLSearchParams(body.toString());
      if (p.get('client_secret') !== 'the-client-secret-value') return json(401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'refresh_token') {
        counters.refreshUses++;
        if (!counters.refreshValid) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'AT-' + ++counters.n, refresh_token: 'RT-' + counters.n, expires_in: 1 });
      }
      return json(200, { access_token: 'AT-0', refresh_token: 'RT-0', expires_in: 1 });
    }
    if (url === '/v1.0/me') return json(200, { userPrincipalName: 'archive@hotmail.test' });
    if (q.method === 'PUT' && url.startsWith('/upload/')) {
      const id = 'item-' + ++counters.n;
      files.set(id, body);
      return json(201, { id, webUrl: 'https://onedrive.test/' + id });
    }
    if (!q.headers.authorization?.startsWith('Bearer AT-')) return json(401, { error: { message: 'no token' } });
    let m: RegExpMatchArray | null;
    if (q.method === 'PUT' && /\/me\/drive\/root:\/.+:\/content/.test(url)) {
      const id = 'item-' + ++counters.n;
      files.set(id, body);
      return json(201, { id, webUrl: 'https://onedrive.test/' + id });
    }
    if (q.method === 'POST' && url.includes(':/createUploadSession'))
      return json(200, { uploadUrl: `${mock}/upload/session-${++counters.n}` });
    if ((m = url.match(/\/me\/drive\/items\/([^/]+)/))) {
      const id = decodeURIComponent(m[1]);
      if (!files.has(id)) return json(404, { error: { message: 'not found' } });
      if (q.method === 'DELETE') return (files.delete(id), r.writeHead(204), r.end());
      return (r.writeHead(200), r.end(files.get(id)));
    }
    return json(404, {});
  });
  await new Promise<void>((res) => ms.listen(0, '127.0.0.1', res));
  mock = `http://127.0.0.1:${(ms.address() as any).port}`;
  process.env.OD_LOGIN_BASE = mock;
  process.env.OD_GRAPH_BASE = mock + '/v1.0';
  try {
    const pdf = (extra = 0) => Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'), Buffer.alloc(extra, 32)]);
    const add = (b: Buffer, company = 'شركة السحابة') =>
      req(acc, 'admin/archive', 'POST', {
        kind: 'CR',
        company,
        title: 'سجل',
        name: 'cr.pdf',
        mime: 'application/pdf',
        base64: b.toString('base64'),
      });

    // Unlinked: stored in the database, and only the administrator sees or changes the settings.
    const early = await add(pdf());
    assert.ok(early.status < 300, JSON.stringify(early.body));
    assert.equal((await req(acc, 'admin/onedrive')).status, 403);
    assert.equal(
      (await req(acc, 'admin/onedrive/config', 'POST', { clientId: '', secret: 'x', authority: 'common', folder: 'A' })).status,
      403,
    );
    assert.equal(
      (await req(admin, 'admin/onedrive/config', 'POST', { clientId: 'not-a-guid', secret: 'x', authority: 'common', folder: 'A' })).status,
      400,
    );
    assert.equal((await req(admin, 'admin/onedrive/connect')).status, 400, 'connecting needs saved settings');

    const cfg = { clientId: randomUUID(), secret: 'the-client-secret-value', authority: 'common', folder: 'MOESAS-Test' };
    assert.ok((await req(admin, 'admin/onedrive/config', 'POST', cfg)).status < 300);
    const st = await req(admin, 'admin/onedrive');
    assert.equal(st.body.configured, true);
    assert.equal(st.body.connected, false);
    assert.equal(st.body.inDatabase, 1);
    assert.ok(!JSON.stringify(st.body).includes(cfg.secret), 'the secret is never returned');
    const row = await db.tenant.findFirst({ where: { odClientId: cfg.clientId } });
    assert.match(row.odSecret, /^enc:v1:/);
    assert.ok(!row.odSecret.includes(cfg.secret));

    // Sign-in: the callback needs the one-time state and never reuses it.
    const url = new URL((await req(admin, 'admin/onedrive/connect')).body.url);
    assert.equal(url.origin, mock);
    assert.equal(url.searchParams.get('client_id'), cfg.clientId);
    assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/onedrive/callback');
    const state = url.searchParams.get('state')!;
    const cb = (s: string) => fetch(`${base}/onedrive/callback?code=abc&state=${s}`, { redirect: 'manual' });
    const bad = await cb('forged');
    assert.equal(bad.status, 302);
    assert.match(bad.headers.get('location')!, /onedrive=error/);
    const good = await cb(state);
    assert.equal(good.status, 302);
    assert.match(good.headers.get('location')!, /onedrive=ok/);
    assert.match((await cb(state)).headers.get('location')!, /onedrive=error/, 'state is single use');
    const linked = (await req(admin, 'admin/onedrive')).body;
    assert.equal(linked.connected, true);
    assert.equal(linked.account, 'archive@hotmail.test');
    assert.match((await db.tenant.findFirst({ where: { odClientId: cfg.clientId } })).odRefresh, /^enc:v1:/);

    // New files go to OneDrive (the database row keeps no bytes); large files use an upload session.
    const small = pdf();
    const a = await add(small);
    assert.ok(a.status < 300, JSON.stringify(a.body));
    const rowA = await db.archive.findUnique({ where: { id: a.body.id } });
    assert.equal(rowA.storage, 'ONEDRIVE');
    assert.equal(rowA.data, null);
    assert.equal(files.get(rowA.remoteId)?.equals(small), true);
    assert.equal((await req(acc, 'admin/archive/' + a.body.id)).body.base64, small.toString('base64'), 'download comes back from OneDrive');
    const bigFile = pdf(4.5 * 1024 * 1024);
    const big = await add(bigFile);
    assert.ok(big.status < 300, JSON.stringify(big.body));
    const rowB = await db.archive.findUnique({ where: { id: big.body.id } });
    assert.equal(files.get(rowB.remoteId)?.length, bigFile.length);
    const list = (await req(acc, 'admin/archive')).body;
    assert.ok(!list.rows.find((r: any) => r.id === a.body.id).remoteUrl, 'link is for the administrator only');
    assert.ok((await req(admin, 'admin/archive')).body.rows.find((r: any) => r.id === a.body.id).remoteUrl);

    // Existing database documents move over on request.
    const moved = await req(admin, 'admin/archive/migrate', 'POST', {});
    assert.equal(moved.body.moved, 1, JSON.stringify(moved.body));
    assert.equal(moved.body.remaining, 0);
    const rowE = await db.archive.findUnique({ where: { id: early.body.id } });
    assert.equal(rowE.storage, 'ONEDRIVE');
    assert.equal(rowE.data, null);
    assert.equal((await req(acc, 'admin/archive/' + early.body.id)).body.base64, pdf().toString('base64'));
    assert.equal((await req(acc, 'admin/archive/migrate', 'POST', {})).status, 403);

    // Deleting removes the file from OneDrive too.
    assert.ok((await req(admin, 'admin/archive/' + a.body.id, 'DELETE')).status < 300);
    assert.equal(files.has(rowA.remoteId), false);

    // Microsoft revoking the link gives a clear error instead of a crash.
    counters.refreshValid = false;
    const revoked = await req(acc, 'admin/archive/' + big.body.id);
    assert.equal(revoked.status, 409);
    assert.match(revoked.body.message, /OneDrive/);

    // Unlinking returns to the database.
    assert.ok((await req(admin, 'admin/onedrive/disconnect', 'POST', {})).status < 300);
    assert.equal((await req(admin, 'admin/onedrive')).body.connected, false);
    const after = await add(pdf(), 'شركة بعد الفصل');
    assert.equal((await db.archive.findUnique({ where: { id: after.body.id } })).storage, 'DATABASE');
  } finally {
    delete process.env.OD_LOGIN_BASE;
    delete process.env.OD_GRAPH_BASE;
    await new Promise((res) => ms.close(res));
  }
});

test('ACCOUNTS: a new accountant starts with no schools, adds their own, and the administrator sees everything', async () => {
  // 8-character passwords are accepted; an account is created without a school.
  const username = 'fresh.acc';
  assert.equal((await req(acc, 'admin/users', 'POST', { name: 'محاسب جديد', username, password: 'Abcd1234' })).status, 403);
  assert.equal((await req(admin, 'admin/users', 'POST', { name: 'محاسب جديد', username, password: 'short' })).status, 400);
  const u = await req(admin, 'admin/users', 'POST', { name: 'محاسب جديد', username, password: 'Abcd1234' });
  assert.ok(u.status < 300, JSON.stringify(u.body));
  const r0 = await req(null, 'auth/login', 'POST', {
    username,
    password: 'Abcd1234',
    location: { lat: 25.2855, lng: 51.531, accuracy: 20 },
  });
  const temp = { cookie: r0.cookie, csrf: r0.body.csrf };
  assert.equal((await req(temp, 'admin/schools')).status, 403, 'nothing but the password change until the user chooses a password');
  assert.ok((await req(temp, 'auth/password', 'POST', { current: 'Abcd1234', password: 'Abcd12345' })).status < 300);
  const r = await req(null, 'auth/login', 'POST', {
    username,
    password: 'Abcd12345',
    location: { lat: 25.2855, lng: 51.531, accuracy: 20 },
  });
  const fresh = { cookie: r.cookie, csrf: r.body.csrf };
  assert.equal((await req(fresh, 'auth/me')).body.schools.length, 0, 'no schools at first');
  assert.equal((await req(fresh, 'admin/schools')).body.length, 0, 'sees only their own schools');
  const names = (await req(fresh, 'admin/school-names')).body;
  assert.ok(names.length > 0 && names.every((n: any) => typeof n === 'string'), 'school names to pick from, without data');
  const sc = await req(fresh, 'admin/schools', 'POST', {
    name: names[0],
    principal: 'مدير تجريبي',
    purchasingOfficer: 'مسؤول مشتريات',
    erpCode: 'ERP-900',
    lat: 25.2854,
    lng: 51.5309,
  });
  assert.ok(sc.status < 300, JSON.stringify(sc.body));
  const me = (await req(fresh, 'auth/me')).body;
  assert.equal(me.schools.length, 1);
  assert.equal((await req(fresh, 'admin/schools')).body.length, 1);
  assert.equal((await req(fresh, `schools/${sc.body.id}/setup`)).status, 200);
  assert.equal((await req(fresh, route('setup'))).status, 403, "another accountant's school stays closed");

  // The administrator: schools added per account, the account file and the sign-in near the school.
  const o = (await req(admin, 'admin/overview')).body;
  const row = o.accounts.find((a: any) => a.username === username);
  assert.equal(row.schoolCount, 1);
  assert.equal(row.schoolsAdded, 1);
  assert.equal(o.schools.find((x: any) => x.id === sc.body.id).owner, 'محاسب جديد');
  assert.equal((await req(acc, `admin/users/${u.body.id}/profile`)).status, 403);
  const p = (await req(admin, `admin/users/${u.body.id}/profile`)).body;
  assert.equal(p.schools.length, 1);
  assert.equal(p.schools[0].erpCode, 'ERP-900');
  assert.equal(p.schools[0].addedByAccount, true);
  assert.equal(p.technical.logins, 2);
  assert.equal(p.locations.length, 2);
  assert.equal(p.locations[0].nearest.name, names[0]);
  assert.equal(p.locations[0].nearest.near, true);
  assert.ok(p.locations[0].nearest.metres < 100);
  const logins = (await req(admin, 'admin/logins?user=' + u.body.id)).body;
  assert.equal(logins[0].nearest.near, true);
});
test('ACCOUNTANTS REPORT: totals per accountant for a period, printable and as Excel', async () => {
  assert.equal((await req(acc, 'admin/accountants-report')).status, 403);
  const r = (await req(admin, 'admin/accountants-report?from=2026-01-01&to=2026-12-31')).body;
  const a = r.rows.find((x: any) => x.username === 'accountant');
  assert.ok(a.cases >= 1 && a.direct >= 1, JSON.stringify(a));
  assert.equal(
    r.totals.cases,
    r.rows.reduce((n: number, x: any) => n + x.cases, 0),
  );
  const html = (await req(admin, 'admin/accountants-report?format=print')).body.html;
  assert.ok(html.includes('تقرير إجمالي معاملات المحاسبين') && html.includes('الإجمالي'));
  assert.ok((await req(admin, 'admin/accountants-report?format=xlsx')).body.base64.length > 1000);
});

test('SUPPLIERS: a new school starts with the suppliers of the approved sheets, editable; missing ones are added on request', async () => {
  const { STANDARD_SUPPLIERS } = await import('../apps/api/src/core/suppliers-list');
  const sc = await req(acc, 'admin/schools', 'POST', { name: 'مدرسة موردي الشيتات', principal: 'مدير' });
  assert.ok(sc.status < 300, JSON.stringify(sc.body));
  const s1 = (await req(acc, `schools/${sc.body.id}/setup`)).body;
  assert.equal(s1.suppliers.length, STANDARD_SUPPLIERS.length);
  const one = s1.suppliers.find((x: any) => x.name === 'مكتبة كلمات');
  const edited = await req(acc, `schools/${sc.body.id}/suppliers/${one.id}`, 'PATCH', {
    name: 'مكتبة كلمات ذ.م.م.',
    cr: '12345',
    phone: '44440000',
    email: '',
    iban: '',
    version: one.version,
    active: true,
  });
  assert.ok(edited.status < 300, JSON.stringify(edited.body));
  const other = s1.suppliers.find((x: any) => x.name === 'مكتبة ألف ذ.م.م.');
  assert.ok((await req(acc, `schools/${sc.body.id}/suppliers/${other.id}`, 'DELETE')).status < 300);
  const added = await req(acc, `schools/${sc.body.id}/supplier-standard`, 'POST', {});
  assert.equal(added.body.added, 2, 'the deleted one and the renamed one come back; the edit stays');
  const names = (await req(acc, `schools/${sc.body.id}/setup`)).body.suppliers.map((x: any) => x.name);
  assert.ok(names.includes('مكتبة كلمات ذ.م.م.'));
});
test('LOGIN: user names are not case sensitive', async () => {
  const r = await req(null, 'auth/login', 'POST', { username: 'ACCOUNTANT', password });
  assert.ok(r.status < 300, JSON.stringify(r.body));
});
test('WELCOME: after signing in, pending work of every school with the next step', async () => {
  assert.equal((await req(null, 'welcome')).status, 401);
  const w = (await req(acc, 'welcome')).body;
  assert.ok(w.name);
  const mine = (await req(acc, 'auth/me')).body.schools.map((x: any) => x.id);
  for (const s of w.schools) {
    assert.ok(mine.includes(s.id), "only the user's schools");
    assert.ok(s.attention > 0);
    for (const c of s.items) assert.ok(c.next && typeof c.waiting === 'number');
  }
  assert.equal(
    w.totals.pending,
    w.schools.reduce((n: number, s: any) => n + s.pending, 0),
  );
  assert.equal(w.schools.length + w.clear, w.totals.schools);
  const draft = await ok(acc, 'cases', {
    yearId: year,
    subject: 'مسودة للتذكير',
    origin: 'SCHOOL',
    items: [{ name: 'أقلام', unit: 'علبة', qty: '5', budgetId: budget }],
  });
  const again = (await req(acc, 'welcome')).body;
  const row = again.schools.find((s: any) => s.id === school);
  assert.equal(again.totals.pending, w.totals.pending + 1);
  assert.ok(row.stages.report >= 1);
  assert.ok(row.items.length <= 6);
  assert.ok(draft.id);
});
test('ERP RECON: the monthly ERP report (PDF) is read by budget code, compared, settled or exported', async () => {
  const { htmlToPdf } = await import('../apps/api/src/core/pdf');
  const setup = (await req(acc, route('setup?year=' + year))).body;
  const line = setup.budgets.find((b: any) => b.code === '520801');
  // What the system holds for September 2026 on that line.
  const before = (await req(acc, 'erp-recon/parse', 'POST', { school, yearId: year, period: '2026-09', mode: 'month', base64: 'JVBERi0x' }))
    .status;
  assert.equal(before, 400, 'a broken file is refused clearly');
  const sys = async () => {
    const pdf = await htmlToPdf(
      `<html dir="rtl"><body><h3>Actual Expenses Report — Sep-2026</h3><table>
       <tr><td>الحساب</td><td>البيان</td><td>الموازنة</td><td>الفعلي</td></tr>
       <tr><td>520801</td><td>الضيافة</td><td>30,000.00</td><td>1,234.50</td></tr>
       <tr><td>999999</td><td>حساب آخر</td><td>1.00</td><td>2.00</td></tr>
       </table></body></html>`,
    );
    return (
      await req(acc, 'erp-recon/parse', 'POST', {
        school,
        yearId: year,
        period: '2026-09',
        mode: 'month',
        name: 'erp-sep.pdf',
        base64: pdf.base64,
      })
    ).body;
  };
  const r = await sys();
  const row = r.rows.find((x: any) => x.code === '520801');
  assert.ok(row, JSON.stringify(r).slice(0, 800));
  assert.deepEqual(
    [...row.lines[0]].sort((a: number, b: number) => a - b),
    [1234.5, 30000],
  );
  const l = row.lines[0];
  assert.equal(l[l.length - 1 - r.columns.col], 1234.5, 'the actual column is proposed (closest to the system)');
  const erp = 1234.5;
  const diff = Math.round((erp - Number(row.system)) * 100) / 100;
  // Save without settling: the differences are kept for the accountant.
  const saved = await ok(acc, 'erp-recon', {
    yearId: year,
    period: '2026-09',
    mode: 'month',
    fileName: 'erp-sep.pdf',
    rows: [{ budgetId: line.id, erp }],
  });
  assert.equal(saved.settled, 0);
  const xlsx = (await req(acc, route(`erp-recon/${saved.id}?format=xlsx`))).body;
  assert.ok(xlsx.base64.length > 500);
  assert.ok((await req(acc, route(`erp-recon/${saved.id}`))).body.html.includes('520801'));
  // Settle: a direct expense for the difference brings the system to the ERP figure.
  if (diff > 0) {
    const spentBefore = Number((await req(acc, route('setup?year=' + year))).body.budgets.find((b: any) => b.id === line.id).spent);
    const st = await ok(acc, 'erp-recon', {
      yearId: year,
      period: '2026-09',
      mode: 'month',
      fileName: 'erp-sep.pdf',
      settle: true,
      rows: [{ budgetId: line.id, erp }],
    });
    assert.equal(st.settled, 1);
    const spentAfter = Number((await req(acc, route('setup?year=' + year))).body.budgets.find((b: any) => b.id === line.id).spent);
    assert.equal((spentAfter - spentBefore).toFixed(2), diff.toFixed(2));
    const again = await sys();
    assert.equal(Number(again.rows.find((x: any) => x.code === '520801').system), erp, 'after settling the system matches ERP');
  }
  const o = await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-2' });
  const otherNow = { cookie: o.cookie, csrf: o.body.csrf };
  assert.equal(
    (await req(otherNow, 'erp-recon/parse', 'POST', { school, yearId: year, period: '2026-09', base64: 'JVBERi0x' })).status,
    403,
  );
  assert.equal((await req(acc, route('erp-recon?year=' + year))).body.length >= 1, true);
});
test('OVERVIEW: all schools of an accountant with budget position and warnings; the administrator picks any accountant', async () => {
  const o = (await req(acc, 'overview/schools')).body;
  const mine = (await req(acc, 'auth/me')).body.schools.length;
  assert.equal(o.schools.length, mine);
  const s1 = o.schools.find((x: any) => x.id === school);
  assert.ok(Number(s1.approved) > 0 && s1.year);
  for (const w of s1.warnings) assert.ok(['danger', 'warn', 'info'].includes(w.level) && w.text);
  assert.equal((await req(acc, 'overview/schools?user=' + randomUUID())).status, 403);
  const accId = (await req(admin, 'admin/overview')).body.accounts.find((a: any) => a.username === 'accountant').id;
  const viaAdmin = (await req(admin, 'overview/schools?user=' + accId)).body;
  assert.equal(viaAdmin.user.id, accId);
  assert.ok(viaAdmin.schools.some((x: any) => x.id === school));
  assert.ok(Array.isArray((await req(admin, 'admin/followup')).body));
  assert.equal((await req(acc, 'admin/followup')).status, 403);
  const one = (await req(admin, `admin/accountants-report?user=${accId}`)).body;
  assert.equal(one.rows.length, 1);
});
test("EMAIL: weekly reminder settings are the administrator's; each account keeps its own address; the test message lists pending files", async () => {
  process.env.EMAIL_TRANSPORT = 'json';
  try {
    assert.equal((await req(acc, 'admin/email')).status, 403);
    assert.equal((await req(acc, 'auth/email', 'POST', { email: 'not-an-email' })).status, 400);
    assert.ok((await req(acc, 'auth/email', 'POST', { email: 'acc@school.test' })).status < 300);
    assert.equal((await req(acc, 'auth/me')).body.user.email, 'acc@school.test');
    const cfg = {
      host: 'smtp.test',
      port: 587,
      user: 'mailer@test',
      pass: 'secret-pass',
      from: 'MOESAS <mailer@test>',
      digestOn: true,
      digestDay: 0,
      digestHour: 7,
    };
    assert.equal((await req(acc, 'admin/email/config', 'POST', cfg)).status, 403);
    assert.ok((await req(admin, 'admin/email/config', 'POST', cfg)).status < 300);
    const st = (await req(admin, 'admin/email')).body;
    assert.equal(st.hasPass, true);
    assert.ok(!JSON.stringify(st).includes('secret-pass'));
    assert.match((await db.tenant.findFirst({ where: { smtpHost: 'smtp.test' } })).smtpPass, /^enc:v1:/);
    // Test message to the administrator needs his address first.
    assert.equal((await req(admin, 'email/send', 'POST', { test: true })).status, 400);
    const adminId = (await req(admin, 'auth/me')).body.user.id;
    assert.ok(
      (await req(admin, `admin/users/${adminId}`, 'POST', { name: 'مدير النظام', isTenantAdmin: true, email: 'admin@school.test' }))
        .status < 300,
    );
    const t = (await req(admin, 'email/send', 'POST', { test: true })).body;
    assert.equal(t.sent, 1);
    const msg = JSON.parse(t.messages[0]);
    assert.equal(msg.to[0].address, 'admin@school.test');
    assert.match(msg.html, /المعاملات المعلقة|لا توجد معاملات معلقة/);
    const all = (await req(admin, 'email/send', 'POST', { test: false })).body;
    assert.ok(all.recipients >= 2);
  } finally {
    delete process.env.EMAIL_TRANSPORT;
  }
});
test('HELP: video links are set by the administrator and read by everyone', async () => {
  assert.equal((await req(acc, 'admin/help-videos', 'POST', { case: 'https://example.com/v' })).status, 403);
  assert.equal((await req(admin, 'admin/help-videos', 'POST', { case: 'not a url' })).status, 400);
  assert.ok((await req(admin, 'admin/help-videos', 'POST', { case: 'https://example.com/case-video' })).status < 300);
  assert.equal((await req(acc, 'admin/help-videos')).body.case, 'https://example.com/case-video');
});
test('HARDENING: forged archive metadata, auditor edits, sign-in throttle, video links and the first-password rule', async () => {
  // A row can never be created with client-chosen storage/remoteId (that would read any OneDrive item).
  const forged = {
    kind: 'OTHER',
    company: 'x',
    title: 'x',
    note: '',
    name: 'x.pdf',
    mime: 'application/pdf',
    size: 1,
    hash: 'a'.repeat(64),
    storage: 'ONEDRIVE',
    remoteId: 'item-forged',
    remoteUrl: '',
  };
  assert.equal((await req(acc, 'admin/archive', 'PATCH', forged)).status, 404);
  assert.equal((await req(acc, 'admin/archive/anything', 'POST', forged)).status, 404);
  assert.equal((await req(acc, 'admin/archive', 'POST', forged)).status, 400, 'creation goes through the validated upload only');
  assert.equal(await db.archive.count({ where: { remoteId: 'item-forged' } }), 0);

  // A read-only auditor may not change holidays (they feed the fine calculation) nor add schools.
  const auditorName = 'auditor.only';
  const created = await req(admin, 'admin/memberships', 'POST', {
    username: auditorName,
    name: 'مدقق',
    password: 'Audit1234',
    schoolId: school,
    roles: ['AUDITOR'],
  });
  assert.ok(created.status < 300, JSON.stringify(created.body));
  const a = await req(null, 'auth/login', 'POST', { username: auditorName, password: 'Audit1234' });
  const auditor = { cookie: a.cookie, csrf: a.body.csrf };
  assert.equal((await req(auditor, 'auth/me')).body.user.mustChangePassword, true, 'a known initial password must be changed');
  assert.ok((await req(auditor, 'auth/password', 'POST', { current: 'Audit1234', password: 'Audit12345' })).status < 300);
  const b = await req(null, 'auth/login', 'POST', { username: auditorName, password: 'Audit12345' });
  assert.ok(b.status < 300);
  const auditorNow = { cookie: b.cookie, csrf: b.body.csrf };
  assert.equal((await req(auditorNow, 'auth/me')).body.user.mustChangePassword, false);
  assert.equal((await req(auditorNow, 'admin/holidays', 'POST', { from: '2026-11-01', to: '2026-11-30', name: 'x' })).status, 403);
  assert.equal((await req(auditorNow, 'admin/schools', 'POST', { name: 'مدرسة المدقق', principal: 'x' })).status, 403);

  // Only failed attempts count: many correct sign-ins never lock anyone out.
  for (let i = 0; i < 12; i++) assert.ok((await req(null, 'auth/login', 'POST', { username: 'accountant', password })).status < 300);
  for (let i = 0; i < 10; i++) await req(null, 'auth/login', 'POST', { username: 'nobody.here', password: 'wrong-wrong' });
  assert.equal((await req(null, 'auth/login', 'POST', { username: 'nobody.here', password: 'wrong-wrong' })).status, 429);
  assert.ok((await req(null, 'auth/login', 'POST', { username: 'accountant', password })).status < 300, 'other accounts stay usable');

  // Help-video links: https only (never javascript:).
  assert.equal((await req(admin, 'admin/help-videos', 'POST', { case: 'javascript:alert(1)' })).status, 400);
  assert.equal((await req(admin, 'admin/help-videos', 'POST', { case: 'http://example.com/v' })).status, 400);
});

test('SERVER GATES: temporary password blocks the API, uploads must match their type, forwarded addresses are not trusted, maintenance jobs', async () => {
  const u = await req(admin, 'admin/users', 'POST', { name: 'حساب مؤقت', username: 'gate.user', password: 'Gate12345' });
  assert.ok(u.status < 300, JSON.stringify(u.body));
  const g = await req(null, 'auth/login', 'POST', { username: 'gate.user', password: 'Gate12345' });
  const gate = { cookie: g.cookie, csrf: g.body.csrf };
  assert.equal((await req(gate, 'auth/me')).status, 200);
  assert.equal((await req(gate, 'welcome')).status, 403, 'enforced by the server, not only the screen');
  assert.equal((await req(gate, 'overview/schools')).status, 403);
  assert.equal((await req(gate, 'admin/schools', 'POST', { name: 'x', principal: 'y' })).status, 403);
  assert.ok((await req(gate, 'auth/password', 'POST', { current: 'Gate12345', password: 'Gate123456' })).status < 300);
  const g2 = await req(null, 'auth/login', 'POST', { username: 'gate.user', password: 'Gate123456' });
  assert.equal((await req({ cookie: g2.cookie, csrf: g2.body.csrf }, 'welcome')).status, 200);

  // Archive files get the same type check as attachments: PNG bytes labelled as PDF are refused.
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).toString('base64');
  const forged = await req(acc, 'admin/archive', 'POST', {
    kind: 'OTHER',
    company: 'x',
    title: 'x',
    note: '',
    name: 'x.pdf',
    mime: 'application/pdf',
    base64: png,
  });
  assert.equal(forged.status, 400);
  assert.match(forged.body.message, /لا يطابق نوعه/);
  assert.ok(
    (
      await req(acc, 'admin/archive', 'POST', {
        kind: 'OTHER',
        company: 'x',
        title: 'png ok',
        note: '',
        name: 'x.png',
        mime: 'image/png',
        base64: png,
      })
    ).status < 300,
  );

  // Without a trusted proxy a forged X-Forwarded-For never reaches the sign-in log.
  const spoof = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9' },
    body: JSON.stringify({ username: 'gate.user', password: 'Gate123456' }),
  });
  assert.ok(spoof.status < 300);
  const last = await db.loginLog.findFirst({ where: { user: { username: 'gate.user' } }, orderBy: { createdAt: 'desc' } });
  assert.notEqual(last.ip, '9.9.9.9');

  // Maintenance: legacy plain-text secrets are sealed; expired sessions and old idempotency keys go away.
  const { cleanupExpired, resealLegacySecrets } = await import('../apps/api/src/core/maintenance');
  const tenant = await db.tenant.findFirst();
  await db.tenant.update({ where: { id: tenant.id }, data: { aiKey: 'sk-ant-plain-legacy' } });
  await resealLegacySecrets();
  assert.match((await db.tenant.findUnique({ where: { id: tenant.id } })).aiKey, /^enc:v1:/);
  await db.tenant.update({ where: { id: tenant.id }, data: { aiKey: '' } });
  const user = await db.user.findFirst({ where: { username: 'gate.user' } });
  await db.session.create({
    data: { tokenHash: 'expired-' + randomUUID(), userId: user.id, csrf: 'x', expiresAt: new Date(Date.now() - 3 * 86400000) },
  });
  await db.idempotency.create({
    data: { key: 'old-' + randomUUID(), hash: 'h', result: {}, createdAt: new Date(Date.now() - 30 * 86400000) },
  });
  await cleanupExpired();
  assert.equal(await db.session.count({ where: { tokenHash: { startsWith: 'expired-' } } }), 0);
  assert.equal(await db.idempotency.count({ where: { key: { startsWith: 'old-' } } }), 0);
});

test('ADDRESSEES: the administrator keeps the list; a certificate and its covering letter go to the chosen department', async () => {
  const defaults = (await req(acc, 'admin/addressees')).body;
  assert.deepEqual(defaults, ['إدارة الشؤون المالية', 'إدارة الخدمات العامة', 'إدارة المشتريات والمناقصات']);
  assert.equal((await req(acc, 'admin/addressees', 'POST', { list: [...defaults, 'إدارة الشؤون الإدارية'] })).status, 403);
  const saved = await req(admin, 'admin/addressees', 'POST', { list: [...defaults, 'إدارة الشؤون الإدارية'] });
  assert.ok(saved.status < 300, JSON.stringify(saved.body));
  assert.equal((await req(acc, route('setup'))).body.addressees.length, 4);

  const row = await issue(await makeCase('3000.00'));
  const bad = await req(acc, route(`cases/${row.id}/finish`), 'POST', {
    completionDate: '2026-09-10',
    invoice: 'INV-A1',
    date: '2026-09-10',
    addressee: 'جهة غير موجودة',
  });
  assert.equal(bad.status, 400);
  const cert = await ok(acc, `cases/${row.id}/finish`, {
    completionDate: '2026-09-10',
    invoice: 'INV-A1',
    date: '2026-09-10',
    addressee: 'إدارة الشؤون الإدارية',
  });
  const html = (await req(acc, route(`certificates/${cert.id}`))).body.html;
  const cover = (await req(acc, route(`certificates/${cert.id}/cover`))).body.html;
  assert.ok(html.includes('السادة / إدارة الشؤون الإدارية') && cover.includes('السادة / إدارة الشؤون الإدارية'));
  // Older clients still send the position in the list.
  const row2 = await issue(await makeCase('3000.00'));
  const cert2 = await ok(acc, `cases/${row2.id}/finish`, {
    completionDate: '2026-09-10',
    invoice: 'INV-A2',
    date: '2026-09-10',
    addressee: 2,
  });
  assert.ok((await req(acc, route(`certificates/${cert2.id}`))).body.html.includes('السادة / إدارة الخدمات العامة'));
});

test('SUPPLIER BANK: one card per company with full contact data, shared by the schools, with the history of earlier certificates', async () => {
  const bank = (await req(acc, 'admin/supplier-bank')).body;
  assert.ok(bank.length >= 10, 'the suppliers of the approved sheets have cards');
  const known = bank.find((c: any) => c.history && c.history.count > 0);
  assert.ok(known, 'a supplier of the sheets has earlier certificates');
  assert.ok(Number(known.history.total) > 0);
  // A new card with every contact channel; the auditor-only account may not write.
  const created = await req(acc, 'admin/supplier-bank', 'POST', {
    name: 'شركة الاختبار للتجهيزات',
    legalName: 'شركة الاختبار للتجهيزات المدرسية ذ.م.م',
    cr: 'CR-TEST-9001',
    iban: 'QA58DOHB00001234567890ABCDEFG',
    bank: 'بنك الدوحة',
    phone: '44001122',
    mobile: '55001122',
    email: 'sales@example.test',
    contact: 'مسؤول المبيعات',
    address: 'الدوحة — المنطقة الصناعية',
    category: 'قرطاسية',
    note: 'توريد سريع',
    nameEn: 'Test Supplies Co.',
    crExpiry: '2026-01-15',
    accountsEmail: 'accounts@example.test',
    website: 'example.test',
    beneficiary: 'Test Supplies Co. WLL',
    ibanVerified: true,
  });
  assert.ok(created.status < 300, JSON.stringify(created.body));
  const card = (await req(acc, 'admin/supplier-bank?q=Test+Supplies')).body.find((c: any) => c.id === created.body.id);
  assert.equal(card.crStatus, 'expired', 'an expired commercial registration is flagged');
  assert.equal(card.ibanVerified, true);
  assert.equal(card.accountsEmail, 'accounts@example.test');
  assert.equal((await req(acc, 'admin/supplier-bank', 'POST', { name: 'x2', crExpiry: '15/01/2026' })).status, 400);
  assert.equal((await req(acc, 'admin/supplier-bank', 'POST', { name: 'شركة الاختبار للتجهيزات' })).status, 400, 'no duplicate names');
  assert.equal((await req(acc, 'admin/supplier-bank', 'POST', { name: 'x', email: 'not-an-email' })).status, 400);
  // The school picks it from the bank: a copy with the document fields.
  const copy = await ok(acc, 'supplier-from-bank', { cardId: created.body.id });
  assert.equal(copy.cardId, created.body.id);
  assert.equal(copy.iban, 'QA58DOHB00001234567890ABCDEFG');
  assert.equal(copy.phone, '44001122');
  const setup = (await req(acc, route('setup'))).body;
  const inSchool = setup.suppliers.find((s: any) => s.id === copy.id);
  assert.equal(inSchool.card.mobile, '55001122');
  assert.equal(inSchool.card.contact, 'مسؤول المبيعات');
  // Editing the card follows into the school copy; the search finds it by any field.
  const edited = await req(acc, 'admin/supplier-bank/' + created.body.id, 'PATCH', {
    name: 'شركة الاختبار للتجهيزات',
    cr: 'CR-TEST-9001',
    iban: 'QA58DOHB00001234567890ABCDEFG',
    email: 'new@example.test',
    mobile: '55009999',
    category: 'قرطاسية',
  });
  assert.ok(edited.status < 300, JSON.stringify(edited.body));
  const again = (await req(acc, route('setup'))).body.suppliers.find((s: any) => s.id === copy.id);
  assert.equal(again.email, 'new@example.test');
  assert.equal((await req(acc, 'admin/supplier-bank?q=55009999')).body.length, 1);
  const found = (await req(acc, 'admin/supplier-bank?q=' + encodeURIComponent('قرطاسية'))).body.find((c: any) => c.id === created.body.id);
  assert.equal(found.schools, 1, 'used by one school');
  // A supplier added in a school gets (or joins) its card in the bank.
  const direct = await ok(acc, 'suppliers', { name: 'مورد مضاف من المدرسة', cr: 'CR-TEST-9002', phone: '', email: '', iban: '' });
  assert.ok(direct.cardId);
  assert.ok((await req(acc, 'admin/supplier-bank?q=' + encodeURIComponent('مورد مضاف من المدرسة'))).body.length === 1);
  // A used card is deactivated, not removed; an unused one is removed.
  const del = await req(acc, 'admin/supplier-bank/' + created.body.id, 'DELETE');
  assert.equal(del.body.active, false);
  const spare = await req(acc, 'admin/supplier-bank', 'POST', { name: 'بطاقة بلا استخدام' });
  assert.equal((await req(acc, 'admin/supplier-bank/' + spare.body.id, 'DELETE')).body.deleted, true);
  assert.equal((await req(admin, 'admin/supplier-bank/standard', 'POST', {})).status, 200, 'missing standard cards are added on request');
});

test('LEGACY CERTIFICATES: the certificates issued before the system are a searchable reference register with totals and Excel', async () => {
  const all = (await req(acc, 'admin/legacy-certificates')).body;
  assert.equal(all.totals.count, 504);
  assert.ok(all.schools.length >= 5 && all.rows.length > 100);
  assert.ok(Number(all.totals.net) > 0 && Number(all.totals.orderValue) >= Number(all.totals.net));
  const one = (await req(acc, 'admin/legacy-certificates?school=' + encodeURIComponent(all.schools[0]))).body;
  assert.ok(one.totals.count > 0 && one.totals.count < 504);
  assert.ok(one.rows.every((r: any) => r.schoolName === all.schools[0]));
  const q = (await req(acc, 'admin/legacy-certificates?q=' + encodeURIComponent(all.rows[0].orderNo))).body;
  assert.ok(q.rows.some((r: any) => r.orderNo === all.rows[0].orderNo));
  const year = (await req(acc, 'admin/legacy-certificates?from=2025-01-01&to=2025-12-31')).body;
  assert.ok(year.rows.every((r: any) => String(r.date).startsWith('2025')));
  const xlsx = (await req(acc, 'admin/legacy-certificates?format=xlsx')).body;
  assert.ok(xlsx.base64.length > 1000 && xlsx.name.endsWith('.xlsx'));
  // The import batch is traceable: file fingerprint and row count in the audit log.
  const batch = await db.audit.findFirst({ where: { action: 'import:legacy-certificates' } });
  assert.ok(batch && batch.detail.rows === 504 && /^[0-9a-f]{64}$/.test(batch.detail.sha256));
  // Reference only: no ledger posting came from the register.
  assert.equal(await db.ledger.count({ where: { eventKey: { startsWith: 'legacy' } } }), 0);
});

test('TELEGRAM: the administrator sets the bot; an accountant links the phone with a code and issues an assignment letter from the chat', async () => {
  const { createServer } = await import('node:http');
  const sent: any[] = [];
  const docs: any[] = [];
  let queue: any[] = [];
  const token = '123456789:AAFakeTokenForTestsOnly_0123456789abc';
  const ms = createServer(async (q, r) => {
    const chunks: Buffer[] = [];
    for await (const ch of q) chunks.push(ch as Buffer);
    const raw = Buffer.concat(chunks);
    const method = q.url!.split('/').pop()!;
    const json = (v: any) => (r.setHeader('content-type', 'application/json'), r.end(JSON.stringify(v)));
    if (!q.url!.includes('/bot' + token + '/')) return json({ ok: false, description: 'Unauthorized' });
    if (method === 'getMe') return json({ ok: true, result: { username: 'moesas_test_bot' } });
    if (method === 'sendMessage') return (sent.push(JSON.parse(raw.toString())), json({ ok: true, result: {} }));
    if (method === 'sendDocument') return (docs.push({ size: raw.length, pdf: raw.includes('%PDF') }), json({ ok: true, result: {} }));
    if (method === 'getUpdates') {
      const out = queue;
      queue = [];
      return json({ ok: true, result: out });
    }
    json({ ok: false, description: 'unknown ' + method });
  });
  await new Promise<void>((res) => ms.listen(0, '127.0.0.1', res));
  process.env.TG_API_BASE = `http://127.0.0.1:${(ms.address() as any).port}`;
  try {
    assert.equal((await req(acc, 'auth/telegram-code', 'POST', {})).status, 400, 'nothing works before the administrator enables the bot');
    assert.equal((await req(acc, 'admin/telegram/config', 'POST', { token, on: true })).status, 403);
    assert.equal((await req(admin, 'admin/telegram/config', 'POST', { token: 'bad', on: true })).status, 400);
    const cfg = await req(admin, 'admin/telegram/config', 'POST', { token, on: true });
    assert.ok(cfg.status < 300, JSON.stringify(cfg.body));
    assert.equal(cfg.body.bot, 'moesas_test_bot');
    const tenant = await db.tenant.findFirst();
    assert.match(tenant.tgToken, /^enc:v1:/, 'the token is stored encrypted');
    const st = (await req(admin, 'admin/telegram')).body;
    assert.ok(st.on && st.hasToken && st.reachable && st.bot === 'moesas_test_bot');

    // The code links the chat; a wrong code does not.
    const { handleMessage } = await import('../apps/api/src/modules/telegram');
    const code = (await req(acc, 'auth/telegram-code', 'POST', {})).body;
    assert.match(code.code, /^\d{6}$/);
    assert.ok(code.link.includes('moesas_test_bot'));
    await handleMessage(tenant.id, token, '555', '/start 000000');
    assert.ok(sent.at(-1).text.includes('غير صحيح'));
    await handleMessage(tenant.id, token, '555', '/start ' + code.code);
    assert.ok(sent.at(-1).text.includes('تم ربط'));
    assert.equal((await req(acc, 'auth/me')).body.user.tgLinked, true);

    // The pending list names the files awaiting the letter; the conversation issues one.
    const row = await makeCase('4500.00');
    await handleMessage(tenant.id, token, '555', 'المعلقة');
    assert.ok(sent.at(-1).text.includes(row.number), sent.at(-1).text);
    await handleMessage(tenant.id, token, '555', 'تكليف ' + row.number);
    assert.ok(sent.at(-1).text.includes('مدة التوريد'));
    await handleMessage(tenant.id, token, '555', 'كثير');
    assert.ok(sent.at(-1).text.includes('1 إلى 365'));
    await handleMessage(tenant.id, token, '555', '١٠');
    assert.ok(sent.at(-1).text.includes('نعم'));
    await handleMessage(tenant.id, token, '555', 'نعم');
    assert.ok(sent.at(-1).text.includes('صدر كتاب التكليف'), sent.at(-1).text);
    const after = await load(row.id);
    assert.equal(after.state, 'ORDERED');
    assert.equal(after.deliveryDays, 10);
    assert.equal(
      after.issuedBy,
      (await db.user.findFirst({ where: { username: 'accountant' } })).id,
      'recorded in the name of the linked account',
    );
    assert.ok(docs.length === 1 && docs[0].pdf, 'the letter arrives as a PDF');
    await handleMessage(tenant.id, token, '555', 'طباعة ' + row.number);
    assert.equal(docs.length, 2);
    await handleMessage(tenant.id, token, '555', 'تكليف ' + row.number);
    assert.ok(sent.at(-1).text.includes('لا تسمح'));
    // The administrator's controls: a value limit, or no issuing from the phone at all.
    const row2 = await makeCase('4500.00');
    await req(admin, 'admin/telegram/config', 'POST', { token: '', on: true, issue: true, limit: 1000 });
    await handleMessage(tenant.id, token, '555', 'تكليف ' + row2.number);
    assert.ok(sent.at(-1).text.includes('أعلى من حد'), sent.at(-1).text);
    await req(admin, 'admin/telegram/config', 'POST', { token: '', on: true, issue: false, limit: 0 });
    await handleMessage(tenant.id, token, '555', 'تكليف ' + row2.number);
    assert.ok(sent.at(-1).text.includes('موقوف'), sent.at(-1).text);
    assert.equal((await load(row2.id)).state, 'APPROVED');
    await req(admin, 'admin/telegram/config', 'POST', { token: '', on: true, issue: true, limit: 0 });
    assert.equal((await req(admin, 'admin/telegram')).body.issue, true);
    // Another person's file is invisible; an unlinked chat gets the linking hint; the whole path works through polling.
    const foreign = await db.case.findFirst({ where: { schoolId: { not: school } } });
    if (foreign) {
      await handleMessage(tenant.id, token, '555', 'تكليف ' + foreign.number);
      assert.ok(sent.at(-1).text.includes('لم أجد'));
    }
    await handleMessage(tenant.id, token, '777', 'المعلقة');
    assert.ok(sent.at(-1).text.includes('ربط تليجرام'));
    const before = sent.length;
    queue.push({ update_id: 1, message: { chat: { id: 555, type: 'private' }, text: 'مساعدة' } });
    await req(admin, 'admin/telegram/config', 'POST', { token: '', on: true }); // wakes the polling loop
    for (let i = 0; i < 100 && sent.length === before; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(sent.length > before && sent.at(-1).text.includes('الأوامر المتاحة'), 'polling delivered the message');
    // Unlink and switch off; a password change also unlinks the phone.
    await req(acc, 'auth/telegram-unlink', 'POST', {});
    assert.equal((await req(acc, 'auth/me')).body.user.tgLinked, false);
    await db.user.update({ where: { username: 'accountant' }, data: { tgChatId: '555' } });
    const pw = await req(acc, 'auth/password', 'POST', { current: password, password: password });
    assert.ok(pw.status < 300, JSON.stringify(pw.body));
    assert.equal((await db.user.findFirst({ where: { username: 'accountant' } })).tgChatId, '');
    acc = await log('accountant');
    await req(admin, 'admin/telegram/config', 'POST', { token: '', on: false });
  } finally {
    delete process.env.TG_API_BASE;
    ms.close();
  }
});

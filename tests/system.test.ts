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
  assert.match(c.orderNumber, /^SHFI\/2026-0901/);
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
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'CLOSE' });
  assert.ok((await req(acc, route(`imprests/${a.id}/${st.id}`))).body.cover.includes('تسوية وإغلاق'));
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
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'CLOSE' });
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
  assert.ok((await req(admin, `admin/users/${target.id}/status`, 'POST', { active: false })).status < 300);
  assert.equal((await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-1' })).status, 401);
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
  const r = await req(null, 'auth/login', 'POST', { username: 'other', password: 'Brand-New-Password-1' });
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
  const st = await ok(acc, `imprests/${a.id}/settle`, { type: 'CLOSE', invoices });
  assert.equal(Number(st.amount), 470.5);
  const after = (await req(acc, route('imprests?year=' + year))).body.find((x: any) => x.id === a.id);
  assert.equal(after.expenses.length, 2);
  assert.ok(after.expenses.every((e: any) => e.settlementId === st.id));
});
test('FINANCIAL REPORT: analyst report with charts, groups, insights and Excel; home shows incomplete files', async () => {
  const r = (await req(acc, route(`financial-report?year=${year}&from=2026-01-01&to=2026-12-31`))).body;
  for (const part of ['التقرير المالي الشامل', 'الملخص التنفيذي', 'شكل (1)', 'شكل (4)', 'التوصيات', '<svg', 'الموردون'])
    assert.ok(r.html.includes(part), part);
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

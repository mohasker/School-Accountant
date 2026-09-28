/**
 * Visual walkthrough against a running demo (npm run demo): creates a full purchase cycle and a
 * petty-cash settlement through the API, then captures every screen and printed document.
 *   DEMO_PASSWORD=... node --import tsx scripts/ui-walkthrough.ts
 */
import { chromium, type Page } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = process.env.OUT_DIR || 'docs/screenshots';
const PASSWORD = process.env.DEMO_PASSWORD!;
mkdirSync(OUT, { recursive: true });

async function login(page: Page, username: string) {
  await page.goto(BASE);
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('form button');
  await page.waitForSelector('aside nav');
}

/** API call from inside the page (same origin, session cookie + CSRF token). */
async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ([path, method, body]) => {
      const me = await (await fetch('/api/auth/me')).json();
      const r = await fetch('/api/' + path, {
        method: method as string,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf, 'Idempotency-Key': crypto.randomUUID() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(path + ': ' + JSON.stringify(data));
      return data;
    },
    [path, method, body] as const,
  );
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function printed(page: Page, html: string, name: string) {
  const doc = await page.context().newPage();
  await doc.setViewportSize({ width: 900, height: 1200 });
  // Serve the stored document on a same-origin URL so the letterhead logo resolves.
  await doc.route(BASE + '/__print', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await doc.goto(BASE + '/__print', { waitUntil: 'load' });
  await doc.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await doc.close();
}

async function nav(page: Page, label: string) {
  await page.click(`aside nav button:has-text("${label}")`);
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-QA' });
  const acc = await ctx.newPage();
  await acc.goto(BASE);
  await shot(acc, '01-login');
  await login(acc, 'accountant');
  const me = await api(acc, 'auth/me');
  const school = me.schools[0].id;
  const root = (p: string) => `schools/${school}/${p}`;
  const setup = await api(acc, root('setup'));
  const year = setup.years[0].id;
  const budget = setup.budgets[0].id;

  // Purchase above 1000 QAR with three quotes.
  const c = await api(acc, root('cases'), 'POST', {
    yearId: year,
    subject: 'توريد أقلام سبورة تفاعلية',
    origin: 'SCHOOL',
    items: [{ name: 'قلم سبورة تفاعلية', unit: 'عدد', qty: '25', budgetId: budget }],
  });
  let full = await api(acc, root('cases/' + c.id));
  for (const [i, price] of ['100', '112', '118'].entries())
    await api(acc, root(`cases/${c.id}/quotes`), 'POST', {
      supplierId: setup.suppliers[i].id,
      reference: `Q-2026-${31174 + i}`,
      quoteDate: '2026-09-01',
      prices: [{ itemId: full.items[0].id, price }],
      compliant: true,
      note: i === 0 ? 'مطابق للمواصفات والشروط' : '',
    });
  full = await api(acc, root('cases/' + c.id));
  await api(acc, root(`cases/${c.id}/evaluate`), 'POST', {
    quoteId: full.quotes.find((q: any) => q.total === '2500').id,
    reason: 'الأقل سعراً والمطابق',
  });

  const appr = await ctx
    .browser()!
    .newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-QA' })
    .then((x) => x.newPage());
  await login(appr, 'approver');
  await api(appr, root(`cases/${c.id}/approve`), 'POST', {});
  await api(acc, root(`cases/${c.id}/issue`), 'POST', { trigger: '2026-09-01', days: 5, policyConfirmed: true });
  full = await api(acc, root('cases/' + c.id));
  await api(acc, root(`cases/${c.id}/deliver`), 'POST', {
    date: '2026-09-10',
    note: 'DN-100',
    invoice: '17813',
    lines: [{ itemId: full.items[0].id, received: '25', accepted: '25' }],
  });
  for (const code of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const e = await api(acc, root(`cases/${c.id}/evidence`), 'POST', {
      code,
      name: `doc-${code}.pdf`,
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.4\nDEMO\n%%EOF').toString('base64'),
    });
    await api(appr, root(`cases/${c.id}/verify`), 'POST', { evidenceId: e.id, decision: 'VERIFIED', reason: 'مطابق' });
  }
  for (const code of [11, 12, 15])
    await api(appr, root(`cases/${c.id}/not-applicable`), 'POST', { code, reason: 'لا ينطبق على هذه المعاملة' });
  const cert = await api(appr, root(`cases/${c.id}/certificate`), 'POST', {
    kind: 'FINAL',
    date: '2026-09-14',
    addressee: 1,
    notes: '',
    ratings: { scope: 'EXCELLENT', time: 'AVERAGE', supervision: 'EXCELLENT' },
  });
  await api(acc, root(`cases/${c.id}/cover`), 'POST', { certificateId: cert.id, date: '2026-09-14' });

  // Petty cash imprest reaching the 75% replenishment threshold.
  const imp = await api(appr, root('imprests'), 'POST', {
    yearId: year,
    type: 'PETTY',
    name: 'العهدة النثرية 2026',
    custodian: 'مسؤول العهدة التجريبي',
    amount: '4000',
    reference: 'CHQ-1',
  });
  const lines = [
    ['مطعم تجريبي', '1220', 'ضيافة - مجلس الأمناء', '160', ''],
    ['محلات تجريبية', '57704', 'مستلزمات الضيافة والبوفيه', '995', ''],
    ['مطبعة تجريبية', '25/0402', 'طباعة رول أب وبنر', '420', 'ليس لديهم فاتورة إلكترونية'],
    ['هايبر ماركت تجريبي', '10004000333351', 'أعلام اليوم الوطني', '790', ''],
    ['مخبز تجريبي', '', 'ضيافة - مجلس أولياء الأمور', '650', 'ليس لديهم فاتورة إلكترونية'],
  ];
  const pettyBudget = setup.budgets.find((b: any) => b.code === '520801')?.id ?? budget;
  for (const [vendor, invoice, description, amount, note] of lines)
    await api(acc, root(`imprests/${imp.id}/expense`), 'POST', {
      budgetId: pettyBudget,
      vendor,
      invoice,
      date: '2026-09-15',
      description,
      amount,
      note,
    });

  // Screens
  await acc.reload();
  await acc.waitForSelector('aside nav');
  await shot(acc, '02-dashboard');
  await nav(acc, 'المعاملات');
  await shot(acc, '03-cases');
  await acc.click('text=فتح ←');
  await acc.waitForSelector('.stepper');
  await shot(acc, '04-case-detail');
  await nav(acc, 'شهادات الإنجاز');
  await shot(acc, '05-registry');
  await nav(acc, 'الموازنة');
  await shot(acc, '06-budget');
  await nav(acc, 'الإجازات');
  await shot(acc, '07-holidays');
  await nav(acc, 'السياسة المالية');
  await shot(acc, '08-policy');
  await appr.reload();
  await appr.waitForSelector('aside nav');
  await nav(appr, 'العهد');
  await shot(appr, '09-imprests');
  await appr.click('text=تسوية / استعاضة / إغلاق');
  await appr.waitForSelector('.modal');
  await shot(appr, '10-imprest-settlement-dialog');
  await appr.click('.modal-actions button:has-text("إصدار الكشف")');
  await appr.waitForTimeout(1200);
  const imprest = await api(appr, root(`imprests/${imp.id}`));
  const st = imprest.settlements[0];
  const stDocs = await api(appr, root(`imprests/${imp.id}/${st.id}`));

  // Printed documents
  await printed(acc, (await api(acc, root(`cases/${c.id}/report-print`))).html, '20-print-quote-study');
  await printed(acc, (await api(acc, root(`cases/${c.id}/order-print`))).html, '21-print-order-letter');
  await printed(acc, (await api(acc, root(`certificates/${cert.id}`))).html, '22-print-certificate');
  await printed(acc, (await api(acc, root(`certificates/${cert.id}/cover`))).html, '23-print-certificate-cover');
  await printed(acc, stDocs.html, '24-print-petty-statement');
  await printed(acc, stDocs.cover, '25-print-petty-cover');
  await printed(acc, (await api(acc, root(`budget-estimate?year=${year}`))).html, '26-print-budget-estimate');
  // Server-rendered PDF files of the official documents.
  const pdfDir = OUT + '/pdf';
  mkdirSync(pdfDir, { recursive: true });
  const savePdf = async (path: string, name: string) => {
    const r = await api(acc, path + (path.includes('?') ? '&' : '?') + 'pdf=1');
    writeFileSync(`${pdfDir}/${name}.pdf`, Buffer.from(r.base64, 'base64'));
  };
  await savePdf(root(`cases/${c.id}/report-print`), '1-quote-study');
  await savePdf(root(`cases/${c.id}/order-print`), '2-order-letter');
  await savePdf(root(`certificates/${cert.id}`), '3-certificate');
  await savePdf(root(`certificates/${cert.id}/cover`), '4-certificate-cover');
  await savePdf(root(`imprests/${imp.id}/${st.id}`), '5-petty-statement');
  await savePdf(root(`imprests/${imp.id}/${st.id}?part=cover`), '6-petty-cover');
  await savePdf(root(`budget-estimate?year=${year}`), '7-budget-estimate');

  // System administrator console and account report.
  const adminPage = await ctx
    .browser()!
    .newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-QA' })
    .then((x) => x.newPage());
  await login(adminPage, 'admin');
  await adminPage.waitForSelector('text=كل الحسابات');
  await shot(adminPage, '11-admin-console');
  await adminPage.click('tr:has-text("accountant") >> text=تقرير الأعمال');
  await adminPage.waitForSelector('text=المعاملات التي أعدها');
  await shot(adminPage, '12-admin-account-report');
  const accounts = (await api(adminPage, 'admin/overview')).accounts;
  const accountant = accounts.find((a: any) => a.username === 'accountant');
  writeFileSync(
    `${pdfDir}/8-account-report.pdf`,
    Buffer.from((await api(adminPage, `admin/users/${accountant.id}/report?format=print&pdf=1`)).base64, 'base64'),
  );
  await browser.close();
  console.log('Screenshots written to', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

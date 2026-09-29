/**
 * Visual walkthrough against a freshly started demo (npm run demo, which loads the trial files):
 * captures every screen, the main dialogs and every printed document (PNG and server PDF).
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

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
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
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-QA' });
  const acc = await ctx.newPage();
  await acc.goto(BASE);
  await shot(acc, '01-login');
  await login(acc, 'accountant');
  const me = await api(acc, 'auth/me');
  const school = me.schools.find((x: any) => x.name.startsWith('محمد بن عبد الوهاب')) ?? me.schools[0];
  await acc.click('.context .select-field >> nth=0');
  await acc.waitForTimeout(300);
  await shot(acc, '02b-dropdown');
  await acc.click(`.select-pop button:has-text("${school.name}")`);
  await acc.waitForTimeout(1500);
  const root = (p: string) => `schools/${school.id}/${p}`;
  const setup = await api(acc, root('setup'));
  const year = setup.years[0].id;
  const cases = await api(acc, root('cases?year=' + year));
  const byNumber = (n: string) => cases.find((c: any) => c.number === n);
  const done = byNumber('TR-00001'),
    late = byNumber('TR-00002');
  const imprests = await api(acc, root('imprests?year=' + year));
  const petty = imprests.find((a: any) => a.type === 'PETTY');
  const st = petty.settlements[0];

  await shot(acc, '02-dashboard');
  await acc.click('.quick-link:has-text("معاملة جديدة")');
  await acc.waitForSelector('.modal');
  await acc.fill('.modal input[name=subject]', 'توريد أحبار طابعات');
  await acc.fill('input[name=q_name_0]', 'مكتبة الجامعة');
  await acc.type('input[name=q_total_0]', '٨٥٠');
  await shot(acc, '03b-new-case-quote-report-dialog');
  await acc.click('.modal-actions button.secondary');
  await nav(acc, 'المعاملات');
  await shot(acc, '03-cases');
  const open = async (n: string) => {
    await nav(acc, 'المعاملات');
    await acc.locator('tr', { hasText: n }).locator('button:has-text("فتح")').click();
    await acc.waitForSelector('.stepper');
    await acc.waitForTimeout(600);
  };
  await open('TR-00001');
  await shot(acc, '04-case-detail');
  await open('TR-00005');
  await shot(acc, '04b-case-quotes');
  await acc.click('button:has-text("إضافة عروض")');
  await acc.waitForSelector('.modal');
  await shot(acc, '04c-quotes-entry-dialog');
  await acc.click('.modal-actions button.secondary');
  await acc.click('.next-step button.primary-lg');
  await acc.waitForSelector('.modal');
  await shot(acc, '04e-quote-report-dialog');
  await acc.click('.modal-actions button.secondary');
  await open('TR-00003');
  await acc.click('.next-step button.primary-lg');
  await acc.waitForSelector('.modal');
  await shot(acc, '04d-certificate-dialog');
  await acc.click('.modal-actions button.secondary');
  await nav(acc, 'شهادات الإنجاز');
  await shot(acc, '05-registry');
  await nav(acc, 'تقارير عروض الأسعار');
  await shot(acc, '05b-quote-register');
  await nav(acc, 'التكليفات');
  await shot(acc, '05c-order-register');
  await nav(acc, 'الموازنة');
  await shot(acc, '06-budget');
  await nav(acc, 'الإجازات');
  await shot(acc, '07-holidays');
  await nav(acc, 'العهد');
  await shot(acc, '09-imprests');
  await acc.click('button:has-text("عهدة جديدة")');
  await acc.waitForSelector('.modal');
  await shot(acc, '10-imprest-new-dialog');
  await acc.click('.modal-actions button.secondary');
  await acc.click('button:has-text("إدخال الفواتير") >> nth=0');
  await acc.waitForSelector('.invoice-rows');
  await acc.fill('input[name=i_vendor_0]', 'محلات الجنوب التجارية');
  await acc.fill('input[name=i_invoice_0]', '58770');
  await acc.fill('input[name=i_desc_0]', 'ضيافة - بوفيه المدرسة');
  await acc.type('input[name=i_amount_0]', '٤٥٠٫٧٥');
  await shot(acc, '09b-settlement-invoices-dialog');
  await acc.click('.modal-actions button.secondary');
  await nav(acc, 'التقارير');
  await shot(acc, '15-reports');
  await nav(acc, 'الموازنة');
  await acc.click('button:has-text("مصروف مباشر")');
  await acc.waitForSelector('.modal');
  await acc.click('.modal .date-btn');
  await acc.waitForSelector('.date-pop');
  await shot(acc, '16-direct-expense-datepicker', false);
  await acc.click('.modal-actions button.secondary');
  await nav(acc, 'أرشيف المستندات');
  await shot(acc, '17-archive');
  await nav(acc, 'الملاحظات العامة');
  await shot(acc, '18-notes');
  await nav(acc, 'المساعد الذكي');
  await shot(acc, '19-assistant');
  await nav(acc, 'الإعدادات');
  await shot(acc, '13-settings');
  await acc.click('.theme >> nth=2');
  await nav(acc, 'المعاملات');
  await shot(acc, '14-theme-emerald');
  await nav(acc, 'الإعدادات');
  await acc.click('.theme >> nth=0');

  // Printed documents
  await printed(acc, (await api(acc, root(`cases/${done.id}/report-print`))).html, '20-print-quote-study');
  await printed(acc, (await api(acc, root(`cases/${done.id}/order-print`))).html, '21-print-order-letter');
  await printed(acc, (await api(acc, root(`certificates/${late.certificates[0].id}`))).html, '22-print-certificate');
  await printed(acc, (await api(acc, root(`certificates/${late.certificates[0].id}/cover`))).html, '23-print-certificate-cover');
  const stDocs = await api(acc, root(`imprests/${petty.id}/${st.id}`));
  await printed(acc, stDocs.html, '24-print-petty-statement');
  await printed(acc, stDocs.cover, '25-print-petty-cover');
  await printed(acc, (await api(acc, root(`budget-estimate?year=${year}`))).html, '26-print-budget-estimate');
  await printed(acc, (await api(acc, root(`financial-report?year=${year}`))).html, '27-print-financial-report');
  const pdfDir = OUT + '/pdf';
  mkdirSync(pdfDir, { recursive: true });
  const savePdf = async (path: string, name: string) => {
    const r = await api(acc, path + (path.includes('?') ? '&' : '?') + 'pdf=1');
    writeFileSync(`${pdfDir}/${name}.pdf`, Buffer.from(r.base64, 'base64'));
  };
  await savePdf(root(`cases/${done.id}/report-print`), '1-quote-study');
  await savePdf(root(`cases/${done.id}/order-print`), '2-order-letter');
  await savePdf(root(`certificates/${late.certificates[0].id}`), '3-certificate');
  await savePdf(root(`certificates/${late.certificates[0].id}/cover`), '4-certificate-cover');
  await savePdf(root(`imprests/${petty.id}/${st.id}`), '5-petty-statement');
  await savePdf(root(`imprests/${petty.id}/${st.id}?part=cover`), '6-petty-cover');
  await savePdf(root(`budget-estimate?year=${year}`), '7-budget-estimate');
  await savePdf(root(`financial-report?year=${year}`), '9-financial-report');

  // System administrator: console, account report, financial policy.
  const adminPage = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-QA' }).then((x) => x.newPage());
  await login(adminPage, 'admin');
  await adminPage.waitForSelector('text=كل الحسابات');
  await shot(adminPage, '11-admin-console');
  await adminPage.click('tr:has-text("accountant") >> text=تقرير الأعمال');
  await adminPage.waitForSelector('text=المعاملات التي أعدها');
  await shot(adminPage, '12-admin-account-report');
  await nav(adminPage, 'السياسة المالية');
  await shot(adminPage, '08-policy');
  const accounts = (await api(adminPage, 'admin/overview')).accounts;
  const accountant = accounts.find((a: any) => a.username === 'accountant');
  writeFileSync(
    `${pdfDir}/8-account-report.pdf`,
    Buffer.from((await api(adminPage, `admin/users/${accountant.id}/report?format=print&pdf=1`)).base64, 'base64'),
  );
  await browser.close();
  console.log('Screenshots written to', OUT);
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const { readdirSync } = require('node:fs') as typeof import('node:fs');
  const dir = readdirSync('/opt/pw-browsers').find((d) => d.startsWith('chromium-'));
  return `/opt/pw-browsers/${dir}/chrome-linux/chrome`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

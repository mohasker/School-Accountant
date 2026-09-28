import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { Browser } from 'playwright-core';
import { fail } from '../common/validation';

/**
 * Server-side PDF export of stored documents with headless Chromium. The document is loaded from a
 * private origin; only the letterhead logo and the bundled fonts are served (from the web app's
 * public folder), every other request is blocked.
 */
const ORIGIN = 'http://print.local';
const PUBLIC_DIR = resolve(process.env.PRINT_ASSETS_DIR || 'apps/web/public');
const TYPES: Record<string, string> = { '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };

function chromiumPath() {
  const candidates = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  // Local trial on Windows: the Edge or Chrome already installed on the computer.
  if (process.platform === 'win32')
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA])
      if (base)
        candidates.push(
          join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        );
  const pw = '/opt/pw-browsers';
  if (existsSync(pw))
    for (const d of readdirSync(pw)
      .filter((n) => n.startsWith('chromium-'))
      .sort()
      .reverse())
      candidates.push(join(pw, d, 'chrome-linux', 'chrome'));
  return candidates.find((p) => p && existsSync(p));
}

let browser: Promise<Browser> | null = null;
async function getBrowser() {
  if (!browser) {
    const executablePath = chromiumPath();
    if (!executablePath) fail('تصدير PDF غير متاح: لم يُعثر على Chromium على الخادم (CHROMIUM_PATH)');
    const { chromium } = await import('playwright-core');
    browser = chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => {
      browser = null;
      throw e;
    });
  }
  return browser;
}

export async function closePdf() {
  const b = browser;
  browser = null;
  if (b) await (await b).close().catch(() => {});
}

const footer = (title: string) =>
  `<div style="width:100%;font-size:8px;color:#666;padding:0 15mm;display:flex;justify-content:space-between;direction:rtl;font-family:Arial">` +
  `<span>${title.replace(/[<>&]/g, '')}</span><span style="direction:ltr"><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

export async function htmlToPdf(html: string) {
  const b = await getBrowser();
  const context = await b.newContext();
  try {
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      if (url.pathname === '/document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      const file = normalize(join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
      if (!file.startsWith(PUBLIC_DIR) || !/^\/(brand|fonts)\//.test(url.pathname) || !existsSync(file)) return route.abort();
      return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    await page.goto(ORIGIN + '/document', { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => (document as any).fonts?.ready);
    const title = (await page.title()) || 'document';
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer(title),
      margin: { top: '12mm', bottom: '15mm', left: '14mm', right: '14mm' },
    });
    return { base64: Buffer.from(pdf).toString('base64'), name: title.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf', mime: 'application/pdf' };
  } finally {
    await context.close();
  }
}

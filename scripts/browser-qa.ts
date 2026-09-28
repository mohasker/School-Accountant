import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import assert from 'node:assert/strict';

async function main(){
 const child=spawn(process.execPath,['--import','tsx','scripts/demo.ts'],{env:{...process.env,DEMO_PASSWORD:'Synthetic-UI-Only-2026!',PGLITE_DATA:'.data/browser-'+Date.now()},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',d=>process.stdout.write(d));child.stderr.on('data',d=>process.stderr.write(d));
 let browser:any;
 try{
  let ready=false;for(let i=0;i<150;i++){try{const r=await fetch('http://localhost:3000');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'Web server became ready');
  browser=await playwright.launch({args:chromium.args,executablePath:await chromium.executablePath(),headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:3000');await page.locator('[name=username]').fill('accountant');await page.locator('[name=password]').fill('Synthetic-UI-Only-2026!');await page.getByRole('button',{name:'الدخول إلى مساحة العمل'}).click();
  await page.getByRole('heading',{name:'نظرة عامة',exact:true}).waitFor();await page.getByRole('button',{name:'＋ معاملة جديدة'}).click();
  await page.getByLabel('موضوع المعاملة').fill('توريد مستلزمات تعليمية — اختبار الواجهة');await page.getByRole('textbox',{name:'وصف البند'}).fill('حقيبة أدوات تعليمية');await page.getByRole('spinbutton',{name:'الكمية',exact:true}).fill('20');await page.getByRole('button',{name:'حفظ ومتابعة'}).click();
  await page.getByRole('heading',{name:'توريد مستلزمات تعليمية — اختبار الواجهة',exact:true}).waitFor();
  await page.getByRole('button',{name:'إضافة عرض سعر',exact:true}).click();await page.getByLabel('رقم عرض السعر').fill('UI-Q-1');await page.getByPlaceholder('سعر الوحدة').fill('100');await page.getByRole('button',{name:'حفظ ومتابعة'}).click();await page.getByRole('heading',{name:'مقارنة عروض الأسعار',exact:true}).waitFor();
  mkdirSync('docs/qa',{recursive:true});await page.screenshot({path:'docs/qa/case-desktop.png',fullPage:true});
  await page.locator('nav').getByRole('button',{name:'نظرة عامة'}).click();await page.getByRole('heading',{name:'نظرة عامة',exact:true}).waitFor();await page.screenshot({path:'docs/qa/dashboard-desktop.png',fullPage:true});
  await page.locator('nav').getByRole('button',{name:'التقارير',exact:true}).click();await page.getByRole('button',{name:'استخراج التقرير'}).click();await page.getByRole('button',{name:'تنزيل Excel'}).waitFor();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'تنزيل Excel'}).click();const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.xlsx'));
  await page.setViewportSize({width:390,height:844});await page.locator('nav').getByRole('button',{name:'نظرة عامة'}).click();await page.screenshot({path:'docs/qa/dashboard-mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);assert.equal(overflow,false,'No page-level horizontal overflow on mobile');assert.deepEqual(errors,[],'No client runtime errors');
  console.log('BROWSER_QA_PASS: login, create case, quote, dashboard, report, Excel download, desktop/mobile, no runtime errors');
 }finally{await browser?.close();child.kill('SIGTERM');}
}
main().catch(e=>{console.error(e);process.exitCode=1});

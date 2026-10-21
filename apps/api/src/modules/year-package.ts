import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { db } from '../common/db';
import { isoDay } from '../common/dates';
import { fail, id, parse } from '../common/validation';
import { scope, type Identity } from '../core/identity';
import { htmlToPdf } from '../core/pdf';
import { caseBundle } from './cases/bundle';

/**
 * «حزمة نهاية السنة»: one ZIP per school and fiscal year with every purchase file (the bundled PDF:
 * index + documents in the auditors' order), every imprest statement and covering letter, and Excel
 * registers of the cases, imprest invoices and budget lines. Built in the background (it renders many
 * documents); the job is kept in memory for an hour on the single API instance.
 */

type Job = {
  id: string;
  userId: string;
  school: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  done: number;
  total: number;
  error: string;
  zip?: Buffer;
  name: string;
  at: number;
};
const jobs = new Map<string, Job>();
const HOUR = 3600_000;

function sweep() {
  for (const [k, j] of jobs) if (Date.now() - j.at > HOUR) jobs.delete(k);
}

export async function startYearPackage(s: Identity, school: string, yearId: string) {
  scope(s, school);
  sweep();
  if ([...jobs.values()].some((j) => j.userId === s.user.id && j.status === 'RUNNING')) fail('حزمة أخرى قيد الإعداد؛ انتظر انتهاءها');
  const year = await db.fiscalYear.findFirst({ where: { id: parse(id, yearId), schoolId: school }, include: { school: true } });
  if (!year) throw new NotFoundException('العام المالي غير موجود');
  const cases = await db.case.findMany({
    where: { schoolId: school, yearId: year.id, state: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'asc' },
  });
  const imprests = await db.imprest.findMany({
    where: { schoolId: school, yearId: year.id },
    include: { settlements: true, expenses: { include: { budget: true } } },
  });
  const job: Job = {
    id: randomUUID(),
    userId: s.user.id,
    school,
    status: 'RUNNING',
    done: 0,
    total: cases.length + imprests.reduce((n, a) => n + a.settlements.length, 0) + 1,
    error: '',
    name: `${year.school.code}-${year.label}.zip`,
    at: Date.now(),
  };
  jobs.set(job.id, job);
  void build(job, school, year, cases, imprests).catch((e) => {
    job.status = 'FAILED';
    job.error = String(e?.response?.message ?? e?.message ?? e).slice(0, 300);
  });
  return { job: job.id, total: job.total };
}

async function build(job: Job, school: string, year: any, cases: any[], imprests: any[]) {
  const zip = new JSZip();
  const safe = (v: string) => v.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  for (const c of cases) {
    if (c.orderHtml || c.evaluationHtml) {
      const b = await caseBundle(school, c.id);
      zip.file(`المعاملات/${safe(c.number)} - ${safe(c.subject)}.pdf`, Buffer.from(b.base64, 'base64'));
    }
    job.done++;
  }
  for (const a of imprests)
    for (const st of a.settlements) {
      const folder = `العهد/${safe(a.name || a.type)}`;
      zip.file(`${folder}/كشف ${st.number}.pdf`, Buffer.from((await htmlToPdf(st.html)).base64, 'base64'));
      if (st.coverHtml)
        zip.file(`${folder}/كتاب تغطية الكشف ${st.number}.pdf`, Buffer.from((await htmlToPdf(st.coverHtml)).base64, 'base64'));
      job.done++;
    }
  // Registers.
  const wb = new ExcelJS.Workbook();
  const sheet = (name: string, heads: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
    ws.addRow(heads).font = { bold: true };
    for (const r of rows) ws.addRow(r);
    ws.columns.forEach((c) => (c.width = 20));
  };
  const full = await db.case.findMany({
    where: { schoolId: school, yearId: year.id },
    include: { supplier: true, certificates: true, erp: true, returns: true },
    orderBy: { createdAt: 'asc' },
  });
  sheet(
    'المعاملات',
    [
      'رقم المعاملة',
      'الموضوع',
      'المورد',
      'رقم التكليف',
      'تاريخ التكليف',
      'القيمة',
      'الحالة',
      'المستحق',
      'الغرامة',
      'الصافي',
      'قيد ERP',
      'مرات الإرجاع',
    ],
    full.map((c) => [
      c.number,
      c.subject,
      c.supplier?.name ?? '',
      c.orderNumber ?? '',
      c.issueDate ? isoDay(c.issueDate) : '',
      Number(c.total),
      c.state,
      c.certificates.reduce((v, x) => v + Number(x.gross), 0),
      c.certificates.reduce((v, x) => v + Number(x.fine), 0),
      c.certificates.reduce((v, x) => v + Number(x.net), 0),
      c.erp?.reference ?? '',
      c.returns.length,
    ]),
  );
  sheet(
    'فواتير العهد',
    ['العهدة', 'المورد', 'رقم الفاتورة', 'التاريخ', 'البيان', 'البند', 'المبلغ', 'رقم الكشف'],
    imprests.flatMap((a) =>
      a.expenses.map((e: any) => [
        a.name || a.type,
        e.vendor,
        e.invoice,
        isoDay(e.date),
        e.description,
        e.budget.code,
        Number(e.amount),
        a.settlements.find((st: any) => st.id === e.settlementId)?.number ?? '',
      ]),
    ),
  );
  const budgets = await db.budget.findMany({ where: { schoolId: school, yearId: year.id }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
  sheet(
    'الموازنة',
    ['الرمز', 'البند', 'المعتمد', 'المصروف', 'الارتباطات', 'المتاح'],
    budgets.map((b) => [
      b.code,
      b.name,
      Number(b.approved),
      Number(b.spent),
      Number(b.committed),
      Number(b.approved.minus(b.spent).minus(b.committed)),
    ]),
  );
  zip.file('السجلات.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
  zip.file(
    'اقرأني.txt',
    `حزمة نهاية السنة — ${year.school.name} — العام المالي ${year.label}\nأُعدّت ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC\nكل ملف معاملة PDF يبدأ بصفحة فهرس داخلية، والمستندات الرسمية مدرجة كما صدرت.\n`,
  );
  job.zip = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  job.done = job.total;
  job.status = 'DONE';
}

/** Progress, and the file once it is ready (only to the user who asked for it). */
export function yearPackageStatus(s: Identity, jobId: string) {
  sweep();
  const job = jobs.get(jobId);
  if (!job || job.userId !== s.user.id) throw new NotFoundException('الحزمة غير موجودة أو انتهت صلاحيتها؛ أعد إعدادها');
  if (job.status !== 'DONE') return { status: job.status, done: job.done, total: job.total, error: job.error };
  return {
    status: job.status,
    done: job.done,
    total: job.total,
    base64: job.zip!.toString('base64'),
    name: job.name,
    mime: 'application/zip',
  };
}

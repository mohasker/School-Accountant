import { NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { db } from '../common/db';
import { hash } from '../common/crypto';
import { D, amount, num } from '../common/money';
import { date, fail, id, parse, plain } from '../common/validation';
import { STATE_NAMES } from '../core/documents';
import { schoolIds, scope, type Identity } from '../core/identity';
import { fmtDate, tableReport } from '../print/reports';
import type { ReadCtx } from './context';

async function workbook(sheetName: string, heads: string[], rows: (string | number | null)[][], preface: (string | number)[][] = []) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName, { views: [{ rightToLeft: true }] });
  for (const r of preface) sheet.addRow(r);
  const head = sheet.addRow(heads);
  head.font = { bold: true };
  for (const r of rows) sheet.addRow(r);
  sheet.columns.forEach((c) => (c.width = 22));
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Transactions report for a period; every run is stored so it can be reprinted unchanged. */
export async function readTransactionsReport({ s, school, query }: ReadCtx) {
  const yearId = parse(id, query.year);
  const owned = await db.fiscalYear.findUnique({ where: { id: yearId, schoolId: school } });
  if (!owned) throw new NotFoundException();
  const from = parse(date, query.from),
    to = parse(date, query.to);
  if (from > to) fail('الفترة غير صحيحة');
  const accountant = query.accountant ? parse(id, query.accountant) : undefined;
  const [schoolRow, rows] = await db.$transaction(
    [
      db.school.findUniqueOrThrow({ where: { id: school } }),
      db.case.findMany({
        where: {
          schoolId: school,
          yearId,
          createdAt: { gte: new Date(from + 'T00:00:00+03:00'), lt: new Date(new Date(to + 'T00:00:00+03:00').getTime() + 86400000) },
          ...(accountant ? { createdBy: accountant } : {}),
        },
        include: { supplier: true, certificates: true, erp: true },
        orderBy: { createdAt: 'asc' },
      }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  const header = {
    school: schoolRow.name,
    year: owned.label,
    accountant: s.user.name,
    accountantFilter: accountant ?? 'كل المحاسبين المصرح بهم',
    from,
    to,
    dateBasis: 'تاريخ إنشاء المعاملة',
    generatedAt: new Date().toISOString(),
  };
  const ordered = rows.filter((r) => r.orderNumber).reduce((a, r) => a.plus(r.total), new D(0));
  const html = tableReport({
    title: 'تقرير المعاملات',
    ref: hash(JSON.stringify(header)).slice(0, 12),
    subtitle: `${schoolRow.name} — العام ${owned.label} — من ${fmtDate(from)} إلى ${fmtDate(to)} — الأساس: تاريخ إنشاء المعاملة — إعداد: ${s.user.name}`,
    heads: ['الرقم', 'الموضوع', 'المحاسب', 'المورد', 'أمر الشراء', 'القيمة', 'الحالة', 'ERP'],
    rows: rows.map((r) => [
      r.number,
      r.subject,
      r.accountantName,
      r.supplier?.name ?? '',
      r.orderNumber ?? '',
      amount(r.total),
      STATE_NAMES[r.state] ?? r.state,
      r.erp?.reference ?? '',
    ]),
    footer: `عدد المعاملات: ${rows.length} — إجمالي التكليفات: ${amount(ordered)} ر.ق`,
  });
  const run = await db.reportRun.create({
    data: {
      schoolId: school,
      yearId,
      actor: s.user.id,
      title: 'تقرير المعاملات ' + from + ' — ' + to,
      snapshot: plain({ header, rows }),
      html,
      hash: hash(JSON.stringify({ header, rows, html })),
    },
  });
  return { header, rows, html, id: run.id };
}

export async function readReportRuns({ school, rid, action, query }: ReadCtx) {
  if (!rid)
    return db.reportRun.findMany({
      where: { schoolId: school, ...(query.year ? { yearId: parse(id, query.year) } : {}) },
      select: { id: true, title: true, createdAt: true, hash: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  const run = await db.reportRun.findFirst({ where: { id: parse(id, rid), schoolId: school } });
  if (!run) throw new NotFoundException();
  const data = run.snapshot as any;
  if (action === 'xlsx')
    return {
      base64: await workbook(
        'المعاملات',
        ['الرقم', 'الموضوع', 'المحاسب', 'المورد', 'أمر الشراء', 'القيمة', 'الحالة', 'ERP'],
        data.rows.map((r: any) => [
          r.number,
          r.subject,
          r.accountantName,
          r.supplier?.name ?? '',
          r.orderNumber ?? '',
          Number(r.total),
          STATE_NAMES[r.state] ?? r.state,
          r.erp?.reference ?? '',
        ]),
        [
          ['المدرسة', data.header.school, 'المحاسب', data.header.accountant],
          ['من', data.header.from, 'إلى', data.header.to],
          ['أساس التاريخ', data.header.dateBasis, 'العام', data.header.year],
        ],
      ),
      name: 'transactions-' + run.id + '.xlsx',
      mime: XLSX,
    };
  return { ...data, id: run.id, html: run.html };
}

export async function readAudit({ s, school }: ReadCtx) {
  scope(s, school, ['AUDITOR', 'APPROVER', 'ADMIN']);
  return db.audit.findMany({ where: { schoolId: school }, orderBy: { createdAt: 'desc' }, take: 300 });
}

const REGISTRY_HEADS = [
  'م',
  'رقم الشهادة',
  'التاريخ',
  'اسم المورد',
  'رقم أمر التوريد / كتاب التكليف',
  'رقم الفاتورة',
  'قيمة أمر التوريد',
  'تاريخ أمر التوريد',
  'تاريخ التوريد الفعلي',
  'قيمة الأصناف الموردة فعلياً',
  'غرامات تأخير',
  'عدد أيام التأخير',
  'نسبة الغرامة %',
  'قيمة الغرامة',
  'الصافي بعد الغرامة',
  'ملاحظات',
  'المدرسة',
  'مدير المدرسة',
  'الموضوع',
];

/**
 * Completion-certificate register across every school the user belongs to (the «Data»/«Serech»
 * sheets of the Excel workbook): search by supplier, school, number, invoice or period; print or export.
 */
export async function certificateRegistry(s: Identity, query: Record<string, any>) {
  const allowed = schoolIds(s);
  const school = query.school ? parse(id, query.school) : undefined;
  if (school && !allowed.includes(school)) fail('غير مصرح بهذه المدرسة');
  const from = query.from ? parse(date, query.from) : undefined,
    to = query.to ? parse(date, query.to) : undefined;
  const q = String(query.q ?? '')
      .trim()
      .slice(0, 200),
    supplier = String(query.supplier ?? '')
      .trim()
      .slice(0, 200);
  const accountant = query.accountant ? parse(id, query.accountant) : undefined;
  const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
  const certs = await db.certificate.findMany({
    where: {
      case: {
        schoolId: school ? school : { in: allowed },
        ...(supplier ? { supplier: { name: contains(supplier) } } : {}),
        ...(accountant ? { createdBy: accountant } : {}),
      },
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from + 'T00:00:00+03:00') } : {}),
              ...(to ? { lt: new Date(new Date(to + 'T00:00:00+03:00').getTime() + 86400000) } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { number: contains(q) },
              { case: { orderNumber: contains(q) } },
              { case: { subject: contains(q) } },
              { case: { deliveries: { some: { invoice: contains(q) } } } },
            ],
          }
        : {}),
    },
    include: { case: { include: { school: true, supplier: true } } },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
  const rows = certs.map((c, i) => {
    const d = (c.details ?? c.snapshot) as any;
    return {
      id: c.id,
      schoolId: c.case.schoolId,
      cells: [
        certs.length - i,
        c.number,
        fmtDate(d.date ?? c.createdAt),
        d.supplier?.name ?? d.supplier ?? c.case.supplier?.name ?? '',
        c.case.orderNumber ?? '',
        d.invoice ?? '',
        num(c.case.total),
        fmtDate(c.case.issueDate),
        fmtDate(d.deliveryDate ?? null),
        num(c.gross),
        new D(c.fine).gt(0) ? 'نعم' : 'لا',
        d.lateDays ?? 0,
        d.finePct ?? '0',
        num(c.fine),
        num(c.net),
        d.notes ?? '',
        c.case.school.name,
        c.case.principalName,
        c.case.subject,
      ] as (string | number)[],
    };
  });
  if (query.format === 'xlsx')
    return {
      base64: await workbook(
        'سجل شهادات الإنجاز',
        REGISTRY_HEADS,
        rows.map((r) => r.cells),
      ),
      name: 'certificates-register.xlsx',
      mime: XLSX,
    };
  if (query.format === 'print')
    return {
      html: tableReport({
        title: 'سجل شهادات الإنجاز',
        ref: 'REGISTER',
        subtitle: await filterLine(s, { school, accountant, supplier, from, to }),
        heads: REGISTRY_HEADS.filter((_, i) => ![7, 15, 17].includes(i)),
        rows: rows.map((r) => r.cells.filter((_, i) => ![7, 15, 17].includes(i))),
        footer: `عدد الشهادات: ${rows.length}`,
      }),
    };
  return { heads: REGISTRY_HEADS, rows };
}

/** Report header line naming who prepared it and the filters applied (school, accountant, company, period). */
async function filterLine(s: Identity, f: { school?: string; accountant?: string; supplier?: string; from?: string; to?: string }) {
  const parts = [`إعداد: ${s.user.name}`];
  if (f.school) parts.push('المدرسة: ' + ((await db.school.findUnique({ where: { id: f.school } }))?.name ?? ''));
  if (f.accountant) parts.push('المحاسب: ' + ((await db.user.findUnique({ where: { id: f.accountant } }))?.name ?? ''));
  if (f.supplier) parts.push('الشركة: ' + f.supplier);
  if (f.from || f.to) parts.push(`الفترة: ${f.from ? fmtDate(f.from) : '…'} — ${f.to ? fmtDate(f.to) : '…'}`);
  return parts.join(' · ');
}

const REPORT_HEADS = [
  'م',
  'رقم التقرير',
  'تاريخ التقرير',
  'المدرسة',
  'الموضوع',
  'الشركة المكلفة',
  'قيمة العرض',
  'عدد العروض',
  'المحاسب',
  'الحالة',
];
const ORDER_HEADS = [
  'م',
  'رقم أمر الشراء / التكليف',
  'تاريخ التكليف',
  'المدرسة',
  'الموضوع',
  'الشركة',
  'قيمة التكليف',
  'مدة التنفيذ (أيام عمل)',
  'آخر موعد',
  'المحاسب',
  'الحالة',
];

/**
 * Register of quote reports (`type=report`) or assignment letters (`type=order`) across the user's
 * schools, filtered by school, accountant, company, period or text; with Excel and print.
 */
export async function caseRegister(s: Identity, query: Record<string, any>) {
  const type = query.type === 'order' ? 'order' : 'report';
  const allowed = schoolIds(s);
  const school = query.school ? parse(id, query.school) : undefined;
  if (school && !allowed.includes(school)) fail('غير مصرح بهذه المدرسة');
  const accountant = query.accountant ? parse(id, query.accountant) : undefined;
  const from = query.from ? parse(date, query.from) : undefined,
    to = query.to ? parse(date, query.to) : undefined;
  const q = String(query.q ?? '')
      .trim()
      .slice(0, 200),
    supplier = String(query.supplier ?? '')
      .trim()
      .slice(0, 200);
  const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
  const range = from || to ? { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } : undefined;
  const cases = await db.case.findMany({
    where: {
      schoolId: school ? school : { in: allowed },
      ...(type === 'report' ? { evaluationHtml: { not: null } } : { orderHtml: { not: null } }),
      ...(accountant ? { createdBy: accountant } : {}),
      ...(supplier ? { supplier: { name: contains(supplier) } } : {}),
      ...(range ? (type === 'report' ? { reportDate: range } : { issueDate: range }) : {}),
      ...(q
        ? { OR: [{ number: contains(q) }, { subject: contains(q) }, { orderNumber: contains(q) }, { evaluationNumber: contains(q) }] }
        : {}),
    },
    select: {
      id: true,
      schoolId: true,
      number: true,
      subject: true,
      state: true,
      total: true,
      evaluationNumber: true,
      reportDate: true,
      createdAt: true,
      orderNumber: true,
      issueDate: true,
      dueDate: true,
      deliveryDays: true,
      accountantName: true,
      school: { select: { name: true } },
      supplier: { select: { name: true } },
      _count: { select: { quotes: true } },
    },
    orderBy: type === 'report' ? [{ reportDate: 'desc' }, { createdAt: 'desc' }] : [{ issueDate: 'desc' }],
    take: 2000,
  });
  const rows = cases.map((c, i) => ({
    id: c.id,
    schoolId: c.schoolId,
    cells:
      type === 'report'
        ? [
            cases.length - i,
            c.evaluationNumber ?? c.number,
            fmtDate(c.reportDate ?? c.createdAt),
            c.school.name,
            c.subject,
            c.supplier?.name ?? '',
            num(c.total),
            c._count.quotes,
            c.accountantName,
            STATE_NAMES[c.state] ?? c.state,
          ]
        : [
            cases.length - i,
            c.orderNumber ?? '',
            fmtDate(c.issueDate),
            c.school.name,
            c.subject,
            c.supplier?.name ?? '',
            num(c.total),
            c.deliveryDays ?? '',
            fmtDate(c.dueDate),
            c.accountantName,
            STATE_NAMES[c.state] ?? c.state,
          ],
  }));
  const heads = type === 'report' ? REPORT_HEADS : ORDER_HEADS;
  const title = type === 'report' ? 'سجل تقارير دراسة عروض الأسعار' : 'سجل التكليفات (أوامر الشراء)';
  const total = cases.reduce((a, c) => a.plus(c.total), new D(0));
  if (query.format === 'xlsx')
    return {
      base64: await workbook(
        title.slice(0, 30),
        heads,
        rows.map((r) => r.cells as (string | number)[]),
      ),
      name: type === 'report' ? 'quote-reports-register.xlsx' : 'assignments-register.xlsx',
      mime: XLSX,
    };
  if (query.format === 'print')
    return {
      html: tableReport({
        title,
        ref: type === 'report' ? 'REPORTS' : 'ORDERS',
        subtitle: await filterLine(s, { school, accountant, supplier, from, to }),
        heads,
        rows: rows.map((r) => r.cells as (string | number)[]),
        footer: `العدد: ${rows.length} — الإجمالي: ${amount(total)} ر.ق`,
      }),
    };
  return { heads, rows, total: num(total) };
}

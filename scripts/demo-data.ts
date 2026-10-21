import { readFileSync } from 'node:fs';

/**
 * Trial data taken from the approved workbooks: school names, the suppliers list and sample petty-cash
 * invoices. People's names are not stored in the repository: they are read from the optional local
 * file scripts/seed-people.local.json (not committed) and fall back to role titles.
 */
export const DEMO_SCHOOLS = [
  { key: 'ABAF', name: 'محمد بن عبد الوهاب الثانوية للبنين', prefix: 'ABAF', erpCode: 'SCH-ERP-1042' },
  { key: 'SHFI', name: 'الإمام الشافعي الإعدادية للبنين', prefix: 'SHFI' },
  { key: 'MSAD', name: 'مسيعيد الإبتدائية - الإعدادية - الثانوية للبنات', prefix: 'MSAD' },
  { key: 'SZYD', name: 'سعيد بن زيد الإعدادية للبنين', prefix: 'SZYD' },
  { key: 'ARAF', name: 'عبد الرحمن بن عوف الإعدادية للبنين', prefix: 'ARAF' },
  { key: 'MANA', name: 'محمد بن عبد العزيز المانع الثانوية للبنين', prefix: 'MANA' },
  { key: 'HLSD', name: 'حليمة السعدية الإبتدائية للبنات', prefix: 'HLSD', other: true },
  // The two schools of the assignment workbook not in the others (records from the workbooks: see history()).
  ...(withHistory()
    ? [
        { key: 'ANDL', name: 'الأندلس الإبتدائية للبنات', prefix: 'ANDL', other: true },
        { key: 'RFDA', name: 'رفيدة بنت كعب الإعدادية للبنات', prefix: 'RFDA', other: true },
      ]
    : []),
];

/** The automated tests seed without the workbook records (DEMO_HISTORY=false) so their dates and amounts stay fixed. */
export function withHistory() {
  return process.env.DEMO_HISTORY !== 'false';
}

/**
 * Records taken from the approved workbooks (scripts/history-data.json): the certificates issued in 2026
 * (entered in the trial as earlier expenses on the budget lines), the full petty-cash statement, the
 * assignment still open in the assignment workbook, and the holidays sheet.
 */
export type History = {
  certificates2026: {
    date: string;
    school: string;
    supplier: string;
    reference: string;
    invoice: string;
    amount: number;
    subject: string;
    code: string;
  }[];
  petty: {
    school: string;
    amount: string;
    statementDate: string;
    invoices: { vendor: string; invoice: string; date: string; description: string; code: string; amount: string; note: string }[];
  };
  current: {
    school: string;
    subject: string;
    reportDate: string;
    quoteDate: string;
    quoteRef: string;
    supplier: string;
    item: string;
    unit: string;
    qty: number;
    price: string;
    code: string;
  };
  holidays: [string, string][];
};
let historyCache: History | undefined;
export function history(): History {
  if (!historyCache) {
    historyCache = JSON.parse(readFileSync('scripts/history-data.json', 'utf8')) as History;
  }
  return historyCache;
}

/** Earlier 2026 spending per school and budget line, added to the trial amounts so the lines keep room. */
export function priorSpend(school: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!withHistory()) return out;
  for (const c of history().certificates2026.filter((x) => x.school === school)) out[c.code] = (out[c.code] ?? 0) + c.amount;
  return out;
}

/** Approved amounts per budget line for the trial year. */
export const DEMO_BUDGET: Record<string, string> = {
  '510101': '8000',
  '510201': '12000',
  '510401': '60000',
  '10001': '10000',
  '520501': '15000',
  '520601': '20000',
  '520801': '30000',
  '530103': '10000',
  '530301': '25000',
  '540201': '25000',
  '540301': '5000',
};

export const DEMO_HOLIDAYS: [string, string, string][] = [
  ['2026-03-19', '2026-03-23', 'عيد الفطر (تقريبي — راجع التاريخ المعتمد)'],
  ['2026-05-26', '2026-05-30', 'عيد الأضحى (تقريبي — راجع التاريخ المعتمد)'],
  ['2026-12-18', '2026-12-18', 'اليوم الوطني'],
  ['2027-02-09', '2027-02-09', 'اليوم الرياضي للدولة'],
];

/**
 * Petty-cash invoices of the approved statement (ASKER sheet) dated in the trial year: vendor, invoice,
 * date, description, line, amount, note. The statement also lists invoices of November 2025, which the
 * system refuses in a 2026 statement (an invoice must fall inside the fiscal year of the imprest).
 */
export const DEMO_PETTY: [string, string, string, string, string, string, string][] = history()
  .petty.invoices.filter((i) => i.date >= '2026-01-01')
  .map((i) => [i.vendor, i.invoice, i.date, i.description, i.code, i.amount, i.note]);

type People = {
  accountant?: string;
  other?: string;
  admin?: string;
  schools?: Record<string, Record<string, string>>;
  /** Later principals per school: [first day, name]; the school's «principal» is the earlier one. */
  principalChanges?: Record<string, [string, string][]>;
};
let cached: People | undefined;
export async function people(): Promise<People> {
  if (cached) return cached;
  try {
    const { readFileSync } = await import('node:fs');
    cached = JSON.parse(readFileSync('scripts/seed-people.local.json', 'utf8'));
  } catch {
    cached = {};
  }
  return cached!;
}

/** Shared notes seeded for the trial (the administrator edits them from the notes screen). */
export const DEMO_NOTES: { title: string; body: string; category: string; sort: number }[] = [
  {
    title: 'قيد تسوية العهدة النثرية (استعاضة)',
    category: 'قيود عامة',
    sort: 1,
    body: 'من حـ/ مصروفات البنود المعنية (حسب كشف التسوية)\n    إلى حـ/ العهدة النثرية\nثم عند الاستعاضة: من حـ/ العهدة النثرية إلى حـ/ البنك بقيمة المنصرف المعتمد.',
  },
  {
    title: 'قيد إقفال عهدة معرض الكتاب',
    category: 'قيود عامة',
    sort: 2,
    body: 'من حـ/ المكتبة (510201) أو الأصل (110805) بقيمة الكتب\nمن حـ/ البنك بالرصيد المعاد\n    إلى حـ/ عهدة معرض الكتاب بكامل قيمتها.',
  },
  {
    title: 'الإهلاكات',
    category: 'إهلاكات',
    sort: 3,
    body: 'الأصول المشتراة على حسابات الأصول (مثل 110805) لا تُحمّل على مصروفات العام؛ تُقيد في سجل الأصول ويُحسب إهلاكها وفق تعميمات الوزارة.',
  },
  {
    title: 'تذكير: التسجيل في ERP',
    category: 'تنبيهات',
    sort: 4,
    body: 'يُسجل رقم القيد من صفحة المعاملة بعد صدور شهادة الإنجاز. كود المدرسة على ERP مسجل في الإعدادات ويظهر في الشاشة الرئيسية.',
  },
];

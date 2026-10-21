import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { isoDay, today } from '../common/dates';
import { parse } from '../common/validation';
import { scope, WORK, type Identity } from '../core/identity';
import { posting, ZERO } from '../core/ledger';
import { audit } from '../core/transaction';
import type { ReadCtx, WriteCtx } from './context';

const D = Prisma.Decimal;

/**
 * The certificates issued before the system (the reference register of 2022–2026) entered in the
 * school's own fiscal years as earlier expenses, so the budget of every year shows what was spent.
 * Each certificate is entered once (repeating the import adds nothing); a missing calendar year is
 * opened with the official budget lines. The budget line is taken from the subject and noted for review.
 */
const RULES: [RegExp, string][] = [
  [/ثلاثية/, '510401'],
  [/تربية خاصة|التربية الخاصة|ذوي/, '510101'],
  [/كتب|مكتبة|قصص/, '510201'],
  [/مطبوع|طباعة|بنر|رول|لوح|شهادات|أختام|اختام|ملصق|لافت/, '520601'],
  [/بوفيه|غداء|ضياف|إفطار|افطار|عشاء|وجبات|مطعم/, '520801'],
  [/صيانة|تركيب|نقل|إصلاح|اصلاح/, '530301'],
  [/قرطاس|مكتبي/, '520501'],
  [/هدايا|هدية|ساعات|عطر|تحفيز|تكريم|دروع|ميداليات|كؤوس|رحلة|احتفال|حفل/, '540201'],
  [/صحي|طبي|إسعاف|اسعاف/, '540301'],
];
export const lineForSubject = (subject: string) => RULES.find(([re]) => re.test(subject))?.[1] ?? '510401';

/** School names as typed in the workbooks: spaces, «للبنبن» and a missing «للبنين / للبنات» ignored. */
const key = (v: string) =>
  v
    .replace(/للبنبن/g, 'للبنين')
    .replace(/[إأآ]/g, 'ا')
    .replace(/\s+/g, '');
const sameSchool = (legacy: string, school: string) => {
  const a = key(legacy),
    b = key(school);
  return !!a && (a === b || b.startsWith(a) || a.startsWith(b));
};

const NOTE = (seq: number) => `سجل الشهادات السابقة م ${seq} — البند حسب الموضوع؛ راجعه`;

async function rowsFor(t: Tx | typeof db, tenantId: string, schoolName: string) {
  const all = await t.legacyCertificate.findMany({ where: { tenantId }, orderBy: { seq: 'asc' } });
  return all.filter((r) => sameSchool(r.schoolName, schoolName) && r.date <= new Date(today()));
}

/** GET schools/:school/legacy-import — what the import would enter, per year, and what is already in. */
export async function readLegacyImport({ s, school }: ReadCtx) {
  scope(s, school);
  const sc = await db.school.findUniqueOrThrow({ where: { id: school } });
  const rows = await rowsFor(db, s.user.tenantId, sc.name);
  const done = new Set(
    (await db.directExpense.findMany({ where: { schoolId: school, source: 'LEGACY' }, select: { note: true } })).map((e) => e.note),
  );
  const years = new Map<string, { year: string; count: number; total: number; imported: number }>();
  for (const r of rows) {
    const y = String(r.date.getUTCFullYear());
    const v = years.get(y) ?? { year: y, count: 0, total: 0, imported: 0 };
    v.count += 1;
    v.total += Number(r.net);
    if (done.has(NOTE(r.seq))) v.imported += 1;
    years.set(y, v);
  }
  return { school: sc.name, years: [...years.values()].sort((a, b) => a.year.localeCompare(b.year)) };
}

/** Opens a calendar fiscal year with the official budget lines (amounts 0), as the years screen does. */
async function ensureYear(t: Tx, s: Identity, school: string, label: string) {
  const start = new Date(`${label}-01-01`),
    end = new Date(`${label}-12-31`);
  const found = await t.fiscalYear.findFirst({ where: { schoolId: school, startDate: { lte: start }, endDate: { gte: start } } });
  if (found) return { year: found, created: false };
  const year = await t.fiscalYear.create({ data: { schoolId: school, label, startDate: start, endDate: end } });
  const catalog = await t.budgetCatalog.findMany({ where: { tenantId: s.user.tenantId }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] });
  await t.budget.createMany({
    data: catalog.map((c, i) => ({
      schoolId: school,
      yearId: year.id,
      code: c.code,
      name: c.nameAr,
      nameEn: c.nameEn,
      assetCode: c.assetCode,
      groupKey: c.groupKey,
      sort: i,
      approved: 0,
    })),
  });
  return { year, created: true };
}

/**
 * POST schools/:school/legacy-import {years?: ['2022', …]} — enters the school's earlier certificates.
 * In a year that has ended, a line whose approved amount was never entered is raised to what was spent
 * (the real approved budget can be typed later); in the current year a line without room is skipped and
 * listed, so the current budget is never changed behind the accountant's back.
 */
export async function writeLegacyImport({ s, school, t, body }: WriteCtx) {
  scope(s, school, WORK);
  const p = parse(
    z
      .object({
        years: z
          .array(z.string().regex(/^20\d\d$/))
          .max(20)
          .optional(),
      })
      .strict(),
    body ?? {},
  );
  const sc = await t.school.findUniqueOrThrow({ where: { id: school } });
  const rows = (await rowsFor(t, s.user.tenantId, sc.name)).filter((r) => !p.years || p.years.includes(String(r.date.getUTCFullYear())));
  const done = new Set(
    (await t.directExpense.findMany({ where: { schoolId: school, source: 'LEGACY' }, select: { note: true } })).map((e) => e.note),
  );
  const opened: string[] = [],
    raised: string[] = [],
    skipped: { seq: number; reason: string }[] = [];
  let count = 0,
    total = new D(0);
  for (const r of rows) {
    if (done.has(NOTE(r.seq))) continue;
    const label = String(r.date.getUTCFullYear());
    const { year, created } = await ensureYear(t, s, school, label);
    if (created) opened.push(label);
    if (year.closed) {
      skipped.push({ seq: r.seq, reason: `العام ${year.label} مغلق` });
      continue;
    }
    const code = lineForSubject(r.subject);
    const budget = await t.budget.findFirst({ where: { schoolId: school, yearId: year.id, code } });
    if (!budget) {
      skipped.push({ seq: r.seq, reason: `البند ${code} غير موجود في ${year.label}` });
      continue;
    }
    const amount = new D(r.net);
    const need = budget.committed.plus(budget.spent).plus(amount);
    if (need.gt(budget.approved)) {
      if (isoDay(year.endDate) >= today()) {
        skipped.push({ seq: r.seq, reason: `لا يوجد رصيد كافٍ في البند ${code} للعام الحالي` });
        continue;
      }
      await t.budget.update({ where: { id: budget.id }, data: { approved: need } });
      if (!raised.includes(`${year.label}/${code}`)) raised.push(`${year.label}/${code}`);
    }
    const e = await t.directExpense.create({
      data: {
        schoolId: school,
        yearId: year.id,
        budgetId: budget.id,
        date: r.date,
        vendor: r.supplier,
        reference: [r.orderNo, r.invoice && 'فاتورة ' + r.invoice].filter(Boolean).join(' — '),
        description: r.subject || 'شهادة إنجاز سابقة',
        amount,
        source: 'LEGACY',
        note: NOTE(r.seq),
        createdBy: s.user.id,
      },
    });
    await posting(t, budget.id, ZERO, amount, 'legacy:' + school + ':' + r.seq, e.id, s.user.id);
    count += 1;
    total = total.plus(amount);
  }
  await audit(t, s, school, 'LEGACY_IMPORT', school, { count, total: total.toFixed(2), opened, raised, skipped: skipped.length });
  return { id: school, count, total: total.toFixed(2), opened, raised, skipped };
}

import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../common/db';
import { today } from '../common/dates';
import { date, fail, id, parse } from '../common/validation';
import { schoolIds, scope, type Identity } from '../core/identity';
import type { ReadCtx, WriteCtx } from './context';

/**
 * Cases sent back by the auditors: when, why (a fixed list, so the reasons can be counted), and when
 * the accountant resolved them; plus remarks on a case from anyone who can see it, including the
 * read-only auditor. The administrator sees which reasons recur, for whom, and can turn a reason
 * into a rule of the paper-file check.
 */

export const RETURN_REASONS = {
  DATES: { label: 'عدم تسلسل أو تطابق التواريخ', rule: 'تسلسل التواريخ صحيح في كل المستندات ومطابق للمسجل' },
  ITEMS: {
    label: 'عدم مطابقة الأصناف أو عددها أو كمياتها',
    rule: 'الأصناف وعددها وكمياتها متطابقة في التكليف والفاتورة وإذني التسليم والاستلام',
  },
  AMOUNTS: { label: 'خطأ في المبالغ أو الغرامة أو الصافي', rule: 'المبالغ والغرامة والصافي متطابقة في الشهادة والتغطية والفاتورة' },
  SIGNATURE: { label: 'توقيع أو ختم ناقص', rule: 'كل التوقيعات والأختام المطلوبة موجودة على كل المستندات' },
  MISSING_DOC: { label: 'مستند ناقص من الملف', rule: 'كل المستندات المؤشر عليها في شهادة الإنجاز موجودة في الملف' },
  SCHOOL_NAME: { label: 'اختلاف اسم المدرسة', rule: 'اسم المدرسة مكتوب بنفس الصيغة في كل ورقة' },
  SUPPLIER: { label: 'بيانات المورد أو السجل التجاري', rule: 'السجل التجاري لكل شركة موجود وساري واسم المورد موحد' },
  IBAN: { label: 'رقم الحساب البنكي (IBAN)', rule: 'إثبات IBAN موجود ومطابق لاسم المورد ورقم حسابه' },
  UNDERTAKING: { label: 'التعهد', rule: 'التعهد بعدم تبعية الشركة لمنسوبي الوزارة موقع ومختوم' },
  INVOICE: { label: 'الفاتورة', rule: 'الفاتورة أصلية ومختومة وعليها رقم التكليف وقيمتها مطابقة' },
  REFERENCE: { label: 'أرقام مرجعية', rule: 'رقم التكليف ورقم الفاتورة متطابقان في كل المستندات' },
  OTHER: { label: 'أخرى', rule: '' },
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;
const REASON_KEYS = Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]];

async function caseOf(t: WriteCtx['t'] | typeof db, school: string, caseId: string) {
  const c = await t.case.findFirst({ where: { id: parse(id, caseId), schoolId: school }, select: { id: true, number: true } });
  if (!c) throw new NotFoundException('المعاملة غير موجودة');
  return c;
}

/** POST case-returns {caseId, date, reasons, note}; PATCH case-returns/:id {resolveNote} resolves it. */
export async function writeReturns({ s, school, t, body, rid, method }: WriteCtx) {
  scope(s, school);
  if (rid && method === 'PATCH') {
    const r = await t.caseReturn.findFirst({ where: { id: parse(id, rid), schoolId: school } });
    if (!r) throw new NotFoundException();
    if (r.resolvedAt) fail('الإرجاع مُغلق بالفعل');
    const p = parse(z.object({ resolveNote: z.string().trim().min(3, 'اكتب ما تم تصحيحه').max(1000) }).strict(), body);
    return t.caseReturn.update({
      where: { id: r.id },
      data: { resolvedAt: new Date(), resolvedBy: s.user.id, resolveNote: p.resolveNote },
    });
  }
  const p = parse(
    z
      .object({
        caseId: id,
        date,
        reasons: z.array(z.enum(REASON_KEYS)).min(1, 'اختر سبباً واحداً على الأقل').max(12),
        note: z.string().trim().max(2000).default(''),
      })
      .strict(),
    body,
  );
  if (p.date > today()) fail('تاريخ مستقبلي');
  if (p.reasons.includes('OTHER') && !p.note) fail('اكتب تفاصيل السبب «أخرى»');
  const c = await caseOf(t, school, p.caseId);
  return t.caseReturn.create({
    data: {
      schoolId: school,
      caseId: c.id,
      date: new Date(p.date),
      reasons: [...new Set(p.reasons)],
      note: p.note,
      createdBy: s.user.id,
      byName: s.user.name,
    },
  });
}

/** POST case-comments {caseId, text, docCode?}; PATCH case-comments/:id {resolved} — any role that can see the school, auditor included. */
export async function writeComments({ s, school, t, body, rid, method }: WriteCtx) {
  scope(s, school);
  if (rid && method === 'PATCH') {
    const row = await t.caseComment.findFirst({ where: { id: parse(id, rid), schoolId: school } });
    if (!row) throw new NotFoundException();
    const p = parse(z.object({ resolved: z.boolean() }).strict(), body);
    return t.caseComment.update({ where: { id: row.id }, data: { resolved: p.resolved } });
  }
  const p = parse(
    z
      .object({ caseId: id, text: z.string().trim().min(2).max(2000), docCode: z.number().int().min(1).max(15).nullable().default(null) })
      .strict(),
    body,
  );
  const c = await caseOf(t, school, p.caseId);
  return t.caseComment.create({
    data: { schoolId: school, caseId: c.id, userId: s.user.id, byName: s.user.name, text: p.text, docCode: p.docCode },
  });
}

export async function readReturns({ s, school, query }: ReadCtx) {
  scope(s, school);
  return db.caseReturn.findMany({ where: { schoolId: school, caseId: parse(id, query.case) }, orderBy: { createdAt: 'desc' } });
}

export async function readComments({ s, school, query }: ReadCtx) {
  scope(s, school);
  return db.caseComment.findMany({ where: { schoolId: school, caseId: parse(id, query.case) }, orderBy: { createdAt: 'asc' } });
}

/** Reasons over a period: by reason, by accountant (who prepared the case) and by school; plus the open returns. */
export async function returnsReport(s: Identity, query: Record<string, any>) {
  const from = query.from ? String(query.from) : `${today().slice(0, 4)}-01-01`;
  const to = query.to ? String(query.to) : today();
  const ids = s.user.isTenantAdmin ? undefined : schoolIds(s);
  const rows = await db.caseReturn.findMany({
    where: {
      date: { gte: new Date(from), lte: new Date(to) },
      ...(ids ? { schoolId: { in: ids } } : { case: { school: { tenantId: s.user.tenantId } } }),
    },
    include: {
      case: {
        select: {
          id: true,
          number: true,
          subject: true,
          createdBy: true,
          accountantName: true,
          school: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const reasons = rows.flatMap((r) => (r.reasons as string[]).filter((x): x is ReturnReason => x in RETURN_REASONS));
  return {
    from,
    to,
    total: rows.length,
    open: rows.filter((r) => !r.resolvedAt).length,
    byReason: count(reasons).map(([reason, n]) => ({
      reason,
      label: RETURN_REASONS[reason].label,
      rule: RETURN_REASONS[reason].rule,
      count: n,
    })),
    byAccountant: count(rows.map((r) => r.case.accountantName)).map(([name, n]) => ({ name, count: n })),
    bySchool: count(rows.map((r) => r.case.school.name)).map(([name, n]) => ({ name, count: n })),
    rows: rows.map((r) => ({
      id: r.id,
      date: r.date,
      caseId: r.case.id,
      schoolId: r.case.school.id,
      school: r.case.school.name,
      number: r.case.number,
      subject: r.case.subject,
      accountant: r.case.accountantName,
      reasons: (r.reasons as string[]).map((x) => RETURN_REASONS[x as ReturnReason]?.label ?? x),
      note: r.note,
      resolvedAt: r.resolvedAt,
      resolveNote: r.resolveNote,
    })),
    reasonsList: REASON_KEYS.map((k) => ({ key: k, label: RETURN_REASONS[k].label })),
  };
}

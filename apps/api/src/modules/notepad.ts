import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { fail, id, parse, text } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';

/** The accountant's own notepad beside the home screen: open notes first (pinned on top), then the last done ones. */
export async function readMyNotes(s: Identity) {
  const [open, done] = await Promise.all([
    db.userNote.findMany({ where: { userId: s.user.id, done: false }, orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }] }),
    db.userNote.findMany({ where: { userId: s.user.id, done: true }, orderBy: { updatedAt: 'desc' }, take: 15 }),
  ]);
  return { open, done };
}

const COLORS = ['yellow', 'pink', 'blue', 'green'] as const;

/** POST {text, color?, schoolId?} adds a note; PATCH :id {text?, done?, pinned?, color?}; DELETE :id. Only the owner. */
export async function writeMyNotes(s: Identity, t: Tx, rid: string | undefined, method: string, body: unknown) {
  if (!rid) {
    const p = parse(
      z.object({ text: z.string().trim().min(1).max(2000), color: z.enum(COLORS).default('yellow'), schoolId: id.optional() }).strict(),
      body,
    );
    return t.userNote.create({ data: { ...p, userId: s.user.id } });
  }
  const note = await t.userNote.findFirst({ where: { id: parse(id, rid), userId: s.user.id } });
  if (!note) throw new NotFoundException();
  if (method === 'DELETE') return t.userNote.delete({ where: { id: note.id } });
  const p = parse(
    z
      .object({ text: z.string().trim().min(1).max(2000), done: z.boolean(), pinned: z.boolean(), color: z.enum(COLORS) })
      .partial()
      .strict(),
    body,
  );
  return t.userNote.update({ where: { id: note.id }, data: p });
}

/**
 * Guidance journal entries: reference only (never posted), for entries the accountant prepares by hand —
 * depreciation, imprest replenishment, closing an imprest, retirement of an asset… Account numbers that
 * are not in the budget catalog are written as names; the approved chart of accounts prevails.
 */
type Line = { side: 'D' | 'C'; account: string; amount: string };
const L = (side: 'D' | 'C', account: string, amount: string): Line => ({ side, account, amount });

export const STANDARD_GUIDE: { category: string; title: string; usage: string; lines: Line[]; note: string }[] = [
  {
    category: 'العهد',
    title: 'استلام العهدة النثرية',
    usage: 'عند صرف قيمة العهدة لأمين العهدة (شيك / تحويل).',
    lines: [L('D', 'حـ/ العهدة النثرية — باسم أمين العهدة', 'قيمة العهدة'), L('C', 'حـ/ البنك', 'قيمة العهدة')],
    note: '',
  },
  {
    category: 'العهد',
    title: 'تسوية العهدة النثرية (كشف الاستعاضة)',
    usage: 'عند اعتماد كشف التسوية بفواتير الفترة.',
    lines: [
      L('D', 'حـ/ مصروفات البنود المعنية (حسب كشف التسوية، كل بند برقمه)', 'مبلغ كل بند'),
      L('C', 'حـ/ العهدة النثرية', 'إجمالي الكشف'),
    ],
    note: 'ثم عند استلام الاستعاضة: من حـ/ العهدة النثرية إلى حـ/ البنك بقيمة المنصرف المعتمد.',
  },
  {
    category: 'العهد',
    title: 'إقفال عهدة معرض الكتاب أو يوم التعليم',
    usage: 'عند تسوية العهدة وإعادة الرصيد المتبقي.',
    lines: [
      L('D', 'حـ/ المكتبة 510201 (مصروف) أو حـ/ أصل الكتب 110805', 'قيمة المشتريات'),
      L('D', 'حـ/ البنك', 'الرصيد المعاد'),
      L('C', 'حـ/ العهدة (معرض الكتاب / يوم التعليم)', 'كامل قيمة العهدة'),
    ],
    note: 'الكتب التي تُعامل كأصل تُقيد على 110805 ولا تُحمّل على مصروفات العام.',
  },
  {
    category: 'المشتريات',
    title: 'إثبات المصروف بعد شهادة الإنجاز',
    usage: 'عند صدور شهادة الإنجاز وكتاب التغطية (التسجيل في ERP).',
    lines: [
      L('D', 'حـ/ بند الموازنة المعني (مثل 510401)', 'صافي الشهادة + الغرامة'),
      L('C', 'حـ/ الدائنون — المورد', 'صافي المستحق'),
      L('C', 'حـ/ إيرادات الغرامات', 'قيمة الغرامة'),
    ],
    note: 'السداد للمورد يتم من إدارة الشؤون المالية: من حـ/ الدائنون — المورد إلى حـ/ البنك.',
  },
  {
    category: 'المشتريات',
    title: 'الارتباط عند إصدار كتاب التكليف (قيد نظامي)',
    usage: 'متابعة الارتباطات على البند قبل الإنجاز؛ يُعكس عند إثبات المصروف.',
    lines: [L('D', 'حـ/ ارتباطات البند (نظامي)', 'قيمة التكليف'), L('C', 'حـ/ مقابل الارتباطات (نظامي)', 'قيمة التكليف')],
    note: 'قيد مذكرة للمتابعة فقط؛ يعكسه النظام تلقائياً عند الشهادة.',
  },
  {
    category: 'الأصول والإهلاك',
    title: 'شراء أصل ثابت (أثاث / أجهزة / كتب المكتبة)',
    usage: 'عند شراء ما يُرسمل كأصل وفق سياسة الرسملة المعتمدة.',
    lines: [
      L('D', 'حـ/ الأصل المعني (مثل أصل الكتب 110805 / الأثاث والتجهيزات المكتبية / أجهزة الحاسب)', 'التكلفة'),
      L('C', 'حـ/ الدائنون — المورد أو حـ/ البنك', 'التكلفة'),
    ],
    note: 'يُسجل الأصل في سجل الأصول برقمه وتاريخ الشراء والتكلفة والعمر الإنتاجي.',
  },
  {
    category: 'الأصول والإهلاك',
    title: 'إهلاك الأثاث والتجهيزات المكتبية (سنوي)',
    usage: 'في نهاية العام المالي (أو شهرياً حسب السياسة المعتمدة).',
    lines: [
      L('D', 'حـ/ مصروف الإهلاك — أثاث وتجهيزات مكتبية', 'قسط الإهلاك'),
      L('C', 'حـ/ مجمع إهلاك الأثاث والتجهيزات المكتبية', 'قسط الإهلاك'),
    ],
    note: 'القسط (القسط الثابت) = (التكلفة − قيمة الخردة) ÷ العمر الإنتاجي بالسنوات. العمر والنسبة حسب تعميم الوزارة.',
  },
  {
    category: 'الأصول والإهلاك',
    title: 'إهلاك أجهزة الحاسب والأجهزة الإلكترونية',
    usage: 'في نهاية العام المالي.',
    lines: [L('D', 'حـ/ مصروف الإهلاك — أجهزة الحاسب', 'قسط الإهلاك'), L('C', 'حـ/ مجمع إهلاك أجهزة الحاسب', 'قسط الإهلاك')],
    note: 'لسنة الشراء: القسط بنسبة الأشهر من تاريخ الاستخدام إن كانت السياسة تقضي بذلك.',
  },
  {
    category: 'الأصول والإهلاك',
    title: 'استبعاد أصل تالف أو مفقود',
    usage: 'عند اعتماد محضر الإتلاف أو الشطب.',
    lines: [
      L('D', 'حـ/ مجمع إهلاك الأصل', 'الإهلاك المتراكم'),
      L('D', 'حـ/ خسائر استبعاد الأصول', 'القيمة الدفترية'),
      L('C', 'حـ/ الأصل', 'التكلفة'),
    ],
    note: 'القيمة الدفترية = التكلفة − الإهلاك المتراكم. يُرفق محضر لجنة الجرد والإتلاف.',
  },
  {
    category: 'تسويات',
    title: 'تصحيح قيد على بند غير صحيح',
    usage: 'عند اكتشاف تحميل مصروف على بند خاطئ.',
    lines: [L('D', 'حـ/ البند الصحيح', 'المبلغ'), L('C', 'حـ/ البند الخاطئ', 'المبلغ')],
    note: 'يُذكر رقم القيد الأصلي في البيان، ويُراعى رصيد البند الصحيح قبل التصحيح.',
  },
];

/** GET admin/journal-guide — the guidance entries (the standard set is added on first use). */
export async function readGuide(s: Identity) {
  const tenantId = s.user.tenantId;
  if (!(await db.journalGuide.count({ where: { tenantId } })))
    await db.journalGuide.createMany({ data: STANDARD_GUIDE.map((g, sort) => ({ ...g, lines: g.lines as any, tenantId, sort })) });
  return db.journalGuide.findMany({ where: { tenantId }, orderBy: [{ sort: 'asc' }, { title: 'asc' }] });
}

/** Administrator: POST adds an entry, PATCH :id edits it, DELETE :id removes it. */
export async function writeGuide(s: Identity, t: Tx, rid: string | undefined, method: string, body: unknown) {
  requireTenantAdmin(s);
  const tenantId = s.user.tenantId;
  if (rid) {
    const row = await t.journalGuide.findFirst({ where: { id: parse(id, rid), tenantId } });
    if (!row) throw new NotFoundException();
    if (method === 'DELETE') return t.journalGuide.delete({ where: { id: row.id } });
  }
  const p = parse(
    z
      .object({
        title: text,
        category: text,
        usage: z.string().trim().max(500).default(''),
        lines: z
          .array(
            z.object({
              side: z.enum(['D', 'C']),
              account: z.string().trim().min(2).max(200),
              amount: z.string().trim().max(120).default(''),
            }),
          )
          .min(2)
          .max(12),
        note: z.string().trim().max(1500).default(''),
        sort: z.number().int().min(0).max(1000).default(0),
      })
      .strict(),
    body,
  );
  if (!p.lines.some((l) => l.side === 'D') || !p.lines.some((l) => l.side === 'C')) fail('القيد يحتاج طرفاً مديناً وطرفاً دائناً');
  const data = { ...p, lines: p.lines as any, updatedBy: s.user.id };
  return rid ? t.journalGuide.update({ where: { id: rid }, data }) : t.journalGuide.create({ data: { ...data, tenantId } });
}

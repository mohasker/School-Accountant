import { z } from 'zod';
import type { Tx } from '../common/db';
import { Calendar, isoDay, today } from '../common/dates';

/**
 * Financial policy values. Each change is stored as a new PolicySetting row with an effective
 * date, so earlier transactions keep the rule that applied to them.
 */
export const POLICY = {
  singleQuoteLimit: {
    label: 'حد الشراء بعرض سعر واحد (ر.ق)',
    help: 'المشتريات حتى هذه القيمة يكفيها عرض سعر واحد، وما يزيد يتطلب الحد الأدنى من العروض',
    schema: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/),
    value: '1000',
  },
  minQuotes: {
    label: 'الحد الأدنى لعدد عروض الأسعار',
    help: 'للمشتريات التي تزيد عن حد العرض الواحد، إلا إذا كان المورد محتكراً للصنف',
    schema: z.number().int().min(1).max(10),
    value: 3,
  },
  tenderLimit: {
    label: 'حد المناقصة (ر.ق)',
    help: 'ما يزيد عنه من اختصاص إدارة المشتريات والمناقصات بالوزارة ولا يُعالج بالمدرسة',
    schema: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    value: '200000',
  },
  fineRatePerDay: {
    label: 'نسبة غرامة التأخير عن كل يوم عمل',
    help: 'كنسبة عشرية: 0.01 تعني 1%',
    schema: z.string().regex(/^0(\.\d{1,4})?$/),
    value: '0.01',
  },
  fineCap: {
    label: 'الحد الأقصى للغرامة من قيمة التكليف',
    help: 'كنسبة عشرية: 0.10 تعني 10%',
    schema: z.string().regex(/^0(\.\d{1,4})?$|^1$/),
    value: '0.10',
  },
  startWithinDays: {
    label: 'مهلة بدء التوريد (أيام عمل)',
    help: 'تظهر في شروط كتاب التكليف',
    schema: z.number().int().min(0).max(60),
    value: 2,
  },
  defaultDeliveryDays: {
    label: 'مدة التوريد الافتراضية (أيام عمل)',
    help: 'تقترح عند إصدار التكليف ويمكن تعديلها لكل تكليف',
    schema: z.number().int().min(1).max(365),
    value: 15,
  },
  weekend: {
    label: 'أيام العطلة الأسبوعية',
    help: '0 الأحد … 5 الجمعة، 6 السبت',
    schema: z.array(z.number().int().min(0).max(6)).max(3),
    value: [5, 6] as number[],
  },
  pettyReplenishPct: {
    label: 'نسبة الصرف المطلوبة لاستعاضة النثرية',
    help: 'كنسبة عشرية: 0.75 تعني أن الاستعاضة تُطلب عند صرف 75% من قيمة العهدة',
    schema: z.string().regex(/^0(\.\d{1,4})?$|^1$/),
    value: '0.75',
  },
} as const;

export type PolicyKey = keyof typeof POLICY;
export type Policy = {
  singleQuoteLimit: string;
  minQuotes: number;
  tenderLimit: string;
  fineRatePerDay: string;
  fineCap: string;
  startWithinDays: number;
  defaultDeliveryDays: number;
  weekend: number[];
  pettyReplenishPct: string;
};

export const policyKeys = Object.keys(POLICY) as PolicyKey[];

/** Policy in force on `on` (default: today) for the tenant. */
export async function loadPolicy(t: Tx, tenantId: string, on = today()): Promise<Policy> {
  const rows = await t.policySetting.findMany({
    where: { tenantId, effectiveFrom: { lte: new Date(on) } },
    orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
  });
  const result: any = Object.fromEntries(policyKeys.map((k) => [k, POLICY[k].value]));
  for (const row of rows) if (row.key in POLICY) result[row.key] = row.value;
  return result;
}

export async function loadCalendar(t: Tx, tenantId: string, weekend: number[]) {
  const holidays = await t.holiday.findMany({ where: { tenantId }, select: { date: true } });
  return new Calendar(weekend, new Set(holidays.map((h) => isoDay(h.date))));
}

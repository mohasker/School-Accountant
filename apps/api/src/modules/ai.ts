import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { db } from '../common/db';
import { isoDay, today } from '../common/dates';
import { num } from '../common/money';
import { fail, id, parse } from '../common/validation';
import { loadPolicy } from '../core/policy';
import { STATE_NAMES } from '../core/documents';
import { requireTenantAdmin, scope, type Identity } from '../core/identity';
import { seal, unseal } from '../core/secrets';

/**
 * Assistant for the accountants: answers questions about the system, the procurement rules and the
 * school's own figures (budget lines, open files, imprests). It never writes to the database; every
 * action is still taken by the accountant on the screens. The key comes from ANTHROPIC_API_KEY or is
 * saved by the system administrator (policy screen); without a key the screen says so.
 */

const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 24;

export async function aiStatus(s: Identity) {
  const key = await apiKey(s.user.tenantId);
  return { configured: Boolean(key), model: MODEL, source: process.env.ANTHROPIC_API_KEY ? 'env' : key ? 'admin' : 'none' };
}

export async function apiKey(tenantId: string) {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { aiKey: true } });
  return unseal(t?.aiKey || '');
}

export async function saveAiKey(s: Identity, body: any) {
  requireTenantAdmin(s);
  const p = parse(z.object({ key: z.string().trim().max(300) }).strict(), body);
  if (p.key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(p.key)) fail('صيغة المفتاح غير صحيحة (يبدأ بـ sk-ant-)');
  await db.tenant.update({ where: { id: s.user.tenantId }, data: { aiKey: seal(p.key) } });
  return { configured: Boolean(p.key || process.env.ANTHROPIC_API_KEY) };
}

const SYSTEM = `أنت «مساعد MOESAS»، مساعد محاسبي المدارس الحكومية في دولة قطر داخل نظام محاسبي المدارس الحكومية (MOESAS).
مهمتك مساعدة المحاسب على العمل بسرعة وصحة: شرح خطوات النظام، تفسير القواعد المالية، مراجعة الأرقام المعروضة لك، واقتراح الخطوة التالية.
قواعد النظام (من السياسة المالية المرفقة بالسياق): تقرير عروض الأسعار يكلَّف فيه الأقل سعراً المطابق أو الشركة الوحيدة؛ التكليف ثم شهادة الإنجاز وكتاب التغطية؛ الغرامة بأيام العمل (الأحد–الخميس) مع استبعاد الإجازات الرسمية؛ العهدة النثرية تُستعاض عند بلوغ نسبة الاستعاضة.
- أجب بالعربية الفصحى المبسطة وبإيجاز، وبنقاط عند تعدد الخطوات.
- اعتمد فقط على الأرقام الموجودة في السياق؛ إذا لم تكن المعلومة في السياق فقل ذلك واقترح الشاشة التي تُعرض فيها.
- لا تخترع أرقاماً أو تواريخ أو أسماء مستندات، ولا تدّعِ أنك نفذت إجراءً؛ أنت لا تعدّل البيانات، المحاسب هو من ينفذ من الشاشات.
- عند السؤال عن سياسات الوزارة خارج ما في السياق، وضّح أن المرجع هو التعميمات الرسمية للوزارة.`;

export async function chat(s: Identity, body: any) {
  const p = parse(
    z
      .object({
        school: id.optional(),
        year: id.optional(),
        messages: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(8000) }))
          .min(1)
          .max(MAX_TURNS),
      })
      .strict(),
    body,
  );
  if (p.messages[p.messages.length - 1].role !== 'user') fail('آخر رسالة يجب أن تكون من المستخدم');
  const key = await apiKey(s.user.tenantId);
  if (!key) fail('المساعد الذكي غير مفعّل: يضيف مسؤول النظام مفتاح Anthropic API من شاشة السياسة المالية');
  const context = await schoolContext(s, p.school, p.year);
  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 90_000 });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low' },
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: context },
    ],
    messages: p.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  if (response.stop_reason === 'refusal') fail('تعذر على المساعد الإجابة عن هذا الطلب');
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { reply: text || 'لم أتمكن من صياغة إجابة، أعد صياغة السؤال.', truncated: response.stop_reason === 'max_tokens' };
}

/** What the assistant may see: the school, the year, the budget lines, open files and imprests — figures only. */
async function schoolContext(s: Identity, schoolId?: string, yearId?: string) {
  const policy = await loadPolicy(db, s.user.tenantId);
  const lines = [
    `التاريخ اليوم: ${today()}. المستخدم: ${s.user.name}${s.user.isTenantAdmin ? ' (مسؤول النظام)' : ''}.`,
    `السياسة المالية: عرض واحد حتى ${num(policy.singleQuoteLimit)} ر.ق؛ ${policy.minQuotes} عروض فوقه؛ مناقصة فوق ${num(policy.tenderLimit)} ر.ق؛ الاستعاضة عند ${Number(policy.pettyReplenishPct) * 100}% من العهدة؛ الغرامة ${Number(policy.fineRatePerDay) * 100}% يومياً بحد ${Number(policy.fineCap) * 100}%.`,
  ];
  if (!schoolId) return lines.join('\n');
  scope(s, schoolId);
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return lines.join('\n');
  lines.push(`المدرسة: ${school.name}؛ المدير: ${school.principal}؛ كود ERP: ${school.erpCode || 'غير مسجل'}.`);
  if (!yearId) return lines.join('\n');
  const year = await db.fiscalYear.findUnique({ where: { id: yearId, schoolId } });
  if (!year) return lines.join('\n');
  const [budgets, cases, imprests] = await Promise.all([
    db.budget.findMany({ where: { schoolId, yearId }, orderBy: [{ sort: 'asc' }, { code: 'asc' }] }),
    db.case.findMany({
      where: { schoolId, yearId, state: { notIn: ['CERTIFIED', 'COMPLETE', 'REGISTERED', 'CANCELLED'] } },
      select: { number: true, subject: true, state: true, total: true, dueDate: true, supplier: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    db.imprest.findMany({ where: { schoolId, yearId }, select: { name: true, type: true, amount: true, balance: true, closed: true } }),
  ]);
  lines.push(`العام المالي ${year.label} (${isoDay(year.startDate)} → ${isoDay(year.endDate)}).`);
  lines.push('بنود الموازنة (الرمز | الاسم | المعتمد | المصروف | الارتباطات | المتاح):');
  for (const b of budgets)
    lines.push(
      `- ${b.code} | ${b.name} | ${num(b.approved)} | ${num(b.spent)} | ${num(b.committed)} | ${num(b.approved.minus(b.spent).minus(b.committed))}`,
    );
  lines.push(`المعاملات غير المكتملة (${cases.length}):`);
  for (const c of cases)
    lines.push(
      `- ${c.number} | ${c.subject} | ${STATE_NAMES[c.state] ?? c.state} | ${num(c.total)} ر.ق | ${c.supplier?.name ?? 'بلا شركة'} | آخر موعد ${c.dueDate ? isoDay(c.dueDate) : '—'}`,
    );
  lines.push('العهد:');
  for (const a of imprests)
    lines.push(`- ${a.name} (${a.type}) | القيمة ${num(a.amount)} | الرصيد ${num(a.balance)} | ${a.closed ? 'مغلقة' : 'مفتوحة'}`);
  return lines.join('\n');
}

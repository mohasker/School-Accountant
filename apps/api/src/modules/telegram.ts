import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { today } from '../common/dates';
import { num } from '../common/money';
import { fail, parse } from '../common/validation';
import { identityForUser, requireTenantAdmin, WORK, type Identity } from '../core/identity';
import { htmlToPdf } from '../core/pdf';
import { seal, unseal } from '../core/secrets';
import { mutate, read } from './router';

/**
 * Telegram bot: an accountant links their account once (a short code), then issues assignment
 * letters from the phone — «المعلقة» lists the files awaiting the letter, «تكليف TR-00012» asks for
 * the delivery days, «نعم» issues it and the letter arrives as a PDF. Every action runs through the
 * same permissions and the same transaction as the web screens. The bot talks to Telegram by
 * long-polling (works behind any home or school router; no public address is needed).
 */

const API = () => process.env.TG_API_BASE || 'https://api.telegram.org';
const CODE_MINUTES = 10;

async function call(token: string, method: string, payload?: Record<string, unknown> | FormData, timeoutMs = 15000) {
  const res = await fetch(`${API()}/bot${token}/${method}`, {
    method: 'POST',
    ...(payload instanceof FormData
      ? { body: payload }
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {}) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `telegram ${method} ${res.status}`);
  return data.result;
}

const send = (token: string, chat: string, text: string) =>
  call(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });

/* ---------- administrator: the bot token ---------- */

export async function telegramStatus(s: Identity) {
  requireTenantAdmin(s);
  const t = await db.tenant.findUniqueOrThrow({
    where: { id: s.user.tenantId },
    select: { tgToken: true, tgOn: true, tgIssue: true, tgLimit: true, name: true },
  });
  const linked = await db.user.count({ where: { tenantId: s.user.tenantId, NOT: { tgChatId: '' } } });
  let bot = '';
  if (t.tgToken)
    bot = await call(unseal(t.tgToken), 'getMe', {}, 6000)
      .then((r) => String(r.username ?? ''))
      .catch(() => '');
  return { on: t.tgOn, hasToken: Boolean(t.tgToken), bot, linked, reachable: Boolean(bot), issue: t.tgIssue, limit: num(t.tgLimit) };
}

export async function saveTelegramConfig(s: Identity, t: Tx, body: any) {
  requireTenantAdmin(s);
  const p = parse(
    z
      .object({
        token: z.string().trim().max(200).default(''),
        on: z.boolean(),
        /** Issuing from the bot (off: the bot only lists and sends documents); limit per file, 0 = none. */
        issue: z.boolean().default(true),
        limit: z.number().min(0).max(100000000).default(0),
      })
      .strict(),
    body,
  );
  const current = await t.tenant.findUniqueOrThrow({ where: { id: s.user.tenantId }, select: { tgToken: true } });
  const token = p.token || unseal(current.tgToken);
  if (p.on && !token) fail('أدخل رمز البوت (token) من BotFather أولاً');
  let bot = '';
  if (p.token) {
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(p.token)) fail('رمز البوت غير صحيح؛ انسخه كما أرسله BotFather');
    bot = await call(p.token, 'getMe', {}, 8000)
      .then((r) => String(r.username ?? ''))
      .catch((e) => fail('تعذر الاتصال بتليجرام بهذا الرمز: ' + String(e?.message ?? e).slice(0, 120)));
  }
  await t.tenant.update({
    where: { id: s.user.tenantId },
    data: { ...(p.token ? { tgToken: seal(p.token) } : {}), tgOn: p.on, tgIssue: p.issue, tgLimit: p.limit },
  });
  bump();
  return { on: p.on, hasToken: Boolean(token), bot, issue: p.issue, limit: p.limit };
}

/* ---------- user: linking the phone ---------- */

export async function linkCode(s: Identity) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: s.user.tenantId }, select: { tgOn: true, tgToken: true } });
  if (!t.tgOn || !t.tgToken) fail('لم يفعّل مسؤول النظام بوت تليجرام بعد');
  const code = String(randomInt(100000, 999999));
  await db.user.update({ where: { id: s.user.id }, data: { tgCode: code, tgCodeExp: new Date(Date.now() + CODE_MINUTES * 60000) } });
  const bot = await call(unseal(t.tgToken), 'getMe', {}, 6000)
    .then((r) => String(r.username ?? ''))
    .catch(() => '');
  return { code, minutes: CODE_MINUTES, bot, link: bot ? `https://t.me/${bot}?start=${code}` : '' };
}

export async function unlinkTelegram(s: Identity) {
  await db.user.update({ where: { id: s.user.id }, data: { tgChatId: '', tgCode: '', tgCodeExp: null } });
  return { linked: false };
}

/* ---------- the conversation ---------- */

type Pending = { caseId: string; school: string; number: string; subject: string; supplier: string; total: string; days?: number };
const conversations = new Map<string, Pending>();

const HELP = [
  '<b>الأوامر المتاحة</b>',
  '• <b>المعلقة</b> — الملفات التي تنتظر كتاب التكليف',
  '• <b>تكليف TR-00012</b> — إصدار كتاب التكليف لهذا الملف (يسأل عن مدة التوريد ثم يطلب التأكيد)',
  '• <b>طباعة TR-00012</b> — إرسال كتاب التكليف الصادر PDF',
  '• <b>إلغاء</b> — إلغاء العملية الجارية',
  'كل إجراء هنا يُسجَّل باسمك كما لو تم من الشاشة.',
].join('\n');

const CASE_RE = /\b([A-Z]{2}-\d{3,6})\b/i;

async function findCase(s: Identity, number: string) {
  const ids = s.user.memberships.filter((m) => m.school.active && m.roles.some((r) => WORK.includes(r))).map((m) => m.schoolId);
  return db.case.findFirst({
    where: { number: number.toUpperCase(), schoolId: { in: ids } },
    include: { supplier: { select: { name: true } }, school: { select: { name: true } } },
  });
}

async function sendOrderPdf(token: string, chat: string, s: Identity, school: string, caseId: string, number: string) {
  const r = await read(s, school, ['cases', caseId, 'order-print'], {});
  const pdf = Buffer.from((await htmlToPdf(r.html)).base64, 'base64');
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('caption', `كتاب التكليف — ${number}`);
  form.append('document', new Blob([pdf as any], { type: 'application/pdf' }), `${number}.pdf`);
  await call(token, 'sendDocument', form, 60000);
}

async function pendingText(s: Identity) {
  const ids = s.user.memberships.filter((m) => m.school.active && m.roles.some((r) => WORK.includes(r))).map((m) => m.schoolId);
  const rows = await db.case.findMany({
    where: { schoolId: { in: ids }, state: 'APPROVED', year: { closed: false } },
    select: { number: true, subject: true, total: true, supplier: { select: { name: true } }, school: { select: { name: true } } },
    orderBy: [{ school: { name: 'asc' } }, { createdAt: 'asc' }],
    take: 40,
  });
  if (!rows.length) return 'لا توجد ملفات تنتظر كتاب التكليف الآن.';
  const lines: string[] = [];
  let school = '';
  for (const r of rows) {
    if (r.school.name !== school) lines.push(`<b>${(school = r.school.name)}</b>`);
    lines.push(`• ${r.number} — ${r.subject} (${r.supplier?.name ?? ''}) ${num(r.total)} ر.ق`);
  }
  return 'الملفات التي تنتظر كتاب التكليف:\n' + lines.join('\n') + '\n\nللإصدار أرسل: تكليف ورقم الملف، مثل «تكليف ' + rows[0].number + '»';
}

/** One incoming message from a linked or unlinked chat; replies are plain Arabic. */
export async function handleMessage(tenantId: string, token: string, chat: string, text: string) {
  const msg = text.trim();
  const user = await db.user.findFirst({ where: { tenantId, tgChatId: chat, active: true } });
  if (!user) {
    const code = (msg.match(/^\/start\s+(\d{6})$/) ?? msg.match(/^(?:ربط\s*)?(\d{6})$/))?.[1];
    if (!code)
      return send(token, chat, 'هذا البوت يخدم حسابات النظام فقط. من شاشة الإعدادات في النظام اضغط «ربط تليجرام» وأرسل الرمز هنا.');
    const owner = await db.user.findFirst({ where: { tenantId, tgCode: code, tgCodeExp: { gt: new Date() }, active: true } });
    if (!owner) return send(token, chat, 'الرمز غير صحيح أو انتهت صلاحيته؛ اطلب رمزاً جديداً من الإعدادات.');
    await db.user.updateMany({ where: { tenantId, tgChatId: chat }, data: { tgChatId: '' } });
    await db.user.update({ where: { id: owner.id }, data: { tgChatId: chat, tgCode: '', tgCodeExp: null } });
    return send(token, chat, `تم ربط هذا الهاتف بحساب <b>${owner.name}</b>.\n\n${HELP}`);
  }
  const s = await identityForUser(user.id);
  if (!s) return send(token, chat, 'الحساب غير جاهز (كلمة مرور مؤقتة أو موقوف). ادخل من المتصفح أولاً.');
  const key = `${tenantId}:${chat}`;
  const pending = conversations.get(key);
  if (/^(إلغاء|الغاء|\/cancel)$/.test(msg)) {
    conversations.delete(key);
    return send(token, chat, 'تم الإلغاء.');
  }
  if (/^(\/start|\/help|مساعدة|الأوامر)/.test(msg)) return send(token, chat, HELP);
  if (/^(المعلقة|المعلقه|\/pending)$/.test(msg)) return send(token, chat, await pendingText(s));

  const print = msg.match(/^(طباعة|طباعه|\/print)\s+(.+)$/);
  if (print) {
    const c = await findCase(s, print[2].match(CASE_RE)?.[1] ?? '');
    if (!c) return send(token, chat, 'لم أجد ملفاً بهذا الرقم في مدارسك.');
    if (!c.orderHtml) return send(token, chat, 'لم يصدر كتاب التكليف لهذا الملف بعد.');
    await send(token, chat, 'جارٍ إعداد الملف…');
    await sendOrderPdf(token, chat, s, c.schoolId, c.id, c.orderNumber ?? c.number);
    return;
  }

  const assign = msg.match(/^(تكليف|\/issue)\s+(.+)$/);
  if (assign) {
    const c = await findCase(s, assign[2].match(CASE_RE)?.[1] ?? '');
    if (!c) return send(token, chat, 'لم أجد ملفاً بهذا الرقم في مدارسك. أرسل «المعلقة» لعرض الملفات.');
    if (c.state !== 'APPROVED')
      return send(token, chat, `الملف ${c.number} في حالة لا تسمح بإصدار التكليف (يلزم اعتماد تقرير العروض أولاً).`);
    // The administrator's controls: issuing from the phone may be off, or allowed only up to a value per file.
    const ctl = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { tgIssue: true, tgLimit: true } });
    if (!ctl.tgIssue) return send(token, chat, 'إصدار كتب التكليف من الهاتف موقوف من مسؤول النظام؛ أصدره من شاشة النظام.');
    if (Number(ctl.tgLimit) > 0 && Number(c.total) > Number(ctl.tgLimit))
      return send(
        token,
        chat,
        `قيمة الملف ${num(c.total)} ر.ق أعلى من حد الإصدار من الهاتف (${num(ctl.tgLimit)} ر.ق)؛ أصدره من شاشة النظام.`,
      );
    conversations.set(key, {
      caseId: c.id,
      school: c.schoolId,
      number: c.number,
      subject: c.subject,
      supplier: c.supplier?.name ?? '',
      total: num(c.total),
    });
    return send(
      token,
      chat,
      `الملف <b>${c.number}</b> — ${c.subject}\nالمورد: ${c.supplier?.name ?? ''}\nالقيمة: ${num(c.total)} ر.ق\nالمدرسة: ${c.school.name}\n\nأرسل <b>مدة التوريد بالأيام</b> (رقم فقط).`,
    );
  }

  if (pending && pending.days === undefined) {
    const days = Number(msg.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
    if (!Number.isInteger(days) || days < 1 || days > 365) return send(token, chat, 'أرسل عدد أيام التوريد كرقم من 1 إلى 365، أو «إلغاء».');
    pending.days = days;
    return send(
      token,
      chat,
      `إصدار كتاب التكليف للملف <b>${pending.number}</b> بتاريخ اليوم ومدة توريد <b>${days}</b> يوم عمل؟\nأرسل <b>نعم</b> للتأكيد أو «إلغاء».`,
    );
  }
  if (pending && pending.days !== undefined) {
    if (!/^(نعم|تأكيد|اصدار|إصدار|yes)$/i.test(msg)) return send(token, chat, 'أرسل «نعم» للتأكيد أو «إلغاء».');
    conversations.delete(key);
    try {
      const r = await mutate(
        s,
        pending.school,
        ['cases', pending.caseId, 'issue'],
        { trigger: today(), days: pending.days, policyConfirmed: true },
        randomUUID(),
        'POST',
      );
      await send(
        token,
        chat,
        `✅ صدر كتاب التكليف رقم <b>${r.orderNumber}</b> للملف ${pending.number}. تاريخ الاستحقاق: ${String(r.dueDate).slice(0, 10)}.`,
      );
      await sendOrderPdf(token, chat, s, pending.school, pending.caseId, r.orderNumber);
    } catch (e: any) {
      const m = e?.response?.message ?? e?.message ?? 'تعذر الإصدار';
      await send(token, chat, '⚠️ لم يتم الإصدار: ' + String(Array.isArray(m) ? m.join('، ') : m));
    }
    return;
  }
  return send(token, chat, 'لم أفهم الطلب.\n\n' + HELP);
}

/* ---------- polling ---------- */

/** Wakes the polling loop at once after the administrator changes the configuration. */
let wake: () => void = () => {};
const bump = () => wake();

async function pollTenant(tenantId: string, token: string, state: { offset: number }) {
  const updates: any[] = await call(token, 'getUpdates', { offset: state.offset, timeout: 20, allowed_updates: ['message'] }, 30000);
  for (const u of updates) {
    state.offset = u.update_id + 1;
    const m = u.message;
    if (!m?.text || !m.chat?.id || m.chat.type !== 'private') continue;
    await handleMessage(tenantId, token, String(m.chat.id), String(m.text)).catch((e) =>
      send(token, String(m.chat.id), '⚠️ حدث خطأ: ' + String(e?.message ?? e).slice(0, 200)).catch(() => {}),
    );
  }
}

/** Starts the polling loops; returns the function that stops them. */
export function startTelegram() {
  let running = true;
  const states = new Map<string, { offset: number }>();
  const loop = async () => {
    while (running) {
      let wait = 3000;
      try {
        const tenants = await db.tenant.findMany({ where: { tgOn: true, NOT: { tgToken: '' } }, select: { id: true, tgToken: true } });
        if (!tenants.length) wait = 15000;
        for (const t of tenants) {
          if (!running) break;
          const st = states.get(t.id) ?? { offset: 0 };
          states.set(t.id, st);
          await pollTenant(t.id, unseal(t.tgToken), st).catch((e) => {
            console.error('telegram_poll_failed', String(e?.message ?? e).slice(0, 200));
            wait = 20000;
          });
        }
      } catch (e: any) {
        console.error('telegram_loop_failed', String(e?.message ?? e).slice(0, 200));
        wait = 20000;
      }
      if (running)
        await new Promise<void>((r) => {
          const t = setTimeout(r, wait);
          t.unref();
          wake = () => (clearTimeout(t), r());
        });
    }
  };
  if (process.env.TELEGRAM_POLLING !== 'off') loop();
  return () => {
    running = false;
  };
}

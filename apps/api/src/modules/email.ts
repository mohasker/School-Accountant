import nodemailer from 'nodemailer';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { fail, parse } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { seal, unseal } from '../core/secrets';
import { audit } from '../core/transaction';
import { pendingBySchool } from './welcome';

/**
 * Weekly e-mail reminder: each account with an e-mail address receives, on the chosen day, the
 * pending files of its schools with the next step of each (only when something is pending). The
 * administrator enters the mail server (SMTP) once; the password is kept encrypted.
 */
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const web = () => (process.env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');

export async function emailStatus(s: Identity) {
  requireTenantAdmin(s);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: s.user.tenantId } });
  const users = await db.user.findMany({ where: { tenantId: t.id, active: true }, select: { email: true } });
  return {
    host: t.smtpHost,
    port: t.smtpPort,
    user: t.smtpUser,
    from: t.smtpFrom,
    hasPass: Boolean(t.smtpPass),
    digestOn: t.digestOn,
    digestDay: t.digestDay,
    digestHour: t.digestHour,
    lastDigest: t.lastDigest,
    withEmail: users.filter((u) => u.email).length,
    accounts: users.length,
    days: DAYS,
  };
}

export async function saveEmailConfig(s: Identity, t: Tx, body: any) {
  requireTenantAdmin(s);
  const p = parse(
    z
      .object({
        host: z.string().trim().max(200),
        port: z.number().int().min(1).max(65535),
        user: z.string().trim().max(200),
        pass: z.string().max(300).default(''),
        from: z.string().trim().max(200),
        digestOn: z.boolean(),
        digestDay: z.number().int().min(0).max(6),
        digestHour: z.number().int().min(0).max(23),
      })
      .strict(),
    body,
  );
  if (p.digestOn && (!p.host || !p.from)) fail('أدخل خادم البريد وعنوان المرسل قبل تفعيل التذكير');
  await t.tenant.update({
    where: { id: s.user.tenantId },
    data: {
      smtpHost: p.host,
      smtpPort: p.port,
      smtpUser: p.user,
      smtpFrom: p.from,
      digestOn: p.digestOn,
      digestDay: p.digestDay,
      digestHour: p.digestHour,
      ...(p.pass ? { smtpPass: seal(p.pass) } : {}),
    },
  });
  await audit(t, s, s.user.tenantId, 'EMAIL_CONFIG', s.user.tenantId, { host: p.host, digestOn: p.digestOn });
  return { saved: true };
}

function transport(t: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string }) {
  // Tests use a transport that only builds the message.
  if (process.env.EMAIL_TRANSPORT === 'json') return nodemailer.createTransport({ jsonTransport: true });
  if (!t.smtpHost) fail('لم يُضبط خادم البريد (SMTP)');
  return nodemailer.createTransport({
    host: t.smtpHost,
    port: t.smtpPort,
    secure: t.smtpPort === 465,
    auth: t.smtpUser ? { user: t.smtpUser, pass: unseal(t.smtpPass) } : undefined,
    connectionTimeout: 15000,
  });
}

/** The reminder of one account: its schools' pending files. */
async function digestOf(user: { id: string; name: string; isTenantAdmin: boolean; tenantId: string }) {
  const schools = user.isTenantAdmin
    ? await db.school.findMany({ where: { tenantId: user.tenantId, active: true }, select: { id: true, name: true } })
    : (await db.membership.findMany({ where: { userId: user.id, school: { active: true } }, include: { school: true } })).map(
        (m) => m.school,
      );
  const rows = (await pendingBySchool(user.tenantId, schools)).filter((r) => r.attention > 0);
  const pending = rows.reduce((n, r) => n + r.pending, 0);
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.8;color:#1b2b36">
<h2 style="color:#861b3a;margin:0 0 8px">السلام عليكم ${escape(user.name)}</h2>
<p>هذا تذكير أسبوعي من نظام MOESAS بالمعاملات المعلقة في مدارسك.</p>
${
  rows.length
    ? rows
        .map(
          (
            r,
          ) => `<h3 style="margin:16px 0 4px">${escape(r.name)} — ${r.pending} معاملة غير مكتملة${r.late ? ` (${r.late} متأخرة)` : ''}</h3>
<ul>${r.items.map((c) => `<li><b>${escape(c.number)}</b> ${escape(c.subject)} — الخطوة التالية: <b>${escape(c.next)}</b>${c.late ? ' <span style="color:#b42318">(تجاوز موعد التنفيذ)</span>' : ''}</li>`).join('')}
${r.replenish.map((a) => `<li>${escape(a.name)}: بلغت حد الاستعاضة</li>`).join('')}
${r.awaiting.map((a) => `<li>${escape(a.name)}: استعاضة لم يُؤكد استلامها</li>`).join('')}
${r.erp ? `<li>${r.erp} معاملة منجزة لم تُسجل في ERP</li>` : ''}</ul>`,
        )
        .join('')
    : '<p>✓ لا توجد معاملات معلقة. أسبوعاً موفقاً.</p>'
}
<p><a href="${web()}" style="color:#861b3a">فتح النظام</a></p>
<p style="color:#6b7b86;font-size:12px">رسالة آلية؛ يمكن إيقافها من مسؤول النظام.</p></div>`;
  return { html, pending: pending + rows.reduce((n, r) => n + r.replenish.length + r.awaiting.length + r.erp, 0) };
}

async function sendDigest(tenantId: string, only?: string, always = false) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const mail = transport(t);
  const users = await db.user.findMany({ where: { tenantId, active: true, email: { not: '' }, ...(only ? { id: only } : {}) } });
  let sent = 0;
  const messages: any[] = [];
  const failed: string[] = [];
  // One bad address must not stop the others: each recipient is tried on its own.
  for (const u of users) {
    try {
      const d = await digestOf(u);
      if (!d.pending && !always) continue;
      const info = await mail.sendMail({
        from: t.smtpFrom || t.smtpUser,
        to: u.email,
        subject: 'تذكير MOESAS: المعاملات المعلقة',
        html: d.html,
      });
      messages.push((info as any).message ?? null);
      sent++;
    } catch (e: any) {
      failed.push(u.username);
      console.error('digest_send_failed', u.username, e?.message);
      // A test send reports the real problem to the administrator.
      if (only) fail(`تعذر الإرسال: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  return { sent, recipients: users.length, failed, messages: process.env.EMAIL_TRANSPORT === 'json' ? messages : undefined };
}

/** «إرسال تجربة» to the administrator's own address, or «إرسال الآن» to every account. */
export async function sendNow(s: Identity, body: any) {
  requireTenantAdmin(s);
  const p = parse(z.object({ test: z.boolean().default(true) }).strict(), body ?? {});
  if (p.test) {
    const me = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
    if (!me.email) fail('أضف بريدك الإلكتروني من «الإعدادات» أولاً');
    return sendDigest(s.user.tenantId, me.id, true);
  }
  return sendDigest(s.user.tenantId);
}

/** Each account keeps its own address (the administrator may change any). */
export async function setEmail(t: Tx, userId: string, email: string) {
  const v = parse(z.union([z.literal(''), z.string().trim().email('البريد الإلكتروني غير صحيح').max(200)]), email);
  await t.user.update({ where: { id: userId }, data: { email: v } });
  return { email: v };
}

/** Qatar-time week key and hour, so the reminder goes out once a week on the chosen day and hour. */
function qatarNow() {
  const d = new Date(Date.now() + 3 * 3600000);
  const day = d.getUTCDay(),
    hour = d.getUTCHours();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return { day, hour, week: start.toISOString().slice(0, 10) };
}

let running = false;
/** Checked every few minutes by the API process. */
export async function digestTick() {
  if (running) return;
  running = true;
  try {
    const now = qatarNow();
    for (const t of await db.tenant.findMany({ where: { digestOn: true, smtpHost: { not: '' } } })) {
      if (t.lastDigest === now.week || now.day !== t.digestDay || now.hour < t.digestHour) continue;
      try {
        const r = await sendDigest(t.id);
        // The week is marked done once the run completed; a run that reached nobody is retried on the next tick.
        if (r.sent || !r.failed.length) await db.tenant.update({ where: { id: t.id }, data: { lastDigest: now.week } });
      } catch (e: any) {
        console.error('digest_failed', e?.message);
      }
    }
  } finally {
    running = false;
  }
}

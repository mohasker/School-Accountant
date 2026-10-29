'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

/** Administrator: the mail server and the weekly reminder of pending files. */
export function EmailPanel() {
  const w = useWorkspace();
  const [st] = useLoad<Row>(() => w.api('admin/email'));
  if (!st) return null;
  const hours = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));
  const config: Dialog = {
    title: 'إعدادات البريد والتذكير الأسبوعي',
    intro: (
      <p>
        بيانات خادم البريد (SMTP) من مزود بريدك. مثال Outlook/Hotmail: الخادم smtp-mail.outlook.com والمنفذ 587. ومثال Gmail: smtp.gmail.com
        والمنفذ 587 مع «كلمة مرور التطبيقات». تُحفظ كلمة المرور مشفرة.
      </p>
    ),
    fields: [
      { name: 'host', label: 'خادم البريد (SMTP)', value: st.host, required: false },
      { name: 'port', label: 'المنفذ', type: 'number', step: '1', value: st.port },
      { name: 'user', label: 'اسم المستخدم (البريد)', value: st.user, required: false },
      { name: 'pass', label: st.hasPass ? 'كلمة المرور (فارغ = بدون تغيير)' : 'كلمة المرور', type: 'password', required: false },
      { name: 'from', label: 'عنوان المرسل', value: st.from, required: false },
      {
        name: 'digestDay',
        label: 'يوم الإرسال',
        type: 'select',
        value: String(st.digestDay),
        options: st.days.map((d: string, i: number) => ({ value: String(i), label: d })),
      },
      { name: 'digestHour', label: 'الساعة (بتوقيت قطر)', type: 'select', value: String(st.digestHour), options: hours },
      { name: 'digestOn', label: 'تفعيل التذكير الأسبوعي', type: 'checkbox', value: st.digestOn, required: false },
    ],
    save: (v) =>
      w.api('admin/email/config', 'POST', {
        host: v.host,
        port: Number(v.port) || 587,
        user: v.user,
        pass: v.pass,
        from: v.from,
        digestOn: v.digestOn,
        digestDay: Number(v.digestDay),
        digestHour: Number(v.digestHour),
      }),
  };
  return (
    <Panel
      title="التذكير الأسبوعي بالبريد الإلكتروني"
      actions={
        <button className="secondary" onClick={() => w.open(config)}>
          الإعدادات
        </button>
      }
    >
      <p>
        الحالة:{' '}
        <b>{st.digestOn ? `مفعّل — كل ${st.days[st.digestDay]} الساعة ${String(st.digestHour).padStart(2, '0')}:00` : 'غير مفعّل'}</b> ·
        حسابات لها بريد: {st.withEmail} من {st.accounts}
        {st.lastDigest ? ` · آخر إرسال أسبوع ${st.lastDigest}` : ''}
      </p>
      <p>
        <small>
          تصل كل محاسب رسالة بالمعاملات المعلقة في مدارسه والخطوة التالية لكل منها (فقط إذا وُجد ما يحتاج متابعة). يضيف كل محاسب بريده من
          «الإعدادات»، أو تضيفه أنت من «البيانات» في لوحة مدير النظام.
        </small>
      </p>
      <div className="actions">
        <button
          className="secondary"
          disabled={w.busy || !st.host}
          onClick={() => w.task(() => w.api('email/send', 'POST', { test: true }), 'أُرسلت رسالة تجربة إلى بريدك')}
        >
          إرسال رسالة تجربة لي
        </button>
        <button
          className="secondary"
          disabled={w.busy || !st.host}
          onClick={() =>
            confirm('إرسال التذكير الآن لكل الحسابات التي لها بريد ومعاملات معلقة؟') &&
            w.task(async () => {
              const r = await w.api('email/send', 'POST', { test: false });
              if (!r.sent) throw Error('لا توجد رسائل للإرسال (لا بريد أو لا معلقات)');
            }, 'أُرسل التذكير')
          }
        >
          إرسال التذكير الآن
        </button>
      </div>
    </Panel>
  );
}

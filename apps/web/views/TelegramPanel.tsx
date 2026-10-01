'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

/** Administrator: the bot token from BotFather and the on/off switch. */
export function TelegramAdminPanel() {
  const w = useWorkspace();
  const [st] = useLoad<Row>(() => w.api('admin/telegram'));
  const [steps, setSteps] = useState(false);
  if (!st) return null;
  return (
    <Panel
      title="بوت تليجرام — إصدار التكليفات من الهاتف"
      actions={
        <button
          className="secondary"
          onClick={() =>
            w.open({
              title: 'إعداد بوت تليجرام',
              intro: <p>الرمز (token) من BotFather. يُحفظ مشفراً على الخادم. يتحقق النظام من الرمز عند الحفظ.</p>,
              fields: [
                {
                  name: 'token',
                  label: st.hasToken ? 'رمز البوت (اتركه فارغاً للإبقاء على المحفوظ)' : 'رمز البوت token',
                  type: 'password',
                  required: !st.hasToken,
                },
                { name: 'on', label: 'تشغيل البوت', type: 'checkbox', value: st.on },
              ],
              save: (v) => w.api('admin/telegram/config', 'POST', { token: v.token || '', on: Boolean(v.on) }),
            })
          }
        >
          الإعدادات
        </button>
      }
    >
      <p>
        الحالة:{' '}
        <b>
          {st.on ? (st.reachable ? `يعمل — @${st.bot}` : 'مفعّل لكن تعذر الوصول إلى تليجرام الآن') : st.hasToken ? 'متوقف' : 'غير مهيّأ'}
        </b>
        {' — '}حسابات مرتبطة: <b>{st.linked}</b>
      </p>
      <p>
        <small>
          يرسل المحاسب للبوت «المعلقة» ثم «تكليف TR-00012» ثم مدة التوريد ثم «نعم»، فيصدر كتاب التكليف ويصله PDF. كل إجراء يُسجَّل باسم صاحب
          الحساب. واتساب غير متاح لأنه يتطلب حساب WhatsApp Business API مدفوعاً ومعتمداً من Meta؛ تليجرام مجاني ويعمل خلف أي راوتر.
        </small>
      </p>
      <button className="link" onClick={() => setSteps((s) => !s)}>
        {steps ? 'إخفاء' : 'عرض'} خطوات إنشاء البوت
      </button>
      {steps && (
        <ol>
          <li>في تليجرام ابحث عن @BotFather وأرسل /newbot، ثم اختر اسماً ومعرّفاً ينتهي بـ bot.</li>
          <li>انسخ الرمز (token) الذي يرسله BotFather وأدخله في «الإعدادات» أعلاه وفعّل التشغيل.</li>
          <li>يذهب كل محاسب إلى «الإعدادات ← ربط تليجرام» ليحصل على رمز من 6 أرقام ويرسله للبوت مرة واحدة.</li>
          <li>الخادم هو الذي يتصل بتليجرام (long polling)؛ لا يلزم عنوان عام ولا فتح منافذ.</li>
        </ol>
      )}
    </Panel>
  );
}

/** Each user: link their phone with a short code. */
export function TelegramLinkPanel() {
  const w = useWorkspace();
  const [code, setCode] = useState<Row | null>(null);
  const linked = Boolean(w.me.user.tgLinked);
  return (
    <Panel title="ربط تليجرام (إصدار التكليفات من الهاتف)">
      <p>
        الحالة: <b>{linked ? 'مرتبط بهاتفك' : 'غير مرتبط'}</b>
      </p>
      {!code ? (
        <div className="toolbar wrap">
          <button
            className="secondary"
            onClick={async () => {
              try {
                setCode(await w.api('auth/telegram-code', 'POST', {}));
              } catch (e) {
                w.fail(e);
              }
            }}
          >
            {linked ? 'إعادة الربط' : 'ربط تليجرام'}
          </button>
          {linked && (
            <button
              className="secondary danger"
              onClick={() =>
                w.task(async () => {
                  await w.api('auth/telegram-unlink', 'POST', {});
                  location.reload();
                }, 'تم فصل تليجرام')
              }
            >
              فصل
            </button>
          )}
        </div>
      ) : (
        <div className="notice">
          <p>
            أرسل هذا الرمز إلى البوت {code.bot ? <b>@{code.bot}</b> : ''} خلال {code.minutes} دقائق:{' '}
            <b className="mono" style={{ fontSize: '1.4em' }}>
              {code.code}
            </b>
          </p>
          {code.link && (
            <p>
              أو افتح الرابط من هاتفك:{' '}
              <a href={code.link} target="_blank" rel="noreferrer">
                {code.link}
              </a>{' '}
              ثم اضغط Start.
            </p>
          )}
          <p>
            <small>بعد الربط أرسل «المعلقة» لعرض الملفات التي تنتظر كتاب التكليف.</small>
          </p>
        </div>
      )}
    </Panel>
  );
}

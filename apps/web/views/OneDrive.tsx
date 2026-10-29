'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

const AUTHORITIES = [
  { value: 'common', label: 'أي حساب (شخصي أو عمل/مدرسة) — الأنسب لحساب Hotmail/Outlook' },
  { value: 'consumers', label: 'حسابات مايكروسوفت الشخصية فقط' },
  { value: 'organizations', label: 'حسابات العمل والمدرسة فقط' },
];

/** Administrator panel: keep the shared archive on an online OneDrive account instead of the database. */
export function OneDrivePanel() {
  const w = useWorkspace();
  const [st] = useLoad<Row>(() => w.api('admin/onedrive'));
  const [steps, setSteps] = useState(false);
  const [result, setResult] = useState<Row | null>(null);
  if (!st) return null;

  const configDialog: Dialog = {
    title: 'إعدادات ربط OneDrive',
    intro: <p>القيم من تسجيل التطبيق في Azure (الخطوات أسفل اللوحة). يُحفظ السر مشفراً على الخادم ولا يظهر بعد ذلك.</p>,
    fields: [
      { name: 'clientId', label: 'Application (client) ID', value: st.clientId },
      {
        name: 'secret',
        label: st.hasSecret ? 'Client secret (اتركه فارغاً للإبقاء على المحفوظ)' : 'Client secret (قيمة السر Value)',
        type: 'password',
        required: !st.hasSecret,
      },
      { name: 'authority', label: 'نوع الحساب', type: 'select', value: st.authority, options: AUTHORITIES },
      { name: 'folder', label: 'اسم المجلد في OneDrive', value: st.folder },
    ],
    save: async (v) => {
      await w.api('admin/onedrive/config', 'POST', {
        clientId: v.clientId,
        secret: v.secret || '',
        authority: v.authority,
        folder: v.folder,
      });
    },
  };

  const connect = async () => {
    try {
      const r = await w.api('admin/onedrive/connect');
      window.location.href = r.url;
    } catch (e) {
      w.fail(e);
    }
  };

  const migrate = () =>
    w.task(async () => {
      const r = await w.api('admin/archive/migrate', 'POST', {});
      setResult(r);
    }, 'اكتملت محاولة النقل');

  return (
    <Panel
      title="تخزين الأرشيف على OneDrive"
      actions={
        <button className="secondary" onClick={() => w.open(configDialog)}>
          الإعدادات
        </button>
      }
    >
      <p>
        الحالة:{' '}
        <b>
          {st.connected
            ? `مرتبط بحساب ${st.account || ''}`
            : st.configured
              ? 'مهيّأ — لم يُربط الحساب بعد'
              : 'غير مهيّأ (يُحفظ الأرشيف في قاعدة البيانات)'}
        </b>
        {st.connected && <> — المجلد: {st.folder}</>}
      </p>
      <div className="toolbar wrap">
        {st.configured && (
          <button onClick={connect} disabled={w.busy}>
            {st.connected ? 'إعادة ربط الحساب' : 'ربط الحساب'}
          </button>
        )}
        {st.connected && st.inDatabase > 0 && (
          <button className="secondary" onClick={migrate} disabled={w.busy}>
            نقل المستندات الحالية ({st.inDatabase}) إلى OneDrive
          </button>
        )}
        {st.connected && (
          <button
            className="secondary danger"
            onClick={() =>
              w.open({
                title: 'فصل حساب OneDrive',
                intro: (
                  <p>
                    تبقى الملفات المرفوعة في OneDrive ويمكنك فتحها من هناك، لكن لن يستطيع النظام تحميلها حتى تعيد الربط. الملفات الجديدة
                    تُحفظ في قاعدة البيانات.
                  </p>
                ),
                fields: [],
                submit: 'فصل',
                save: () => w.api('admin/onedrive/disconnect', 'POST', {}),
              })
            }
          >
            فصل
          </button>
        )}
      </div>
      {result && (
        <div className={result.error ? 'warn' : 'notice'}>
          نُقل {result.moved} مستند، والمتبقي {result.remaining}.{result.error ? ` توقف النقل: ${result.error}` : ''}
        </div>
      )}
      <p>
        <small>
          رابط إعادة التوجيه الواجب تسجيله في Azure: <span className="mono">{st.redirectUri}</span>
        </small>
      </p>
      <button className="link" onClick={() => setSteps((s) => !s)}>
        {steps ? 'إخفاء' : 'عرض'} خطوات التسجيل في Azure
      </button>
      {steps && (
        <ol>
          <li>ادخل portal.azure.com بحساب مايكروسوفت نفسه ← App registrations ← New registration.</li>
          <li>Supported account types: «Accounts in any organizational directory and personal Microsoft accounts».</li>
          <li>
            Redirect URI من نوع Web وبالقيمة: <span className="mono">{st.redirectUri}</span>
          </li>
          <li>API permissions ← Microsoft Graph ← Delegated: Files.ReadWrite و offline_access و User.Read.</li>
          <li>Certificates &amp; secrets ← New client secret، وانسخ عمود Value فوراً (لا يظهر ثانية) وانتبه لتاريخ انتهائه.</li>
          <li>انسخ Application (client) ID من صفحة Overview، ثم اضغط «الإعدادات» أعلاه وأدخل القيم، ثم «ربط الحساب».</li>
        </ol>
      )}
      <p>
        <small>ننصح بحساب OneDrive مخصص للأرشيف؛ فالتصريح الممنوح يشمل ملفات الحساب كلها.</small>
      </p>
    </Panel>
  );
}

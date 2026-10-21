'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';

const KINDS: Record<string, string> = {
  daily: 'يومية (تلقائية)',
  manual: 'يدوية',
  purge: 'قبل المسح',
  restore: 'البيانات قبل الاستعادة',
};

const when = (v: string) => new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', dateStyle: 'short', timeStyle: 'short' });
const sizeText = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);

/** Waits for the service to come back after a restore, then opens the sign-in page. */
async function waitForRestart() {
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      if (r.ok) return location.reload();
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  location.reload();
}

/** Backups of the local installation: list, copy now, restore, and a second folder for every copy. */
export function Backups() {
  const w = useWorkspace();
  const [d, reload] = useLoad<Row>(() => w.api('admin/backups'));
  if (!d) return null;
  if (!d.local)
    return (
      <Panel title="النسخ الاحتياطية">
        <p>
          على الخادم تُؤخذ نسخة من قاعدة البيانات كل ليلة في <span className="mono">/var/backups/madar</span> (آخر 30 يوماً) وقبل كل تحديث،
          وتُجرَّب الاستعادة شهرياً بـ <span className="mono">deploy/restore-test.sh</span>. التفاصيل في دليل الخادم المشترك.
        </p>
      </Panel>
    );

  const restore = (b: Row): Dialog => ({
    title: 'استعادة نسخة احتياطية',
    intro: (
      <>
        <p>
          ترجع كل البيانات إلى نسخة <b>{when(b.at)}</b> ({KINDS[b.kind]}). ما تم بعدها لا يظهر في النظام، لكنه لا يُحذف: البيانات الحالية
          تُحفظ أولاً كنسخة «البيانات قبل الاستعادة» ويمكن الرجوع إليها بنفس الطريقة.
        </p>
        <p className="warn">يتوقف النظام لحظات لكل المستخدمين ثم يعود، ويلزم تسجيل الدخول من جديد.</p>
      </>
    ),
    fields: [{ name: 'confirm', label: 'اكتب كلمة «استعادة» للتأكيد' }],
    submit: 'استعادة',
    save: async (v) => {
      await w.api('admin/backups/restore', 'POST', { name: b.name, confirm: v.confirm });
      document.body.classList.add('restoring');
      waitForRestart();
    },
  });

  const external: Dialog = {
    title: 'مجلد نسخة ثانية',
    intro: (
      <p>
        كل نسخة (اليومية واليدوية وقبل المسح) تُنسخ أيضاً إلى هذا المجلد داخل «MOESAS-backups». اختر فلاشة أو قرصاً آخر، أو مجلد OneDrive
        على الجهاز ليُرفع تلقائياً. اتركه فارغاً لإيقاف النسخة الثانية.
      </p>
    ),
    fields: [{ name: 'dir', label: 'مسار المجلد كاملاً (مثل D:\\Backups)', value: d.externalDir, required: false }],
    save: (v) => w.api('admin/backups/external', 'POST', { dir: String(v.dir ?? '') }),
  };

  return (
    <Panel
      title="النسخ الاحتياطية"
      actions={
        <>
          <button
            disabled={d.busy}
            onClick={() =>
              w.task(async () => {
                const r = await w.api('admin/backups/now', 'POST', {});
                reload();
                if (r.external?.startsWith('تعذّر')) throw Error(r.external);
              }, 'أُخذت نسخة احتياطية الآن')
            }
          >
            نسخة الآن
          </button>
          <button className="secondary" onClick={() => w.open(external)}>
            مجلد نسخة ثانية
          </button>
        </>
      }
    >
      <p>
        نسخة تلقائية كل يوم عند التشغيل (آخر 14 يوماً)، ونسخة تلقائية قبل أي مسح من لوحة مدير النظام. البيانات في{' '}
        <bdi dir="ltr" className="mono">
          {d.dataDir}
        </bdi>{' '}
        والنسخ في{' '}
        <bdi dir="ltr" className="mono">
          {d.backupDir}
        </bdi>
        .
      </p>
      <p>
        النسخة الثانية:{' '}
        {d.externalDir ? (
          <bdi dir="ltr" className="mono">
            {d.externalDir}
          </bdi>
        ) : (
          <b className="warn">غير محددة — يُنصح بفلاشة أو مجلد OneDrive</b>
        )}
      </p>
      {d.backups.length ? (
        <Table heads={['التاريخ والوقت', 'النوع', 'الحجم', '']}>
          {d.backups.map((b: Row) => (
            <tr key={b.name}>
              <td>{when(b.at)}</td>
              <td>{KINDS[b.kind] ?? b.kind}</td>
              <td>{sizeText(b.bytes)}</td>
              <td>
                <button className="link" disabled={d.busy} onClick={() => w.open(restore(b))}>
                  استعادة هذه النسخة
                </button>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text="لا توجد نسخ بعد؛ اضغط «نسخة الآن»" />
      )}
    </Panel>
  );
}

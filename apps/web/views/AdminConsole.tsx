'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Badge, DocButtons, Empty, Panel, Stat, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, day, downloadFile, ROLE_NAMES } from '../lib/format';

const when = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', dateStyle: 'short', timeStyle: 'short' }) : '—';

/** System administrator console: every account and school, with a full work report per account. */
export function AdminConsole() {
  const w = useWorkspace();
  const [data] = useLoad<Row>(() => w.api('admin/overview'));
  const [selected, setSelected] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  if (!w.me.user.isTenantAdmin) return <Empty text="هذه الشاشة لمسؤول النظام فقط" />;
  if (!data) return <p>جارٍ التحميل…</p>;
  if (selected) return <AccountReport account={selected} onBack={() => setSelected(null)} />;
  const t = data.totals;
  const accounts: Row[] = data.accounts.filter(
    (a: Row) => !filter || a.name.includes(filter) || a.username.includes(filter) || a.schools.some((s: Row) => s.name.includes(filter)),
  );

  const passwordDialog = (a: Row): Dialog => ({
    title: 'إعادة تعيين كلمة مرور: ' + a.name,
    intro: <p>تُلغى جميع جلسات المستخدم الحالية. سلّم كلمة المرور الجديدة للمستخدم بطريقة آمنة.</p>,
    fields: [{ name: 'password', label: 'كلمة المرور الجديدة — 12 حرفاً على الأقل', type: 'password' }],
    save: (v) => w.api(`admin/users/${a.id}/password`, 'POST', v),
  });
  const profileDialog = (a: Row): Dialog => ({
    title: 'بيانات الحساب: ' + a.username,
    fields: [
      { name: 'name', label: 'الاسم الظاهر في المستندات', value: a.name },
      { name: 'isTenantAdmin', label: 'مسؤول نظام (صلاحيات كاملة)', type: 'checkbox', value: a.isTenantAdmin, required: false },
    ],
    save: (v) => w.api(`admin/users/${a.id}`, 'POST', v),
  });
  const rolesDialog = (a: Row): Dialog => ({
    title: 'صلاحيات ' + a.name + ' في المدارس',
    intro: <p>اختر المدرسة ثم الصلاحيات. إلغاء كل الصلاحيات يزيل الحساب من المدرسة مع بقاء سجله.</p>,
    fields: [
      { name: 'schoolId', label: 'المدرسة', type: 'select', options: data.schools.map((s: Row) => ({ value: s.id, label: s.name })) },
    ],
    body: (
      <div className="check-grid">
        {Object.entries(ROLE_NAMES).map(([value, label]) => (
          <label key={value} className="check">
            <input type="checkbox" name={'role_' + value} />
            {String(label)}
          </label>
        ))}
      </div>
    ),
    save: (v, fd) =>
      w.api('admin/memberships', 'POST', {
        username: a.username,
        schoolId: v.schoolId,
        roles: Object.keys(ROLE_NAMES).filter((r) => fd.get('role_' + r) === 'on'),
      }),
  });

  return (
    <>
      <div className="cards">
        <Stat label="المدارس" value={t.schools} />
        <Stat label="الحسابات (الفعالة)" value={`${t.users} (${t.activeUsers})`} />
        <Stat label="معاملات منجزة" value={t.casesDone} />
        <Stat label="معاملات قيد الإعداد" value={t.casesOpen} />
      </div>
      <Panel
        title="كل الحسابات"
        actions={
          <input className="search" placeholder="بحث بالاسم أو المدرسة" value={filter} onChange={(e) => setFilter(e.target.value)} />
        }
      >
        <p>
          الأعمال المنجزة: المعاملات المكتملة أو المسجلة في ERP. قيد الإعداد: من المسودة حتى صدور الشهادة. مدير النظام يرى كل المدارس
          ويديرها، أما صلاحيات الإعداد والاعتماد المالي فتبقى حسب إسناد كل مدرسة.
        </p>
        <Table
          heads={['الحساب', 'المدارس والصلاحيات', 'منجزة', 'قيد الإعداد', 'اعتمادات / شهادات', 'فواتير العهد', 'آخر دخول', 'الحالة', '']}
        >
          {accounts.map((a) => (
            <tr key={a.id} className={a.active ? '' : 'inactive'}>
              <td>
                <b>{a.name}</b>
                <small className="mono">
                  {a.username}
                  {a.isTenantAdmin ? ' · مسؤول النظام' : ''}
                </small>
              </td>
              <td>
                {a.schools.length ? (
                  a.schools.map((s: Row) => (
                    <small key={s.schoolId}>
                      {s.name}: {s.roles.map((r: string) => ROLE_NAMES[r] || r).join('، ')}
                    </small>
                  ))
                ) : (
                  <small>—</small>
                )}
              </td>
              <td>
                <b>{a.cases.done}</b>
                <small>{currency(a.cases.doneValue)} ر.ق</small>
              </td>
              <td>
                <b>{a.cases.open}</b>
                <small>{currency(a.cases.openValue)} ر.ق</small>
              </td>
              <td>
                {a.approvals} / {a.certificates}
              </td>
              <td>
                {a.pettyInvoices}
                <small>{currency(a.pettyAmount)} ر.ق</small>
              </td>
              <td>
                <small>{when(a.lastLoginAt)}</small>
              </td>
              <td>{a.active ? <span className="badge s-REGISTERED">فعال</span> : <span className="badge s-CANCELLED">موقوف</span>}</td>
              <td>
                <div className="actions">
                  <button className="link" onClick={() => setSelected(a)}>
                    تقرير الأعمال
                  </button>
                  <button className="link" onClick={() => w.open(rolesDialog(a))}>
                    الصلاحيات
                  </button>
                  <button className="link" onClick={() => w.open(profileDialog(a))}>
                    البيانات
                  </button>
                  <button className="link" onClick={() => w.open(passwordDialog(a))}>
                    كلمة المرور
                  </button>
                  {a.id !== w.me.user.id && (
                    <button
                      className={'link' + (a.active ? ' danger' : '')}
                      onClick={() =>
                        confirm(a.active ? `إيقاف حساب ${a.name}؟ تُلغى جلساته الحالية.` : `تفعيل حساب ${a.name}؟`) &&
                        w.task(() => w.api(`admin/users/${a.id}/status`, 'POST', { active: !a.active }))
                      }
                    >
                      {a.active ? 'إيقاف' : 'تفعيل'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="المدارس">
        <Table
          heads={['المدرسة', 'المدير', 'الحسابات', 'منجزة', 'قيد الإعداد', 'الشهادات', 'الموازنة (معتمد / مرتبط / مصروف)', 'عهد مفتوحة']}
        >
          {data.schools.map((s: Row) => (
            <tr key={s.id}>
              <td>
                <b>{s.name}</b>
                <small className="mono">{s.code}</small>
              </td>
              <td>{s.principal}</td>
              <td>{s.users}</td>
              <td>{s.casesDone}</td>
              <td>{s.casesOpen}</td>
              <td>{s.certificates}</td>
              <td>
                <small>
                  {currency(s.approved)} / {currency(s.committed)} / {currency(s.spent)}
                </small>
              </td>
              <td>
                {s.openImprests}
                <small>رصيد {currency(s.imprestBalance)}</small>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

function AccountReport({ account, onBack }: { account: Row; onBack: () => void }) {
  const w = useWorkspace();
  const [period, setPeriod] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(period).filter(([, v]) => v) as [string, string][]).toString();
  const base = `admin/users/${account.id}/report`;
  const [r] = useLoad<Row>(() => w.api(base + (qs ? '?' + qs : '')), [qs]);
  const printPath = base + '?format=print' + (qs ? '&' + qs : '');
  return (
    <>
      <div className="actions">
        <button className="secondary" onClick={onBack}>
          ← كل الحسابات
        </button>
        <DocButtons path={printPath} label="تقرير الحساب" />
        <button
          className="secondary"
          onClick={async () => {
            try {
              downloadFile(await w.api(base + '?format=xlsx' + (qs ? '&' + qs : '')));
            } catch (e) {
              w.fail(e);
            }
          }}
        >
          Excel
        </button>
        <label className="inline">
          من <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
        </label>
        <label className="inline">
          إلى <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
        </label>
      </div>
      {!r ? (
        <p>جارٍ التحميل…</p>
      ) : (
        <>
          <Panel title={`تقرير أعمال: ${r.user.name}`}>
            <p>
              <span className="mono">{r.user.username}</span> — {r.user.active ? 'فعال' : 'موقوف'} — آخر دخول: {when(r.user.lastLoginAt)}
            </p>
            <p>{r.user.schools.map((s: Row) => `${s.name} (${s.roles.join('، ')})`).join(' · ') || 'غير مسند لمدارس'}</p>
            <div className="cards">
              <Stat label="معاملات منجزة" value={r.summary.done} />
              <Stat label="قيد الإعداد" value={r.summary.open} />
              <Stat label="اعتمادات / شهادات" value={`${r.summary.approvals} / ${r.summary.certificates}`} />
              <Stat label="فواتير العهد" value={r.summary.pettyInvoices} hint={currency(r.summary.pettyAmount) + ' ر.ق'} />
            </div>
          </Panel>
          <Panel title="المعاملات التي أعدها">
            {r.prepared.length ? (
              <Table heads={['الرقم', 'المدرسة', 'الموضوع / المورد', 'أمر الشراء', 'القيمة', 'الحالة', 'الوضع']}>
                {r.prepared.map((c: Row) => (
                  <tr key={c.id}>
                    <td className="mono">{c.number}</td>
                    <td>{c.school}</td>
                    <td>
                      {c.subject}
                      <small>{c.supplier}</small>
                    </td>
                    <td className="mono">{c.orderNumber || '—'}</td>
                    <td>{currency(c.total)}</td>
                    <td>
                      <Badge state={c.state} />
                    </td>
                    <td>
                      <b>{c.status}</b>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty />
            )}
          </Panel>
          <div className="grid2">
            <Panel title="الاعتمادات">
              {r.approved.length ? (
                <Table heads={['الرقم', 'المدرسة', 'الموضوع', 'القيمة']}>
                  {r.approved.map((c: Row) => (
                    <tr key={c.number + c.school}>
                      <td className="mono">{c.number}</td>
                      <td>{c.school}</td>
                      <td>{c.subject}</td>
                      <td>{currency(c.total)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty />
              )}
            </Panel>
            <Panel title="شهادات الإنجاز الصادرة">
              {r.certificates.length ? (
                <Table heads={['الشهادة', 'المدرسة', 'المورد', 'الصافي', 'التاريخ']}>
                  {r.certificates.map((c: Row) => (
                    <tr key={c.number + c.school}>
                      <td className="mono">{c.number}</td>
                      <td>{c.school}</td>
                      <td>{c.supplier}</td>
                      <td>{currency(c.net)}</td>
                      <td>{day(c.createdAt)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty />
              )}
            </Panel>
          </div>
          <div className="grid2">
            <Panel title="فواتير العهد المسجلة">
              {r.imprests.length ? (
                <Table heads={['العهدة', 'المدرسة', 'الفواتير', 'المبلغ']}>
                  {r.imprests.map((x: Row, i: number) => (
                    <tr key={i}>
                      <td>{x.name}</td>
                      <td>{x.school}</td>
                      <td>{x.invoices}</td>
                      <td>{currency(x.amount)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty />
              )}
            </Panel>
            <Panel title="النشاط حسب نوع العملية">
              {r.activity.length ? (
                <Table heads={['العملية', 'العدد']}>
                  {r.activity.slice(0, 20).map((x: Row) => (
                    <tr key={x.action}>
                      <td className="mono">{x.action}</td>
                      <td>{x.count}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty />
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

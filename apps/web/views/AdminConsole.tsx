'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import { DateInput } from '../components/DateInput';
import type { Dialog } from '../components/FormDialog';
import { Badge, DocButtons, Empty, Panel, Stat, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, day, downloadFile, ROLE_CHOICES, ROLE_NAMES } from '../lib/format';

const when = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString('en-GB', { timeZone: 'Asia/Qatar', dateStyle: 'short', timeStyle: 'short' }) : '—';

const distanceText = (m: number) => (m < 1000 ? `${m} م` : `${(m / 1000).toFixed(1)} كم`);
const mapLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;

/** The school nearest to a sign-in location (schools get a location from their data screen). */
function Nearest({ n, located }: { n: Row | null; located: boolean }) {
  if (!located) return <span className="muted">—</span>;
  if (!n) return <span className="muted">لم تُحدد مواقع المدارس</span>;
  return n.near ? (
    <span className="badge s-REGISTERED">
      في {n.name} ({distanceText(n.metres)})
    </span>
  ) : (
    <small>
      أقرب مدرسة: {n.name} على {distanceText(n.metres)}
    </small>
  );
}

/** Sign-in log: who signed in, from which address and browser, and the device location when it was shared. */
function LoginLog() {
  const w = useWorkspace();
  const [rows] = useLoad<Row[]>(() => w.api('admin/logins?take=200'));
  const browser = (ua: string) =>
    /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : ua
              ? 'آخر'
              : '—';
  const device = (ua: string) =>
    /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iPhone/iPad'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  return (
    <Panel title="سجل الدخول ومواقع الأجهزة">
      <p>يظهر لمسؤول النظام فقط: وقت كل دخول وعنوان الشبكة والمتصفح، وموقع الجهاز إذا سمح المستخدم بمشاركته عند تسجيل الدخول.</p>
      {rows?.length ? (
        <Table heads={['الوقت', 'المستخدم', 'عنوان الشبكة', 'الجهاز / المتصفح', 'الموقع', 'أقرب مدرسة']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{when(r.createdAt)}</td>
              <td>
                {r.user.name} <small className="mono">{r.user.username}</small>
              </td>
              <td className="mono">{r.ip}</td>
              <td>
                {device(r.userAgent)} {browser(r.userAgent)}
              </td>
              <td>
                {r.lat != null && r.lng != null ? (
                  <a href={mapLink(r.lat, r.lng)} target="_blank" rel="noreferrer">
                    {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}
                    {r.accuracy ? ` (±${Math.round(r.accuracy)} م)` : ''} ↗
                  </a>
                ) : (
                  <span className="muted">لم يُشارك</span>
                )}
              </td>
              <td>
                <Nearest n={r.nearest} located={r.lat != null} />
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text="لا توجد سجلات دخول بعد" />
      )}
    </Panel>
  );
}

/** System administrator console: every account and school, with a full work report per account. */
export function AdminConsole() {
  const w = useWorkspace();
  const [data] = useLoad<Row>(() => w.api('admin/overview'));
  const [selected, setSelected] = useState<Row | null>(null);
  const [profile, setProfile] = useState<Row | null>(null);
  const [filter, setFilter] = useState('');
  if (!w.me.user.isTenantAdmin) return <Empty text="هذه الشاشة لمسؤول النظام فقط" />;
  if (!data) return <p>جارٍ التحميل…</p>;
  if (selected) return <AccountReport account={selected} onBack={() => setSelected(null)} />;
  if (profile)
    return <AccountProfile account={profile} onBack={() => setProfile(null)} onReport={() => (setSelected(profile), setProfile(null))} />;
  const t = data.totals;
  const accounts: Row[] = data.accounts.filter(
    (a: Row) => !filter || a.name.includes(filter) || a.username.includes(filter) || a.schools.some((s: Row) => s.name.includes(filter)),
  );

  const passwordDialog = (a: Row): Dialog => ({
    title: 'إعادة تعيين كلمة مرور: ' + a.name,
    intro: <p>تُلغى جميع جلسات المستخدم الحالية. سلّم كلمة المرور الجديدة للمستخدم بطريقة آمنة.</p>,
    fields: [{ name: 'password', label: 'كلمة المرور الجديدة — 8 أحرف على الأقل', type: 'password' }],
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
        {ROLE_CHOICES.map((value) => (
          <label key={value} className="check">
            <input type="checkbox" name={'role_' + value} defaultChecked={value === 'ACCOUNTANT'} />
            {String(ROLE_NAMES[value])}
          </label>
        ))}
      </div>
    ),
    save: (v, fd) =>
      w.api('admin/memberships', 'POST', {
        username: a.username,
        schoolId: v.schoolId,
        roles: ROLE_CHOICES.filter((r) => fd.get('role_' + r) === 'on'),
      }),
  });
  const newUserDialog: Dialog = {
    title: 'حساب جديد',
    intro: (
      <p>
        يبدأ الحساب بدون مدارس: يضيف المحاسب مدارسه بنفسه (يدوياً أو باختيار اسم المدرسة) ويدخل بياناتها المالية والإدارية وصلاحيات التوقيع،
        وتظهر لك كاملة. يمكنك أيضاً إسناد مدرسة قائمة من «الصلاحيات».
      </p>
    ),
    fields: [
      { name: 'name', label: 'الاسم الظاهر في المستندات' },
      { name: 'username', label: 'اسم الدخول بالإنجليزية' },
      { name: 'password', label: 'كلمة المرور — 8 أحرف على الأقل', type: 'password' },
    ],
    save: (v) => w.api('admin/users', 'POST', v),
  };
  const purgeDialog = (title: string, text: string, body: Row): Dialog => ({
    title,
    intro: <p className="warn">{text} لا يمكن التراجع بعد التنفيذ.</p>,
    fields: [{ name: 'confirm', label: 'اكتب كلمة «حذف» للتأكيد' }],
    submit: 'حذف نهائي',
    save: async (v) => {
      await w.api('admin/purge', 'POST', { ...body, confirm: v.confirm });
      if (body.scope !== 'transactions') location.reload();
    },
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
          <>
            <input className="search" placeholder="بحث بالاسم أو المدرسة" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button onClick={() => w.open(newUserDialog)}>＋ حساب جديد</button>
          </>
        }
      >
        <p>
          اضغط اسم المحاسب لفتح ملفه: بيانات مدارسه كاملة، والتقرير الفني، ومواقع الدخول مع أقرب مدرسة، والاستخدام. المنجزة: المعاملات التي
          صدرت لها شهادة الإنجاز وكتاب التغطية؛ قيد الإعداد: من تقرير العروض حتى قبل الشهادة.
        </p>
        <Table heads={['الحساب', 'المدارس', 'المعاملات', 'منجزة', 'قيد الإعداد', 'مصروفات مباشرة', 'كشوف العهد', 'آخر دخول', 'الحالة', '']}>
          {accounts.map((a) => (
            <tr key={a.id} className={a.active ? '' : 'inactive'}>
              <td>
                <button className="link strong" onClick={() => setProfile(a)} title="بيانات المدارس والتقرير الفني والمواقع والاستخدام">
                  {a.name}
                </button>
                <small className="mono">
                  {a.username}
                  {a.isTenantAdmin ? ' · مسؤول النظام' : ''}
                </small>
              </td>
              <td>
                <b>{a.schoolCount}</b>
                <small>{a.isTenantAdmin ? 'كل المدارس' : `أضاف ${a.schoolsAdded}`}</small>
              </td>
              <td>
                <b>{a.totalCases}</b>
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
                {a.directCount}
                <small>{currency(a.directAmount)} ر.ق</small>
              </td>
              <td>
                {a.settlements}
                <small>{currency(a.settledAmount)} ر.ق</small>
              </td>
              <td>
                <small>{when(a.lastLoginAt)}</small>
              </td>
              <td>{a.active ? <span className="badge s-REGISTERED">فعال</span> : <span className="badge s-CANCELLED">موقوف</span>}</td>
              <td>
                <div className="actions">
                  <button className="link" onClick={() => setProfile(a)}>
                    الملف
                  </button>
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
                  {a.id !== w.me.user.id && (
                    <button
                      className="link danger"
                      onClick={() =>
                        confirm(`حذف حساب ${a.name}؟ يُحذف الحساب فقط إذا لم تكن له أعمال مسجلة.`) &&
                        w.task(() => w.api(`admin/users/${a.id}/delete`, 'POST', {}), 'حُذف الحساب')
                      }
                    >
                      حذف
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
          heads={[
            'المدرسة',
            'المدير',
            'أضافها / المحاسبون',
            'منجزة',
            'قيد الإعداد',
            'الشهادات',
            'الموازنة (معتمد / مرتبط / مصروف)',
            'عهد مفتوحة',
            '',
          ]}
        >
          {data.schools.map((s: Row) => (
            <tr key={s.id}>
              <td>
                <b>{s.name}</b>
                <small className="mono">{s.code}</small>
              </td>
              <td>
                {s.principal}
                {!s.located && <small className="muted">الموقع غير محدد</small>}
              </td>
              <td>
                {s.owner || '—'}
                {s.accountants && s.accountants !== s.owner && <small>{s.accountants}</small>}
              </td>
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
              <td>
                <button
                  className="link danger"
                  onClick={() =>
                    w.open(
                      purgeDialog(
                        'حذف مدرسة: ' + s.name,
                        'تُحذف المدرسة وكل بياناتها: المعاملات والمستندات والعهد والموازنة والموردون والأعوام.',
                        { scope: 'school', id: s.id },
                      ),
                    )
                  }
                >
                  حذف
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <AccountantsTotals />
      <LoginLog />
      <Panel title="مسح البيانات">
        <p>للتجربة أو لتصحيح الأخطاء. تبقى الحسابات والإجازات والسياسة المالية ودليل البنود.</p>
        <div className="actions">
          <button
            className="secondary danger"
            onClick={() =>
              w.open(
                purgeDialog(
                  'مسح كل المعاملات والعهد',
                  'تُحذف كل المعاملات ومستنداتها وكل العهد والتقارير المحفوظة في كل المدارس، وتعود أرصدة الموازنة كاملة. تبقى المدارس والموازنات والموردون.',
                  { scope: 'transactions' },
                ),
              )
            }
          >
            مسح كل المعاملات والعهد
          </button>
          <button
            className="secondary danger"
            onClick={() =>
              w.open(purgeDialog('مسح كل البيانات', 'تُحذف كل المدارس وكل بياناتها. تبقى الحسابات فقط لإعادة البدء.', { scope: 'all' }))
            }
          >
            مسح كل البيانات (كل المدارس)
          </button>
        </div>
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
          من <DateInput value={period.from} onChange={(v) => setPeriod({ ...period, from: v })} ariaLabel="من" />
        </label>
        <label className="inline">
          إلى <DateInput value={period.to} onChange={(v) => setPeriod({ ...period, to: v })} ariaLabel="إلى" />
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
              <Stat label="تقارير عروض / شهادات" value={`${r.summary.approvals} / ${r.summary.certificates}`} />
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
            <Panel title="تقارير عروض الأسعار الصادرة">
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

/** Totals of every accountant's transactions for a period, with print, PDF and Excel. */
function AccountantsTotals() {
  const w = useWorkspace();
  const [period, setPeriod] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.entries(period).filter(([, v]) => v) as [string, string][]).toString();
  const [r] = useLoad<Row>(() => w.api('admin/accountants-report' + (qs ? '?' + qs : '')), [qs]);
  const base = 'admin/accountants-report?format=print' + (qs ? '&' + qs : '');
  return (
    <Panel title="تقرير إجمالي معاملات كل محاسب">
      <div className="actions">
        <label className="inline">
          من <DateInput value={period.from} onChange={(v) => setPeriod({ ...period, from: v })} ariaLabel="من" />
        </label>
        <label className="inline">
          إلى <DateInput value={period.to} onChange={(v) => setPeriod({ ...period, to: v })} ariaLabel="إلى" />
        </label>
        <DocButtons path={base} label="التقرير" />
        <button
          className="secondary"
          onClick={async () => {
            try {
              downloadFile(await w.api('admin/accountants-report?format=xlsx' + (qs ? '&' + qs : '')));
            } catch (e) {
              w.fail(e);
            }
          }}
        >
          تنزيل Excel
        </button>
      </div>
      {!r ? (
        <p>جارٍ التحميل…</p>
      ) : (
        <Table
          heads={[
            'المحاسب',
            'المدارس',
            'المعاملات',
            'منجزة / قيد الإعداد',
            'التكليفات',
            'الشهادات',
            'مصروفات مباشرة',
            'فواتير العهد',
            'كشوف التسوية',
          ]}
        >
          {[...r.rows, { ...r.totals, id: 'total', name: 'الإجمالي', total: true }].map((x: Row) => (
            <tr key={x.id} className={x.total ? 'total-row' : ''}>
              <td>
                <b>{x.name}</b>
              </td>
              <td>
                {x.schools}
                {!x.total && <small>أضاف {x.schoolsAdded}</small>}
              </td>
              <td>
                {x.cases}
                <small>{currency(x.casesValue)} ر.ق</small>
              </td>
              <td>
                {x.done} / {x.open}
              </td>
              <td>
                {x.orders}
                <small>{currency(x.ordersValue)} ر.ق</small>
              </td>
              <td>
                {x.certificates}
                <small>{currency(x.certificatesNet)} ر.ق</small>
              </td>
              <td>
                {x.direct}
                <small>{currency(x.directValue)} ر.ق</small>
              </td>
              <td>
                {x.invoices}
                <small>{currency(x.invoicesValue)} ر.ق</small>
              </td>
              <td>
                {x.statements}
                <small>{currency(x.statementsValue)} ر.ق</small>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

/** One accountant's file: their schools with full data, the technical report, sign-in locations and usage. */
function AccountProfile({ account, onBack, onReport }: { account: Row; onBack: () => void; onReport: () => void }) {
  const w = useWorkspace();
  const [p] = useLoad<Row>(() => w.api(`admin/users/${account.id}/profile`));
  if (!p)
    return (
      <>
        <button className="secondary" onClick={onBack}>
          ← كل الحسابات
        </button>
        <p>جارٍ التحميل…</p>
      </>
    );
  const t = p.technical,
    d = p.usage.documents;
  const max = Math.max(1, ...p.usage.monthly.map((m: Row) => m.count));
  return (
    <>
      <div className="actions">
        <button className="secondary" onClick={onBack}>
          ← كل الحسابات
        </button>
        <button className="secondary" onClick={onReport}>
          تقرير الأعمال التفصيلي
        </button>
      </div>
      <Panel title={`ملف المحاسب: ${p.user.name}`}>
        <p>
          <span className="mono">{p.user.username}</span> — {p.user.active ? 'فعال' : 'موقوف'}
          {p.user.isTenantAdmin ? ' — مسؤول النظام' : ''} — آخر دخول: {when(t.lastLogin)}
        </p>
        <div className="cards">
          <Stat label="المدارس" value={p.schools.length} hint={`أضاف ${p.schools.filter((x: Row) => x.addedByAccount).length}`} />
          <Stat label="المعاملات" value={d.cases} hint={`تكليفات ${d.orders} · شهادات ${d.certificates}`} />
          <Stat label="عمليات الدخول" value={t.logins} hint={`بموقع ${t.sharedLocation}`} />
          <Stat label="العمليات المسجلة" value={t.actions} hint={'آخر نشاط ' + when(t.lastActivity)} />
        </div>
      </Panel>

      <Panel title="المدارس وبياناتها (يدخلها المحاسب)">
        {p.schools.length ? (
          <Table
            heads={['المدرسة', 'الإدارة وصلاحيات التوقيع', 'العهد والمشتريات', 'البيانات المالية (العام المفتوح)', 'النشاط', 'الموقع']}
          >
            {p.schools.map((x: Row) => (
              <tr key={x.id} className={x.active ? '' : 'inactive'}>
                <td>
                  <b>{x.name}</b>
                  <small className="mono">
                    {x.code}
                    {x.erpCode ? ' · ERP ' + x.erpCode : ''}
                  </small>
                  <small>
                    {x.addedByAccount ? 'أضافها المحاسب' : 'مسندة'} · {day(x.createdAt)} · {x.roles.join('، ')}
                  </small>
                </td>
                <td>
                  المدير: {x.principal || '—'}
                  <small>مسؤول المشتريات: {x.purchasingOfficer || '—'}</small>
                </td>
                <td>
                  <small>النثرية: {x.pettyCustodian || '—'}</small>
                  <small>يوم التعليم: {x.educationCustodian || '—'}</small>
                  <small>معرض الكتاب: {x.bookCustodian || '—'}</small>
                  <small className="mono">رمز الأوامر: {x.orderPrefix || 'PO'}</small>
                </td>
                <td>
                  <small>معتمد {currency(x.approved)}</small>
                  <small>مرتبط {currency(x.committed)}</small>
                  <small>مصروف {currency(x.spent)}</small>
                  <small>الأعوام: {x.years.join('، ') || '—'}</small>
                </td>
                <td>
                  <small>
                    معاملات {x.cases} ({currency(x.casesValue)} ر.ق)
                  </small>
                  <small>
                    عهد مفتوحة {x.openImprests} · موردون {x.suppliers}
                  </small>
                </td>
                <td>
                  {x.lat != null ? (
                    <a href={mapLink(x.lat, x.lng)} target="_blank" rel="noreferrer">
                      على الخريطة ↗
                    </a>
                  ) : (
                    <span className="muted">غير محدد</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لم يضف المحاسب مدارس بعد" />
        )}
      </Panel>

      <div className="grid2">
        <Panel title="التقرير الفني">
          <Table heads={['البيان', 'القيمة']}>
            <tr>
              <td>أول دخول / آخر دخول</td>
              <td>
                {when(t.firstLogin)} / {when(t.lastLogin)}
              </td>
            </tr>
            <tr>
              <td>الجلسات المفتوحة الآن</td>
              <td>
                {t.activeSessions}
                {t.lastSeen ? ` — آخر ظهور ${when(t.lastSeen)}` : ''}
              </td>
            </tr>
            <tr>
              <td>الأجهزة والمتصفحات</td>
              <td>{t.devices.map((x: Row) => `${x.name} (${x.count})`).join('، ') || '—'}</td>
            </tr>
            <tr>
              <td>عناوين الشبكة</td>
              <td className="mono">{t.ips.join('، ') || '—'}</td>
            </tr>
            <tr>
              <td>المستندات</td>
              <td>
                تقارير عروض {d.quoteReports} · تكليفات {d.orders} · شهادات {d.certificates} · مصروفات مباشرة {d.direct} · فواتير عهد{' '}
                {d.invoices} · كشوف تسوية {d.statements}
              </td>
            </tr>
          </Table>
        </Panel>
        <Panel title="الاستخدام الشهري (آخر 12 شهراً)">
          {p.usage.monthly.length ? (
            <div className="usage-bars">
              {p.usage.monthly.map((m: Row) => (
                <div key={m.month}>
                  <span className="mono">{m.month}</span>
                  <span className="bar">
                    <span style={{ width: `${(100 * m.count) / max}%` }} />
                  </span>
                  <b>{m.count}</b>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="لا يوجد نشاط مسجل" />
          )}
        </Panel>
      </div>

      <Panel title="مواقع الدخول وأقرب مدرسة">
        {p.locations.length ? (
          <Table heads={['الوقت', 'الموقع', 'أقرب مدرسة', 'عنوان الشبكة']}>
            {p.locations.map((l: Row) => (
              <tr key={l.id}>
                <td>{when(l.createdAt)}</td>
                <td>
                  <a href={mapLink(l.lat, l.lng)} target="_blank" rel="noreferrer">
                    {Number(l.lat).toFixed(5)}, {Number(l.lng).toFixed(5)}
                    {l.accuracy ? ` (±${Math.round(l.accuracy)} م)` : ''} ↗
                  </a>
                </td>
                <td>
                  <Nearest n={l.nearest} located />
                </td>
                <td className="mono">{l.ip}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لم يشارك المحاسب موقعه عند الدخول" />
        )}
      </Panel>

      <Panel title="الاستخدام حسب نوع العملية">
        {p.usage.byAction.length ? (
          <Table heads={['العملية', 'العدد']}>
            {p.usage.byAction.slice(0, 25).map((x: Row) => (
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
    </>
  );
}

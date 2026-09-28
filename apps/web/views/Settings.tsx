'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { BUDGET_GROUPS, day, ROLE_NAMES } from '../lib/format';

const ROLE_OPTIONS = Object.entries(ROLE_NAMES).map(([value, label]) => ({ value, label: String(label) }));

function rolesBody() {
  return (
    <div className="check-grid">
      {ROLE_OPTIONS.map((r) => (
        <label key={r.value} className="check">
          <input type="checkbox" name={'role_' + r.value} />
          {r.label}
        </label>
      ))}
    </div>
  );
}
const readRoles = (fd: FormData) => ROLE_OPTIONS.map((r) => r.value).filter((r) => fd.get('role_' + r) === 'on');

export function Settings() {
  const w = useWorkspace();
  const s = w.setup.school || {};
  const admin = w.me.user.isTenantAdmin;
  const [schools] = useLoad<Row[]>(() => (admin ? w.api('admin/schools') : null));
  const [catalog] = useLoad<Row[]>(() => (admin ? w.api('admin/budget-catalog') : null));

  const schoolDialog: Dialog = {
    title: 'تعديل بيانات المدرسة',
    intro: <p>تظهر هذه الأسماء في التكليفات وشهادات الإنجاز وكشوف العهد وكتب التغطية.</p>,
    fields: [
      { name: 'name', label: 'اسم المدرسة', value: s.name },
      { name: 'principal', label: 'مدير / ة المدرسة', value: s.principal },
      { name: 'pettyCustodian', label: 'مسؤول / ة العهدة النثرية', value: s.pettyCustodian, required: false },
      { name: 'educationCustodian', label: 'مسؤول عهدة يوم التعليم', value: s.educationCustodian, required: false },
      { name: 'bookCustodian', label: 'مسؤول عهدة معرض الكتاب', value: s.bookCustodian, required: false },
      {
        name: 'orderPrefix',
        label: 'رمز أوامر الشراء (مثل MBAM)',
        value: s.orderPrefix,
        required: false,
        help: 'رقم الأمر: الرمز/السنة-الشهراليوم',
      },
    ],
    save: (v) => w.api(w.root('school'), 'PATCH', v),
  };

  const catalogDialog = (row?: Row): Dialog => ({
    title: row ? 'تعديل بند في دليل الموازنة' : 'إضافة بند رسمي',
    fields: [
      { name: 'code', label: 'رقم الحساب', value: row?.code },
      { name: 'nameAr', label: 'اسم البند', value: row?.nameAr },
      { name: 'nameEn', label: 'الاسم بالإنجليزية', value: row?.nameEn, required: false },
      {
        name: 'groupKey',
        label: 'المجموعة',
        type: 'select',
        value: row?.groupKey,
        options: Object.entries(BUDGET_GROUPS).map(([value, label]) => ({ value, label: String(label) })),
      },
      { name: 'sort', label: 'الترتيب', type: 'number', step: '1', value: row?.sort ?? 0 },
      { name: 'note', label: 'ملاحظة الاستخدام', required: false, value: row?.note },
      { name: 'active', label: 'فعال', type: 'checkbox', value: row?.active ?? true },
    ],
    save: (v) => w.api('admin/budget-catalog' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', { ...v, sort: Number(v.sort || 0) }),
  });

  return (
    <>
      <Panel title="بيانات المدرسة" actions={w.can('ADMIN') && <button onClick={() => w.open(schoolDialog)}>تعديل البيانات</button>}>
        <Table heads={['البيان', 'القيمة']}>
          <tr>
            <td>المدرسة</td>
            <td>{s.name}</td>
          </tr>
          <tr>
            <td>مدير / ة المدرسة</td>
            <td>{s.principal}</td>
          </tr>
          <tr>
            <td>مسؤول العهدة النثرية</td>
            <td>{s.pettyCustodian || '—'}</td>
          </tr>
          <tr>
            <td>رمز أوامر الشراء</td>
            <td className="mono">{s.orderPrefix || 'PO'}</td>
          </tr>
        </Table>
      </Panel>

      <Panel
        title="الأعوام المالية"
        actions={
          w.can('ADMIN') && (
            <button
              className="secondary"
              onClick={() =>
                w.open({
                  title: 'فتح عام مالي',
                  fields: [
                    { name: 'label', label: 'اسم العام (مثل 2027)' },
                    { name: 'start', label: 'البداية', type: 'date' },
                    { name: 'end', label: 'النهاية', type: 'date' },
                  ],
                  save: (v) => w.api(w.root('years'), 'POST', v),
                })
              }
            >
              عام مالي جديد
            </button>
          )
        }
      >
        <Table heads={['العام', 'من', 'إلى', 'الحالة', '']}>
          {w.setup.years?.map((y: Row) => (
            <tr key={y.id}>
              <td>{y.label}</td>
              <td>{day(y.startDate)}</td>
              <td>{day(y.endDate)}</td>
              <td>{y.closed ? 'مغلق' : 'مفتوح'}</td>
              <td>
                {w.can('ADMIN') && !y.closed && (
                  <button
                    className="link"
                    onClick={() =>
                      confirm('يُغلق العام فقط إذا اكتملت كل المعاملات والعهد. متابعة؟') &&
                      w.task(() => w.api(w.root(`years/${y.id}/close`), 'POST', {}))
                    }
                  >
                    إغلاق العام
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="مستخدمو المدرسة وصلاحياتهم"
        actions={
          w.can('ADMIN') && (
            <button
              onClick={() =>
                w.open({
                  title: 'إضافة مستخدم للمدرسة',
                  fields: [
                    { name: 'name', label: 'الاسم الظاهر في المستندات' },
                    { name: 'username', label: 'اسم الدخول بالإنجليزية' },
                    { name: 'password', label: 'كلمة مرور أولية — 12 حرفاً على الأقل', type: 'password' },
                  ],
                  body: rolesBody(),
                  save: (v, fd) => w.api(w.root('users'), 'POST', { ...v, roles: readRoles(fd) }),
                })
              }
            >
              ＋ مستخدم
            </button>
          )
        }
      >
        <Table heads={['الاسم', 'الحساب', 'الصلاحيات']}>
          {w.setup.users?.map((u: Row) => (
            <tr key={u.id}>
              <td>{u.user.name}</td>
              <td className="mono">{u.user.username}</td>
              <td>{u.roles.map((r: string) => ROLE_NAMES[r] || r).join(' · ')}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      {admin && (
        <>
          <Panel
            title="المدارس (مسؤول النظام)"
            actions={
              <>
                <button
                  className="secondary"
                  onClick={() =>
                    w.open({
                      title: 'إسناد مستخدم لمدرسة',
                      intro: <p>مستخدم قائم: اسم الدخول والصلاحيات فقط. مستخدم جديد: أضف الاسم وكلمة المرور.</p>,
                      fields: [
                        {
                          name: 'schoolId',
                          label: 'المدرسة',
                          type: 'select',
                          options: (schools || []).map((x) => ({ value: x.id, label: x.name })),
                        },
                        { name: 'username', label: 'اسم الدخول' },
                        { name: 'name', label: 'الاسم (لمستخدم جديد)', required: false },
                        { name: 'password', label: 'كلمة المرور (لمستخدم جديد)', type: 'password', required: false },
                      ],
                      body: rolesBody(),
                      save: (v, fd) =>
                        w.api('admin/memberships', 'POST', {
                          schoolId: v.schoolId,
                          username: v.username,
                          ...(v.name ? { name: v.name } : {}),
                          ...(v.password ? { password: v.password } : {}),
                          roles: readRoles(fd),
                        }),
                    })
                  }
                >
                  إسناد مستخدم
                </button>
                <button
                  onClick={() =>
                    w.open({
                      title: 'إضافة مدرسة',
                      fields: [
                        { name: 'code', label: 'رمز المدرسة' },
                        { name: 'name', label: 'اسم المدرسة' },
                        { name: 'principal', label: 'مدير / ة المدرسة' },
                        { name: 'pettyCustodian', label: 'مسؤول العهدة النثرية', required: false },
                        { name: 'orderPrefix', label: 'رمز أوامر الشراء', required: false },
                      ],
                      save: (v) => w.api('admin/schools', 'POST', v),
                    })
                  }
                >
                  ＋ مدرسة
                </button>
              </>
            }
          >
            <p>المدرسة الجديدة تظهر لك بعد إعادة تسجيل الدخول، ويُفتح لها العام المالي الحالي.</p>
            <Table heads={['الرمز', 'المدرسة', 'المدير', 'رمز الأوامر', 'الحالة']}>
              {(schools || []).map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.code}</td>
                  <td>{x.name}</td>
                  <td>{x.principal}</td>
                  <td className="mono">{x.orderPrefix}</td>
                  <td>{x.active ? 'فعالة' : 'موقوفة'}</td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="دليل بنود الموازنة الرسمية" actions={<button onClick={() => w.open(catalogDialog())}>＋ بند</button>}>
            <Table heads={['رقم الحساب', 'البند', 'المجموعة', 'ملاحظة', '']}>
              {(catalog || []).map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>
                    {c.nameAr}
                    <small>{c.nameEn}</small>
                  </td>
                  <td>{BUDGET_GROUPS[c.groupKey]}</td>
                  <td>
                    <small>{c.note}</small>
                  </td>
                  <td>
                    <button className="link" onClick={() => w.open(catalogDialog(c))}>
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
        </>
      )}

      <Panel title="أمان حسابك">
        <button
          className="secondary"
          onClick={() =>
            w.open({
              title: 'تغيير كلمة المرور وإلغاء جميع الجلسات',
              fields: [
                { name: 'current', label: 'كلمة المرور الحالية', type: 'password' },
                { name: 'password', label: 'الجديدة — 12 حرفاً على الأقل', type: 'password' },
              ],
              save: async (v) => {
                await w.api('auth/password', 'POST', v);
                location.reload();
              },
            })
          }
        >
          تغيير كلمة المرور
        </button>
      </Panel>
    </>
  );
}

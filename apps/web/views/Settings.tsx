'use client';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { day, ROLE_CHOICES, ROLE_NAMES } from '../lib/format';
import { loadTheme, saveTheme, THEMES } from '../lib/theme';
import { useState } from 'react';

const ROLE_OPTIONS = ROLE_CHOICES.map((value) => ({ value, label: String(ROLE_NAMES[value]) }));

function rolesBody() {
  return (
    <div className="check-grid">
      {ROLE_OPTIONS.map((r) => (
        <label key={r.value} className="check">
          <input type="checkbox" name={'role_' + r.value} defaultChecked={r.value === 'ACCOUNTANT'} />
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
  const [schools] = useLoad<Row[]>(() => w.api('admin/schools'));

  const schoolDialog: Dialog = {
    title: 'تعديل بيانات المدرسة',
    intro: <p>تظهر هذه الأسماء في التكليفات وشهادات الإنجاز وكشوف العهد وكتب التغطية.</p>,
    fields: [
      { name: 'name', label: 'اسم المدرسة', value: s.name },
      { name: 'principal', label: 'مدير / ة المدرسة', value: s.principal },
      { name: 'pettyCustodian', label: 'مسؤول / ة العهدة النثرية', value: s.pettyCustodian, required: false },
      { name: 'educationCustodian', label: 'مسؤول عهدة يوم التعليم', value: s.educationCustodian, required: false },
      { name: 'bookCustodian', label: 'مسؤول عهدة معرض الكتاب', value: s.bookCustodian, required: false },
      { name: 'purchasingOfficer', label: 'مسؤول المشتريات (يوقع تقرير عروض الأسعار)', value: s.purchasingOfficer, required: false },
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

  return (
    <>
      <Panel title="بيانات المدرسة" actions={w.can('ACCOUNTANT') && <button onClick={() => w.open(schoolDialog)}>تعديل البيانات</button>}>
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
            <td>مسؤول عهدة يوم التعليم / معرض الكتاب</td>
            <td>
              {s.educationCustodian || '—'} / {s.bookCustodian || '—'}
            </td>
          </tr>
          <tr>
            <td>مسؤول المشتريات</td>
            <td>{s.purchasingOfficer || '—'}</td>
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
          w.can('ACCOUNTANT') && (
            <button
              className="secondary"
              onClick={() =>
                w.open({
                  title: 'إضافة عام مالي',
                  intro: <p>يُفتح العام ببنود الموازنة الرسمية، وتُدخل مبالغها من شاشة الموازنة.</p>,
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
                {w.can('ACCOUNTANT') && !y.closed && (
                  <button
                    className="link"
                    onClick={() =>
                      confirm('يُغلق العام فقط إذا أُنجزت كل المعاملات وأُغلقت العهد. متابعة؟') &&
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

      {admin && (
        <Panel
          title="مستخدمو المدرسة وصلاحياتهم"
          actions={
            admin && (
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
      )}

      <Panel
        title="المدارس"
        actions={
          <>
            {admin && (
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
            )}
            <button
              onClick={() =>
                w.open({
                  title: 'إضافة مدرسة',
                  intro: <p>تُضاف المدرسة إلى مدارسك مباشرة، ويُفتح لها العام المالي الحالي ببنود الموازنة الرسمية.</p>,
                  fields: [
                    { name: 'name', label: 'اسم المدرسة' },
                    { name: 'principal', label: 'مدير / ة المدرسة' },
                    { name: 'pettyCustodian', label: 'مسؤول العهدة النثرية', required: false },
                    { name: 'purchasingOfficer', label: 'مسؤول المشتريات', required: false },
                    { name: 'educationCustodian', label: 'مسؤول عهدة يوم التعليم', required: false },
                    { name: 'bookCustodian', label: 'مسؤول عهدة معرض الكتاب', required: false },
                    { name: 'orderPrefix', label: 'رمز أوامر الشراء بالإنجليزية (مثل ABAF)', required: false },
                    { name: 'code', label: 'رمز المدرسة (اختياري)', required: false },
                  ],
                  save: async (v) => {
                    await w.api('admin/schools', 'POST', v);
                    location.reload();
                  },
                })
              }
            >
              ＋ مدرسة
            </button>
          </>
        }
      >
        <Table heads={['الرمز', 'المدرسة', 'المدير', 'مسؤول العهدة', 'رمز الأوامر', 'الحالة']}>
          {(schools || []).map((x) => (
            <tr key={x.id}>
              <td className="mono">{x.code}</td>
              <td>{x.name}</td>
              <td>{x.principal}</td>
              <td>{x.pettyCustodian || '—'}</td>
              <td className="mono">{x.orderPrefix}</td>
              <td>{x.active ? 'فعالة' : 'موقوفة'}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <ThemePicker />

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

/** Screen colours: preset themes or custom main / side-bar colours, saved in this browser. */
function ThemePicker() {
  const [t, setT] = useState(loadTheme);
  const set = (next: { primary: string; side: string }) => (setT(next), saveTheme(next));
  return (
    <Panel title="ألوان النظام">
      <p>اختر نمط الألوان أو حدد لونك الخاص؛ يُحفظ الاختيار على هذا الجهاز.</p>
      <div className="themes">
        {THEMES.map((x) => (
          <button
            key={x.key}
            type="button"
            className={'theme' + (x.primary === t.primary && x.side === t.side ? ' on' : '')}
            onClick={() => set(x)}
          >
            <span style={{ background: `linear-gradient(135deg, ${x.side} 0 50%, ${x.primary} 50% 100%)` }} />
            {x.name}
          </button>
        ))}
      </div>
      <div className="theme-custom">
        <label>
          اللون الرئيسي
          <input type="color" value={t.primary} onChange={(e) => set({ ...t, primary: e.target.value })} />
        </label>
        <label>
          لون القائمة الجانبية
          <input type="color" value={t.side} onChange={(e) => set({ ...t, side: e.target.value })} />
        </label>
        <button type="button" className="secondary" onClick={() => set(THEMES[0])}>
          استعادة الألوان الأصلية
        </button>
      </div>
    </Panel>
  );
}

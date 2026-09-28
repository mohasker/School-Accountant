'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from './Select';
import { applyTheme, loadTheme } from '../lib/theme';
import { request, type Row } from '../lib/api';
import { downloadFile, ERP_URL, ROLE_NAMES, showPrint } from '../lib/format';
import { WorkspaceContext, type View, type Workspace } from './context';
import { FormDialog, type Dialog } from './FormDialog';
import { Logo } from './ui';
import { APP_NAME, APP_TITLE } from '../lib/brand';
import { AdminConsole } from '../views/AdminConsole';
import { Audit } from '../views/Audit';
import { Budget } from '../views/Budget';
import { CaseDetail } from '../views/CaseDetail';
import { Cases } from '../views/Cases';
import { Dashboard } from '../views/Dashboard';
import { Holidays } from '../views/Holidays';
import { Imprests } from '../views/Imprests';
import { Policy } from '../views/Policy';
import { Registry } from '../views/Registry';
import { Reports } from '../views/Reports';
import { Settings } from '../views/Settings';
import { Suppliers } from '../views/Suppliers';

const NAV: { view: View; icon: string; label: string; show?: (w: { can: Workspace['can']; me: Row }) => boolean }[] = [
  { view: 'admin', icon: '♛', label: 'لوحة مدير النظام', show: ({ me }) => me.user.isTenantAdmin },
  { view: 'dashboard', icon: '◫', label: 'الرئيسية' },
  { view: 'cases', icon: '▤', label: 'المعاملات' },
  { view: 'quote-register', icon: '☰', label: 'تقارير عروض الأسعار' },
  { view: 'order-register', icon: '✎', label: 'التكليفات' },
  { view: 'registry', icon: '⌕', label: 'شهادات الإنجاز' },
  { view: 'imprests', icon: '▣', label: 'العهد والتسويات' },
  { view: 'budget', icon: '▥', label: 'الموازنة' },
  { view: 'suppliers', icon: '◈', label: 'الموردون' },
  { view: 'reports', icon: '▧', label: 'التقارير' },
  { view: 'holidays', icon: '☾', label: 'الإجازات الرسمية' },
  { view: 'policy', icon: '§', label: 'السياسة المالية', show: ({ me }) => me.user.isTenantAdmin },
  { view: 'settings', icon: '⚙', label: 'الإعدادات' },
  { view: 'audit', icon: '↺', label: 'سجل التدقيق', show: ({ me }) => me.user.isTenantAdmin },
];

const TITLES: Record<View, string> = {
  dashboard: 'الرئيسية',
  cases: 'المعاملات: تقرير العروض ← التكليف ← الشهادة والتغطية',
  case: 'المعاملة',
  suppliers: 'دليل الموردين',
  budget: 'الموازنة التشغيلية',
  imprests: 'العهد والتسويات',
  reports: 'التقارير',
  registry: 'سجل شهادات الإنجاز وكتب التغطية',
  'quote-register': 'سجل تقارير دراسة عروض الأسعار',
  'order-register': 'سجل التكليفات',
  holidays: 'الإجازات والعطل الرسمية',
  policy: 'السياسة المالية ودليل البنود',
  settings: 'الإعدادات',
  audit: 'سجل التدقيق',
  admin: 'لوحة مدير النظام',
};

export default function App() {
  const [me, setMe] = useState<Row | null>(null),
    [loading, setLoading] = useState(true),
    [school, setSchool] = useState(''),
    [year, setYear] = useState(''),
    [setup, setSetup] = useState<Row>({}),
    [view, setView] = useState<View>('dashboard'),
    [caseId, setCaseId] = useState(''),
    [intent, setIntent] = useState(''),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);

  const api = useCallback(
    async (path: string, method = 'GET', body?: unknown) => {
      try {
        return await request(path, method, body, me?.csrf);
      } catch (e: any) {
        if (e.status === 401 && path !== 'auth/login') setMe(null);
        throw e;
      }
    },
    [me?.csrf],
  );
  const root = useCallback((p: string) => `schools/${school}/${p}`, [school]);
  const roles: string[] = setup.roles || [];
  const can = useCallback((...r: string[]) => r.some((x) => roles.includes(x)), [roles.join()]);
  const fail = useCallback((e: unknown) => setError((e as Error)?.message || String(e)), []);

  useEffect(() => applyTheme(loadTheme()), []);

  useEffect(() => {
    request('auth/me')
      .then((m) => {
        setMe(m);
        setSchool(m.schools[0]?.id || '');
        if (m.user.isTenantAdmin) setView('admin');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!me || !school) return;
    setCaseId('');
    api(root('setup'))
      .then((s) => {
        setSetup(s);
        setYear((y) => (s.years.some((x: Row) => x.id === y) ? y : s.years.find((x: Row) => !x.closed)?.id || s.years[0]?.id || ''));
      })
      .catch(fail);
  }, [school, me?.user?.id]);

  useEffect(() => {
    if (me && school && year)
      api(root('setup?year=' + year))
        .then(setSetup)
        .catch(fail);
  }, [year, version]);

  const workspace: Workspace | null = useMemo(
    () =>
      me && {
        me,
        school,
        year,
        setup,
        can,
        api,
        root,
        fail,
        busy,
        version,
        open: (d) => {
          setError('');
          setDialog(d);
        },
        task: async (fn, text = 'تم حفظ العملية') => {
          setBusy(true);
          setError('');
          try {
            await fn();
            setNotice(text);
            setVersion((v) => v + 1);
          } catch (e) {
            fail(e);
          } finally {
            setBusy(false);
          }
        },
        print: async (path) => {
          try {
            const data = await api(path);
            if (!showPrint(data.html)) setError('اسمح بالنوافذ المنبثقة لفتح نسخة الطباعة');
          } catch (e) {
            fail(e);
          }
        },
        pdf: async (path, part) => {
          setBusy(true);
          try {
            downloadFile(await api(path + (path.includes('?') ? '&' : '?') + 'pdf=1' + (part ? '&part=' + part : '')));
          } catch (e) {
            fail(e);
          } finally {
            setBusy(false);
          }
        },
        printHtml: (html) => {
          if (!showPrint(html)) setError('اسمح بالنوافذ المنبثقة لفتح نسخة الطباعة');
        },
        go: (v, id, next) => {
          setError('');
          setNotice('');
          setCaseId(id ?? '');
          setIntent(next ?? '');
          setView(v);
          window.scrollTo?.(0, 0);
        },
      },
    [me, school, year, setup, can, api, root, busy, version],
  );

  if (loading) return <main className="center">جارٍ تحميل مساحة العمل…</main>;
  if (!me || !workspace)
    return <Login onLogin={(m) => (setMe(m), setSchool(m.schools[0]?.id || ''), setView(m.user.isTenantAdmin ? 'admin' : 'dashboard'))} />;

  const current = me.schools.find((s: Row) => s.id === school);
  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="app">
        <aside>
          <div className="brand-card">
            <div className="brand-row">
              <Logo variant="mark" />
              <div>
                <b>{APP_NAME}</b>
                <small>{APP_TITLE}</small>
              </div>
            </div>
            <Logo />
          </div>
          <nav>
            {NAV.filter((n) => !n.show || n.show({ can, me })).map((n) => (
              <button
                key={n.view}
                className={view === n.view || (n.view === 'cases' && view === 'case') ? 'active' : ''}
                onClick={() => workspace.go(n.view)}
              >
                <span>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>
          <a className="erp-nav" href={ERP_URL} target="_blank" rel="noopener noreferrer">
            <span>↗</span>
            نظام ERP الوزارة
          </a>
          <div className="aside-bottom">
            <span>V0</span>
            <p>نظام مساعد شخصي لخدمة المحاسبين، وليس نظاماً حكومياً رسمياً.</p>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="context">
              <label>
                المدرسة
                <Select
                  label="المدرسة"
                  className="wide"
                  value={school}
                  options={me.schools.map((s: Row) => ({ value: s.id, label: s.name }))}
                  onChange={(v) => (setYear(''), setSchool(v), workspace.go('dashboard'))}
                />
              </label>
              <label>
                العام المالي
                <Select
                  label="العام المالي"
                  value={year}
                  options={(setup.years || []).map((y: Row) => ({ value: y.id, label: y.label + (y.closed ? ' — مغلق' : '') }))}
                  onChange={(v) => (setYear(v), workspace.go('dashboard'))}
                />
              </label>
            </div>
            <div className="user">
              <span className="avatar">{me.user.name[0]}</span>
              <div>
                {me.user.name}
                <small>
                  {me.user.isTenantAdmin
                    ? 'مدير النظام — كامل الصلاحيات'
                    : (current?.roles || []).map((r: string) => ROLE_NAMES[r] || r).join(' · ')}
                </small>
              </div>
              <button
                className="link"
                onClick={async () => {
                  await api('auth/logout', 'POST', {}).catch(() => {});
                  setMe(null);
                  setSetup({});
                }}
              >
                خروج
              </button>
            </div>
          </header>
          <main>
            <div className="heading">
              <div>
                <p className="eyebrow">{setup.school?.name}</p>
                <h1>{TITLES[view]}</h1>
              </div>
              {setup.demo && <span className="demo-flag">بيئة تجريبية</span>}
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
                <button className="link" onClick={() => setError('')}>
                  إغلاق
                </button>
              </div>
            )}
            {notice && (
              <div className="success" role="status">
                {notice}
                <button className="link" onClick={() => setNotice('')}>
                  ×
                </button>
              </div>
            )}
            {year ? (
              <>
                {view === 'dashboard' && <Dashboard />}
                {view === 'cases' && <Cases />}
                {view === 'case' && caseId && <CaseDetail key={caseId + intent} id={caseId} intent={intent} />}
                {view === 'suppliers' && <Suppliers />}
                {view === 'budget' && <Budget />}
                {view === 'imprests' && <Imprests />}
                {view === 'reports' && <Reports />}
                {view === 'registry' && <Registry type="certificate" />}
                {view === 'quote-register' && <Registry type="report" />}
                {view === 'order-register' && <Registry type="order" />}
                {view === 'holidays' && <Holidays />}
                {view === 'policy' && <Policy />}
                {view === 'settings' && <Settings />}
                {view === 'audit' && <Audit />}
                {view === 'admin' && <AdminConsole />}
              </>
            ) : (
              <p>{setup.school?.id === school ? 'لا يوجد عام مالي لهذه المدرسة؛ أضفه من الإعدادات.' : 'جارٍ التحميل…'}</p>
            )}
          </main>
          <footer className="page-footer">
            {APP_NAME} V0 · {APP_TITLE} <span>العملة: ريال قطري · أيام العمل: الأحد – الخميس · التوقيت: قطر</span>
          </footer>
        </div>
        {dialog && (
          <FormDialog
            key={dialog.title}
            dialog={dialog}
            onClose={() => setDialog(null)}
            onSaved={() => {
              // A dialog may open the next step (e.g. quote report → assignment letter) from its save.
              setDialog((current) => (current === dialog ? null : current));
              setNotice('تم حفظ العملية');
              setVersion((v) => v + 1);
            }}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}

function Login({ onLogin }: { onLogin: (me: Row) => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="login">
      <section>
        <div className="login-logos">
          <Logo variant="system" />
          <Logo />
        </div>
        <h2>{APP_TITLE}</h2>
        <p>
          التكليفات وشهادات الإنجاز والعهد والموازنة
          <br />
          بنماذج الطباعة المعتمدة.
        </p>
        <div className="login-lines">
          أيام عمل وإجازات رسمية في حساب الغرامات
          <br />
          صلاحيات مستقلة لكل مدرسة
          <br />
          سجل مالي يمكن مراجعته
        </div>
      </section>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const fd = new FormData(e.currentTarget);
          try {
            await request('auth/login', 'POST', Object.fromEntries(fd));
            onLogin(await request('auth/me'));
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">مرحباً بعودتك</span>
        <h2>تسجيل الدخول</h2>
        <p>استخدم الحساب الذي أعده مسؤول النظام.</p>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <label>
          اسم المستخدم
          <input autoComplete="username" name="username" required />
        </label>
        <label>
          كلمة المرور
          <input type="password" autoComplete="current-password" name="password" required />
        </label>
        <button disabled={busy}>{busy ? 'جارٍ التحقق…' : 'الدخول إلى مساحة العمل'}</button>
        <small>نظام مساعد شخصي لخدمة المحاسبين — ليس نظاماً حكومياً رسمياً.</small>
      </form>
    </div>
  );
}

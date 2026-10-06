'use client';
import { useWorkspace } from '../components/context';
import { Empty, Panel, Stat } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, percent } from '../lib/format';

/**
 * All the schools of an accountant on one screen: the budget of each school's current year, its
 * warnings and pending files; choosing a school opens it. The administrator passes `userId` to see
 * another accountant's schools.
 */
export function SchoolsOverview({ userId }: { userId?: string }) {
  const w = useWorkspace();
  const [d] = useLoad<Row>(() => w.api('overview/schools' + (userId ? '?user=' + userId : '')), [userId]);
  if (!d) return <p>جارٍ التحميل…</p>;
  const t = d.totals;
  const own = !userId || userId === w.me.user.id;
  return (
    <>
      <div className="cards">
        <Stat label="المدارس" value={t.schools} />
        <Stat label="الموازنة المعتمدة" value={currency(t.approved)} hint="ر.ق — الأعوام الحالية" />
        <Stat
          label="المصروف + الارتباطات"
          value={currency(Number(t.spent) + Number(t.committed))}
          hint={`المتاح ${currency(t.available)} ر.ق`}
        />
        <Stat label="معاملات غير مكتملة / تنبيهات" value={`${t.pending} / ${t.warnings}`} />
      </div>
      {!d.schools.length ? (
        <Empty text={own ? 'لا توجد مدارس في حسابك بعد' : 'لا توجد مدارس لهذا المحاسب'} />
      ) : (
        <div className="school-grid">
          {d.schools.map((s: Row) => {
            const danger = s.warnings.some((x: Row) => x.level === 'danger');
            const used = Math.min(100, Math.round(s.used * 100));
            return (
              <button
                key={s.id}
                type="button"
                className={'school-card' + (danger ? ' danger' : s.warnings.length ? ' warn' : '')}
                onClick={() => w.pickSchool(s.id)}
                title="فتح بيانات المدرسة"
              >
                <header>
                  <b>{s.name}</b>
                  <small className="mono">
                    {s.code}
                    {s.erpCode ? ' · ERP ' + s.erpCode : ''}
                    {s.year ? ' · عام ' + s.year.label : ''}
                  </small>
                </header>
                <div className="school-budget">
                  <div>
                    <span>المعتمد</span>
                    <b>{currency(s.approved)}</b>
                  </div>
                  <div>
                    <span>المصروف</span>
                    <b>{currency(s.spent)}</b>
                  </div>
                  <div>
                    <span>مرتبط</span>
                    <b>{currency(s.committed)}</b>
                  </div>
                  <div>
                    <span>المتاح</span>
                    <b>{currency(s.available)}</b>
                  </div>
                </div>
                <div className="track" aria-label={'نسبة الاستخدام ' + used + '%'}>
                  <span style={{ width: used + '%' }} className={used >= 90 ? 'hot' : ''} />
                </div>
                <small>
                  استُخدم {percent(s.used)} من المعتمد · {s.pending ? `${s.pending} معاملة غير مكتملة` : 'لا توجد معاملات معلقة'}
                </small>
                {s.warnings.length > 0 && (
                  <ul className="school-warnings">
                    {s.warnings.slice(0, 5).map((x: Row, i: number) => (
                      <li key={i} className={x.level}>
                        {x.text}
                      </li>
                    ))}
                    {s.warnings.length > 5 && <li className="info">و{s.warnings.length - 5} تنبيهات أخرى</li>}
                  </ul>
                )}
                <span className="open">فتح المدرسة ←</span>
              </button>
            );
          })}
        </div>
      )}
      {own && (
        <Panel title="ملاحظة">
          <p>الأرقام من العام المالي الحالي لكل مدرسة. البند الذي بقي منه أقل من 10% يظهر بالبرتقالي، والذي نفد رصيده بالأحمر.</p>
        </Panel>
      )}
    </>
  );
}

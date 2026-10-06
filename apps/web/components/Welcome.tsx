'use client';
import React from 'react';
import type { Row } from '../lib/api';
import { currency } from '../lib/format';

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Qatar' }).format(new Date()));
  return h < 12 ? 'صباح الخير' : 'مساء الخير';
};
const todayText = () => {
  const d = new Date();
  const weekday = d.toLocaleDateString('ar-QA', { weekday: 'long', timeZone: 'Asia/Qatar' });
  let hijri = '';
  try {
    hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  } catch {}
  const g = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Qatar' });
  return `${weekday} ${hijri ? hijri + ' — ' : ''}${g} م`;
};
const waited = (n: number) =>
  n === 0 ? 'اليوم' : n === 1 ? 'منذ يوم' : n === 2 ? 'منذ يومين' : n <= 10 ? `منذ ${n} أيام` : `منذ ${n} يوماً`;

/**
 * Greeting and reminder shown once after signing in (and from the bell): pending work in every
 * school, each item with the next step and a button that opens it.
 */
export function Welcome({
  data,
  onClose,
  onOpen,
}: {
  data: Row;
  onClose: () => void;
  onOpen: (schoolId: string, caseId?: string, view?: 'cases' | 'imprests' | 'registry') => void;
}) {
  const t = data.totals;
  const nothing = !data.schools.length;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal welcome-modal" role="dialog" aria-label="الترحيب والتذكير">
        <div className="welcome-head">
          <div>
            <h2>
              {greeting()} يا {data.name}
            </h2>
            <p>اليوم: {todayText()}</p>
          </div>
          <button className="link" onClick={onClose} aria-label="إغلاق">
            ✕
          </button>
        </div>

        {nothing ? (
          <div className="welcome-clear">
            <b>✓ لا توجد معاملات معلقة</b>
            <p>{t.schools ? 'كل معاملات مدارسك مكتملة. يومك سعيد.' : 'لا توجد مدارس في حسابك بعد — ابدأ بإضافة مدرستك الأولى.'}</p>
          </div>
        ) : (
          <>
            <div className="welcome-totals">
              <span>
                <b>{t.pending}</b> معاملة غير مكتملة
              </span>
              {t.late > 0 && (
                <span className="bad">
                  <b>{t.late}</b> تجاوزت موعد التنفيذ
                </span>
              )}
              {t.replenish > 0 && (
                <span>
                  <b>{t.replenish}</b> عهدة بلغت حد الاستعاضة
                </span>
              )}
              {t.awaiting > 0 && (
                <span>
                  <b>{t.awaiting}</b> استعاضة لم تُستلم
                </span>
              )}
              {t.erp > 0 && (
                <span>
                  <b>{t.erp}</b> منجزة لم تُسجل في ERP
                </span>
              )}
              {t.returns > 0 && (
                <span className="bad">
                  <b>{t.returns}</b> مرتجعة من التدقيق
                </span>
              )}
              {t.budget > 0 && (
                <span>
                  <b>{t.budget}</b> بند موازنة يقترب من النفاد
                </span>
              )}
            </div>
            <div className="welcome-schools">
              {data.schools.map((s: Row) => (
                <section key={s.id} className="welcome-school">
                  <header>
                    <h3>{s.name}</h3>
                    <button className="secondary mini" onClick={() => onOpen(s.id, undefined, 'cases')}>
                      فتح معاملات المدرسة
                    </button>
                  </header>
                  <div className="welcome-chips">
                    {s.stages.report > 0 && <span>تقرير عروض: {s.stages.report}</span>}
                    {s.stages.order > 0 && <span>بانتظار التكليف: {s.stages.order}</span>}
                    {s.stages.certificate > 0 && <span>بانتظار الشهادة: {s.stages.certificate}</span>}
                    {s.late > 0 && <span className="bad">متأخرة: {s.late}</span>}
                    {s.erp > 0 && <span>لم تُسجل في ERP: {s.erp}</span>}
                    {s.returns > 0 && <span className="bad">مرتجعة: {s.returns}</span>}
                    {s.approvals > 0 && <span>بانتظار موافقة: {s.approvals}</span>}
                    {s.dueSoon > 0 && <span>تستحق خلال 3 أيام: {s.dueSoon}</span>}
                    {s.budgetAlerts?.slice(0, 3).map((b: Row) => (
                      <span key={b.code} className={b.level === 'CRITICAL' ? 'bad' : ''} title={b.name}>
                        بند {b.code}: {b.used}%{b.level === 'PACE' ? ` (المتوقع ${b.projected}%)` : ''}
                      </span>
                    ))}
                    {s.pending > 0 && <span className="muted">القيمة {currency(s.value)} ر.ق</span>}
                  </div>
                  {s.items.length > 0 && (
                    <ul>
                      {s.items.map((c: Row) => (
                        <li key={c.id} className={c.late ? 'late' : ''}>
                          <span className="mono">{c.number}</span>
                          <span className="subject">
                            {c.subject}
                            {c.supplier && <small> — {c.supplier}</small>}
                          </span>
                          <span className="next">
                            الخطوة التالية: <b>{c.next}</b>
                            <small> · {[c.late && 'تجاوز موعد التنفيذ', waited(c.waiting)].filter(Boolean).join(' · ')}</small>
                          </span>
                          <button className="link" onClick={() => onOpen(s.id, c.id)}>
                            فتح ←
                          </button>
                        </li>
                      ))}
                      {s.pending > s.items.length && <li className="more">و{s.pending - s.items.length} معاملات أخرى في شاشة المعاملات</li>}
                    </ul>
                  )}
                  {(s.replenish.length > 0 || s.awaiting.length > 0) && (
                    <p className="welcome-imprest">
                      {s.replenish.map((a: Row) => (
                        <span key={'r' + a.name}>
                          {a.name}: المنصرف غير المسوى {currency(a.unsettled)} ر.ق — يمكن طلب الاستعاضة.{' '}
                        </span>
                      ))}
                      {s.awaiting.map((a: Row, i: number) => (
                        <span key={'a' + i}>
                          {a.name}: استعاضة {currency(a.amount)} ر.ق لم يُؤكد استلامها.{' '}
                        </span>
                      ))}
                      <button className="link" onClick={() => onOpen(s.id, undefined, 'imprests')}>
                        فتح العهد ←
                      </button>
                    </p>
                  )}
                </section>
              ))}
            </div>
            {data.clear > 0 && <p className="muted">و{data.clear} مدرسة أخرى لا توجد بها معاملات معلقة.</p>}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>ابدأ العمل</button>
          <small className="muted">تفتح هذه النافذة مرة عند الدخول، ومتى شئت من زر التنبيهات 🔔 أعلى الشاشة.</small>
        </div>
      </div>
    </div>
  );
}

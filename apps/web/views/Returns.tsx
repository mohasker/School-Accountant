'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { dateNow, day } from '../lib/format';

export const REASONS: [string, string][] = [
  ['DATES', 'عدم تسلسل أو تطابق التواريخ'],
  ['ITEMS', 'عدم مطابقة الأصناف أو عددها أو كمياتها'],
  ['AMOUNTS', 'خطأ في المبالغ أو الغرامة أو الصافي'],
  ['SIGNATURE', 'توقيع أو ختم ناقص'],
  ['MISSING_DOC', 'مستند ناقص من الملف'],
  ['SCHOOL_NAME', 'اختلاف اسم المدرسة'],
  ['SUPPLIER', 'بيانات المورد أو السجل التجاري'],
  ['IBAN', 'رقم الحساب البنكي (IBAN)'],
  ['UNDERTAKING', 'التعهد'],
  ['INVOICE', 'الفاتورة'],
  ['REFERENCE', 'أرقام مرجعية'],
  ['OTHER', 'أخرى'],
];
const LABEL = Object.fromEntries(REASONS);
const DOCS: [number, string][] = [
  [1, 'دعوة الشركات'],
  [2, 'عروض الأسعار'],
  [3, 'السجلات التجارية'],
  [4, 'تقرير دراسة العروض'],
  [5, 'كتاب التكليف'],
  [6, 'الفاتورة'],
  [7, 'إذن التسليم من المورد'],
  [8, 'إذن الاستلام من المدرسة'],
  [9, 'التعهد'],
  [10, 'إثبات IBAN'],
  [13, 'شهادة الإنجاز'],
  [14, 'كتاب التغطية'],
];

/** On the case page: returns from the auditors (record, resolve) and remarks from anyone who sees the case. */
/** Second-person approval of a large certificate: request, approve or reject (by another user). */
export function ApprovalPanel({ c }: { c: Row }) {
  const w = useWorkspace();
  if (!c.approval) return null;
  const a = c.approval.last;
  const mine = a && a.requestedBy === w.me.user.id;
  const act = (action: string, body: Row, notice: string) => w.task(() => w.api(w.root(`cases/${c.id}/${action}`), 'POST', body), notice);
  return (
    <Panel title="موافقة مستخدم آخر على الشهادة">
      <p>
        <small>قيمة المعاملة تتجاوز الحد الذي حدده مدير النظام: تصدر الشهادة بعد موافقة مستخدم غير طالب الموافقة.</small>
      </p>
      {!a || a.status === 'REJECTED' ? (
        <>
          {a && (
            <p className="danger">
              رُفض الطلب السابق من {a.decidedName}: {a.note}
            </p>
          )}
          <button onClick={() => act('request-approval', {}, 'أُرسل طلب الموافقة')}>طلب الموافقة</button>
        </>
      ) : a.status === 'PENDING' ? (
        <>
          <p>
            طلب {a.requestedName} الموافقة بتاريخ {day(a.createdAt)} — <b>بانتظار مستخدم آخر</b>
          </p>
          {!mine && (
            <div className="toolbar">
              <button onClick={() => act('decide-approval', { approvalId: a.id, approve: true }, 'تمت الموافقة')}>موافقة</button>
              <button
                className="secondary danger"
                onClick={() =>
                  w.open({
                    title: 'رفض طلب الموافقة',
                    fields: [{ name: 'note', label: 'سبب الرفض', type: 'textarea' }],
                    save: (v) => w.api(w.root(`cases/${c.id}/decide-approval`), 'POST', { approvalId: a.id, approve: false, note: v.note }),
                  })
                }
              >
                رفض
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="notice">
          ✓ وافق {a.decidedName} بتاريخ {day(a.decidedAt)}؛ يصدر الشهادة مستخدم غيره.
        </p>
      )}
    </Panel>
  );
}

export function CaseReturnsPanel({ c }: { c: Row }) {
  const w = useWorkspace();
  const [returns] = useLoad<Row[]>(() => w.api(w.root('case-returns?case=' + c.id)), [c.id]);
  const [comments] = useLoad<Row[]>(() => w.api(w.root('case-comments?case=' + c.id)), [c.id]);
  const [text, setText] = useState('');
  const [doc, setDoc] = useState('');
  const record: Dialog = {
    title: 'تسجيل إرجاع المعاملة من التدقيق',
    intro: <p>سجّل أسباب الإرجاع كما وردت من التدقيق؛ تُجمع الأسباب في لوحة «المرتجعات» لمعرفة الأكثر تكراراً.</p>,
    fields: [
      { name: 'date', label: 'تاريخ الإرجاع', type: 'date', value: dateNow() },
      { name: 'note', label: 'تفاصيل الملاحظات (كما في خطاب التدقيق)', type: 'textarea', required: false },
    ],
    body: (
      <div className="check-grid">
        {REASONS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" name={'r_' + k} /> {label}
          </label>
        ))}
      </div>
    ),
    save: (v, fd) =>
      w.api(w.root('case-returns'), 'POST', {
        caseId: c.id,
        date: v.date,
        note: v.note ?? '',
        reasons: REASONS.map(([k]) => k).filter((k) => fd.get('r_' + k) === 'on'),
      }),
  };
  const resolve = (r: Row): Dialog => ({
    title: 'إغلاق الإرجاع بعد التصحيح',
    fields: [{ name: 'resolveNote', label: 'ما الذي صُحّح؟', type: 'textarea' }],
    save: (v) => w.api(w.root('case-returns/' + r.id), 'PATCH', { resolveNote: v.resolveNote }),
  });
  const open = (returns ?? []).filter((r) => !r.resolvedAt).length;
  return (
    <Panel
      title={`المرتجعات والملاحظات${open ? ` — ${open} مفتوح` : ''}`}
      actions={
        <button className="secondary" onClick={() => w.open(record)}>
          ↩ تسجيل إرجاع من التدقيق
        </button>
      }
    >
      {returns?.length ? (
        <ul className="check-list">
          {returns.map((r) => (
            <li key={r.id} className={r.resolvedAt ? '' : 'lvl-ERROR'}>
              {day(r.date)} — {(r.reasons as string[]).map((k) => LABEL[k] ?? k).join('، ')}
              {r.note && <small> — {r.note}</small>} <small>({r.byName})</small>
              {r.resolvedAt ? (
                <small>
                  {' '}
                  ✓ صُحّح {day(r.resolvedAt)}: {r.resolveNote}
                </small>
              ) : (
                <button className="link" onClick={() => w.open(resolve(r))}>
                  إغلاق بعد التصحيح
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <small>لم تُرجع هذه المعاملة من التدقيق.</small>
        </p>
      )}
      <h3>ملاحظات على المعاملة</h3>
      {comments?.length ? (
        <ul>
          {comments.map((m) => (
            <li key={m.id} style={{ opacity: m.resolved ? 0.6 : 1 }}>
              <b>{m.byName}</b> <small>{new Date(m.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Qatar' })}</small>
              {m.docCode ? <small> — {DOCS.find(([n]) => n === m.docCode)?.[1]}</small> : null}: {m.text}{' '}
              <button
                className="link"
                onClick={() => w.task(() => w.api(w.root('case-comments/' + m.id), 'PATCH', { resolved: !m.resolved }))}
              >
                {m.resolved ? 'إعادة فتح' : 'تمت المعالجة'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          <small>لا توجد ملاحظات.</small>
        </p>
      )}
      <form
        className="toolbar wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length < 2) return;
          w.task(() => w.api(w.root('case-comments'), 'POST', { caseId: c.id, text: text.trim(), docCode: doc ? Number(doc) : null })).then(
            () => setText(''),
          );
        }}
      >
        <select value={doc} onChange={(e) => setDoc(e.target.value)}>
          <option value="">عن المعاملة كلها</option>
          {DOCS.map(([n, label]) => (
            <option key={n} value={n}>
              {label}
            </option>
          ))}
        </select>
        <input placeholder="ملاحظة جديدة" value={text} onChange={(e) => setText(e.target.value)} style={{ minWidth: 260 }} />
        <button type="submit" disabled={w.busy}>
          إضافة
        </button>
      </form>
    </Panel>
  );
}

/** «المرتجعات وأسبابها»: which reasons recur, for whom and in which schools; a reason becomes a check rule in one click. */
export function ReturnsReport() {
  const w = useWorkspace();
  const admin = w.me.user.isTenantAdmin;
  const [range, setRange] = useState({ from: '', to: '' });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(range).filter(([, v]) => v))).toString();
  const [data] = useLoad<Row>(() => w.api('admin/returns-report?' + qs), [qs]);
  const [settings] = useLoad<Row>(() => (admin ? w.api('admin/file-check') : null));
  if (!data) return <p>جارٍ التحميل…</p>;
  const addRule = (text: string) =>
    w.task(
      () =>
        w.api('admin/file-check', 'POST', {
          ai: settings!.ai,
          prompt: settings!.prompt,
          gate: settings!.gate,
          docs: settings!.docs,
          rules: [...settings!.rules, { text, level: 'ERROR', docType: '' }],
        }),
      'أُضيفت القاعدة إلى فحص المعاملات',
    );
  const has = (text: string) => settings?.rules?.some((r: Row) => r.text === text);
  return (
    <>
      <Panel title="المرتجعات من التدقيق وأسبابها">
        <div className="toolbar wrap">
          <label>
            من <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label>
            إلى <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
          <span>
            الفترة {day(data.from)} — {day(data.to)}: <b>{data.total}</b> إرجاع، منها <b>{data.open}</b> مفتوح
          </span>
        </div>
        {data.byReason.length ? (
          <Table heads={['السبب', 'مرات التكرار', '']}>
            {data.byReason.map((r: Row) => (
              <tr key={r.reason}>
                <td>{r.label}</td>
                <td>{r.count}</td>
                <td>
                  {admin &&
                    r.rule &&
                    settings &&
                    (has(r.rule) ? (
                      <small>✓ في قواعد الفحص</small>
                    ) : (
                      <button className="link" onClick={() => addRule(r.rule)}>
                        إضافة كقاعدة فحص
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لا توجد مرتجعات في الفترة" />
        )}
      </Panel>
      {data.total > 0 && (
        <div className="grid2">
          <Panel title="حسب المحاسب">
            <Table heads={['المحاسب', 'المرتجعات']}>
              {data.byAccountant.map((r: Row) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="حسب المدرسة">
            <Table heads={['المدرسة', 'المرتجعات']}>
              {data.bySchool.map((r: Row) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
      )}
      {data.rows.length > 0 && (
        <Panel title="سجل المرتجعات">
          <Table heads={['التاريخ', 'المدرسة', 'المعاملة', 'الأسباب', 'الحالة']}>
            {data.rows.map((r: Row) => (
              <tr key={r.id}>
                <td>{day(r.date)}</td>
                <td>{r.school}</td>
                <td>
                  {r.schoolId === w.school ? (
                    <button className="link" onClick={() => w.go('case', r.caseId)}>
                      {r.number}
                    </button>
                  ) : (
                    r.number
                  )}
                  <small>{r.subject}</small>
                </td>
                <td>
                  {r.reasons.join('، ')}
                  {r.note && <small>{r.note}</small>}
                </td>
                <td>{r.resolvedAt ? `صُحّح ${day(r.resolvedAt)}` : <b className="danger">مفتوح</b>}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </>
  );
}

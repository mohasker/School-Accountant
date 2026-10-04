'use client';
import { showDate } from '../components/DateInput';
import { useEffect, useRef, useState } from 'react';
import { useWorkspace, type Workspace } from '../components/context';
import type { Dialog, Field } from '../components/FormDialog';
import { Badge, DocButtons, Empty, Panel, Table } from '../components/ui';
import { FileCheckPanel } from './FileCheck';
import { ApprovalPanel, CaseReturnsPanel } from './Returns';
import { NumberInput, toNumberText } from '../components/NumberInput';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, downloadFile, ERP_URL, EVIDENCE, EVIDENCE_ORDER, METHOD_NAMES, readBase64 } from '../lib/format';

/** The purchase file in four documents: quote report → assignment letter → completion certificate + covering letter. */
const STEPS = ['تقرير عروض الأسعار', 'كتاب التكليف', 'شهادة الإنجاز', 'كتاب التغطية'];
const STEP_OF: Row = {
  DRAFT: 0,
  EVALUATED: 0,
  APPROVED: 1,
  ORDERED: 2,
  PARTIAL: 2,
  DELIVERED: 2,
  CERTIFIED: 4,
  COMPLETE: 4,
  REGISTERED: 4,
};

const RATING_OPTIONS = [
  { value: 'EXCELLENT', label: 'ممتاز' },
  { value: 'AVERAGE', label: 'متوسط' },
  { value: 'POOR', label: 'رديء' },
];
/** Covering-letter attachments (template «Cover Let»); the certificate is always attached. */
const COVER_ATTACHMENTS: [string, string][] = [
  ['invoice', 'فاتورة بالمبلغ المستحق (أصل) معتمدة من الشركة'],
  ['order', 'كتاب التكليف الصادر إلى الشركة'],
  ['supplierReceipt', 'سند الاستلام من الشركة معتمد من المدرسة'],
  ['schoolReceipt', 'سند الاستلام من المدرسة معتمد'],
  ['iban', 'صورة IBAN (بيان رقم حساب البنك للشركة)'],
  ['quoteReport', 'تقرير عروض الأسعار معتمد من المدرسة'],
  ['quotes', 'عروض الأسعار للشركات المختلفة'],
  ['crs', 'السجلات التجارية للشركات المقدمة للعروض'],
  ['deptApproval', 'موافقة القسم المختص بالوزارة'],
  ['undertaking', 'التعهد (الإقرار) بعدم تابعية الشركة لمنسوبي الوزارة'],
  ['localPo', 'أمر شراء محلي (إدارة المشتريات والمناقصات)'],
  ['beneficiaries', 'كشوف بيانات المستفيدين بالهدايا'],
  ['procurementApproval', 'موافقة إدارة المشتريات على إصدار أمر التوريد'],
];
const defaultCover = (c: Row) => {
  const base = ['invoice', 'order', 'supplierReceipt', 'schoolReceipt', 'iban'];
  if (c.origin === 'MINISTRY') return [...base, 'localPo'];
  return c.method === 'THREE_QUOTES' ? [...base, 'quoteReport', 'quotes', 'crs'] : [...base, 'quoteReport'];
};

/** Repeating rows of the quote report: company name and quote value (quote number optional). */
export function QuoteRows({ suppliers }: { suppliers: Row[] }) {
  const [count, setCount] = useState(3);
  return (
    <>
      <datalist id="companies">
        {suppliers.map((s: Row) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <div className="quote-rows">
        <div className="quote-row head">
          <span>م</span>
          <span>اسم الشركة</span>
          <span>قيمة عرض السعر (ر.ق)</span>
          <span>رقم العرض (اختياري)</span>
        </div>
        {Array.from({ length: count }, (_, i) => (
          <div className="quote-row" key={i}>
            <span className="n">{i + 1}</span>
            <input name={'q_name_' + i} list="companies" autoComplete="off" placeholder="اسم الشركة" required={i === 0} />
            <NumberInput name={'q_total_' + i} required={i === 0} />
            <input name={'q_ref_' + i} placeholder="—" />
          </div>
        ))}
      </div>
      <button type="button" className="secondary" onClick={() => setCount((n) => n + 1)}>
        ＋ شركة أخرى
      </button>
    </>
  );
}

/** The dialogs of a purchase file; used on the file page and from the quick actions of the transactions list. */
export function caseDialogs(w: Workspace, c: Row) {
  const policy = w.setup.policy || {};
  const act = (action: string, body: Row = {}) => w.api(w.root(`cases/${c.id}/${action}`), 'POST', body);
  const ministry = c.origin === 'MINISTRY';
  const lowest = [...c.quotes].filter((q: Row) => q.compliant).sort((a: Row, b: Row) => Number(a.total) - Number(b.total))[0];

  const order: Dialog = {
    title: 'إعداد كتاب التكليف',
    intro: <p>مدة التنفيذ بأيام العمل (الأحد – الخميس) مع استبعاد الإجازات الرسمية المسجلة؛ يوم الإصدار لا يُحتسب.</p>,
    fields: [
      { name: 'trigger', label: 'تاريخ كتاب التكليف', type: 'date', value: dateNow() },
      { name: 'days', label: 'مدة التنفيذ (أيام عمل)', type: 'number', step: '1', min: '1', value: policy.defaultDeliveryDays ?? 15 },
      ...(!ministry ? [{ name: 'orderNumber', label: 'رقم أمر الشراء (فارغ = ترقيم تلقائي)', required: false } as Field] : []),
    ],
    submit: 'إصدار كتاب التكليف',
    confirm: (v) => (
      <p>
        سيصدر <b>كتاب تكليف</b> لشركة <b>{c.supplier?.name ?? lowest?.supplier?.name ?? '—'}</b> بقيمة{' '}
        <b>{currency(c.total || lowest?.total)} ر.ق</b> بتاريخ {showDate(String(v.trigger))} ومدة تنفيذ {v.days} يوم عمل.
      </p>
    ),
    save: (v) =>
      act('issue', {
        trigger: v.trigger,
        days: Number(v.days),
        policyConfirmed: true,
        ...(v.orderNumber ? { orderNumber: v.orderNumber } : {}),
      }),
  };

  const quotes: Dialog = ministry
    ? {
        title: 'بيانات التكليف الوزاري',
        fields: [
          { name: 'supplierName', label: 'اسم الشركة', list: 'companies' },
          { name: 'total', label: 'قيمة التكليف (ر.ق)', type: 'number' },
          { name: 'reason', label: 'مرجع اعتماد الأسعار من الوزارة' },
        ],
        body: (
          <>
            <datalist id="companies">
              {(w.setup.suppliers || []).map((s: Row) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            {c.items.length > 1 && (
              <>
                <h3>قيمة كل صنف (مجموعها = قيمة التكليف)</h3>
                {c.items.map((i: Row) => (
                  <label key={i.id}>
                    {i.name} — {i.qty} {i.unit}
                    <NumberInput name={'v_' + i.id} required />
                  </label>
                ))}
              </>
            )}
          </>
        ),
        save: (v, fd) =>
          act('direct-order', {
            supplierName: v.supplierName,
            reason: v.reason,
            total: v.total,
            ...(c.items.length > 1
              ? { values: c.items.map((i: Row) => ({ itemId: i.id, value: toNumberText(String(fd.get('v_' + i.id) ?? '')) })) }
              : {}),
          }),
      }
    : {
        title: 'تقرير عروض الأسعار — بيانات العروض',
        wide: true,
        intro: (
          <p>
            أدخل اسم كل شركة وقيمة عرضها فقط. يُكلَّف الأقل سعراً، أو الشركة الوحيدة. حتى {currency(policy.singleQuoteLimit)} ر.ق يكفي عرض
            واحد، وما يزيد يتطلب {policy.minQuotes} عروض إلا للمورد المحتكر.
          </p>
        ),
        body: <QuoteRows suppliers={w.setup.suppliers || []} />,
        submit: 'حفظ العروض',
        save: async (_v, fd) => {
          for (let i = 0; fd.has('q_name_' + i); i++) {
            const name = String(fd.get('q_name_' + i) || '').trim(),
              total = toNumberText(String(fd.get('q_total_' + i) || '').trim());
            if (!name && !total) continue;
            if (!name || !total) throw Error(`الصف ${i + 1}: أدخل اسم الشركة وقيمة العرض معاً`);
            await act('quotes', { supplierName: name, total, reference: String(fd.get('q_ref_' + i) || ''), quoteDate: dateNow() });
          }
        },
      };

  const needsSplit = lowest && !lowest.prices?.length && c.items.length > 1;
  const overLimit = lowest && Number(lowest.total) > Number(policy.singleQuoteLimit);
  const report: Dialog = {
    title: 'إصدار تقرير عروض الأسعار والانتقال إلى التكليف',
    wide: needsSplit,
    intro: lowest ? (
      <>
        <p>
          يُوصى بتكليف <b>{lowest.supplier.name}</b> بقيمة <b>{currency(lowest.total)} ر.ق</b>{' '}
          {c.quotes.filter((q: Row) => q.compliant).length > 1
            ? 'لأنها الأقل سعراً والمطابقة للمواصفات.'
            : 'وهي الشركة الوحيدة المقدمة للعرض.'}
        </p>
        {overLimit && c.quotes.length < Number(policy.minQuotes) && (
          <p className="warn">
            القيمة تزيد عن {currency(policy.singleQuoteLimit)} ر.ق وعدد العروض أقل من {policy.minQuotes}: أضف عروضاً أخرى، أو اذكر مبرر
            احتكار الشركة للصنف.
          </p>
        )}
      </>
    ) : (
      <p className="warn">لا يوجد عرض مطابق.</p>
    ),
    fields: [
      { name: 'date', label: 'تاريخ التقرير', type: 'date', value: dateNow() },
      ...(overLimit && c.quotes.length === 1
        ? [{ name: 'exclusiveReason', label: 'مبرر احتكار الشركة للصنف', required: false } as Field]
        : []),
    ],
    body: needsSplit ? (
      <>
        <h3>قيمة كل صنف في عرض الشركة المختارة (المجموع {currency(lowest.total)} ر.ق)</h3>
        {c.items.map((i: Row) => (
          <label key={i.id}>
            {i.name} — {i.qty} {i.unit}
            <NumberInput name={'v_' + i.id} required />
          </label>
        ))}
      </>
    ) : undefined,
    submit: 'إصدار التقرير ← إعداد التكليف',
    confirm: (v) => (
      <p>
        سيصدر <b>تقرير دراسة عروض الأسعار</b> بتاريخ {showDate(String(v.date))} بترشيح <b>{lowest?.supplier?.name ?? '—'}</b> بقيمة{' '}
        <b>{currency(lowest?.total)} ر.ق</b>، ثم تنتقل إلى كتاب التكليف.
      </p>
    ),
    save: async (v, fd) => {
      await act('evaluate', {
        date: v.date,
        ...(v.exclusiveReason ? { exclusiveReason: v.exclusiveReason } : {}),
        ...(needsSplit
          ? { values: c.items.map((i: Row) => ({ itemId: i.id, value: toNumberText(String(fd.get('v_' + i.id) ?? '')) })) }
          : {}),
      });
      w.open(order);
    },
  };

  const finish: Dialog = {
    title: 'إعداد شهادة الإنجاز وكتاب التغطية',
    wide: true,
    intro: (
      <p>
        تاريخ الإنجاز الفعلي يُقارن بآخر موعد ({day(c.dueDate)}) بأيام العمل، وتُحسب الغرامة تلقائياً إن وجد تأخير. يصدر كتاب التغطية مع
        الشهادة مباشرة.
      </p>
    ),
    fields: [
      { name: 'completionDate', label: 'تاريخ الإنجاز / التوريد الفعلي', type: 'date', value: dateNow() },
      { name: 'invoice', label: 'رقم فاتورة الشركة' },
      {
        name: 'invoiceAmount',
        label: `إجمالي الفاتورة (يجب أن يساوي قيمة المتبقي ${currency(c.items.reduce((v: number, i: Row) => v + Number(i.value) - Number(i.acceptedValue), 0))} ر.ق)`,
        type: 'number',
        required: false,
      },
      { name: 'date', label: 'تاريخ الشهادة وكتاب التغطية', type: 'date', value: dateNow() },
      {
        name: 'addressee',
        label: 'الشهادة وكتاب التغطية موجهان إلى',
        type: 'select',
        options: (w.setup.addressees as string[] | undefined)?.map((a) => ({ value: a, label: a })) ?? [
          { value: 'إدارة الشؤون المالية', label: 'إدارة الشؤون المالية' },
        ],
      },
      { name: 'scope', label: 'الالتزام بنطاق العمل', type: 'select', options: RATING_OPTIONS },
      { name: 'time', label: 'الالتزام بالمدة الزمنية', type: 'select', options: RATING_OPTIONS },
      { name: 'supervision', label: 'الالتزام بتعليمات جهة الإشراف', type: 'select', options: RATING_OPTIONS },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', required: false },
    ],
    body: (
      <>
        {c.gate && (
          <>
            <h3>تأكيد المستندات الموجودة في الملف (مطلوب قبل الشهادة)</h3>
            <div className="check-grid">
              {c.gate.map((g: Row) => (
                <label key={g.type} className="check">
                  <input type="checkbox" name={'gate_' + g.type} />
                  {g.label}
                </label>
              ))}
            </div>
          </>
        )}
        <h3>مرفقات كتاب التغطية</h3>
        <div className="check-grid">
          {COVER_ATTACHMENTS.map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" name={'att_' + key} defaultChecked={defaultCover(c).includes(key)} />
              {label}
            </label>
          ))}
        </div>
      </>
    ),
    submit: 'إصدار الشهادة وكتاب التغطية',
    confirm: (v) => (
      <p>
        ستصدر <b>شهادة الإنجاز وكتاب التغطية</b> لشركة <b>{c.supplier?.name ?? '—'}</b> — فاتورة رقم {String(v.invoice)} — تاريخ الإنجاز{' '}
        {showDate(String(v.completionDate))}
        {String(v.completionDate) > String(c.dueDate ?? '').slice(0, 10) ? ' (بعد آخر موعد؛ ستُحسب غرامة التأخير)' : ''}.
      </p>
    ),
    save: (v, fd) =>
      act('finish', {
        completionDate: v.completionDate,
        invoice: v.invoice,
        ...(String(v.invoiceAmount ?? '').trim() ? { invoiceAmount: String(v.invoiceAmount).replace(/,/g, '') } : {}),
        ...(c.gate ? { present: c.gate.map((g: Row) => g.type).filter((t: string) => fd.get('gate_' + t) === 'on') } : {}),
        date: v.date,
        addressee: String(v.addressee),
        notes: v.notes,
        ratings: { scope: v.scope, time: v.time, supervision: v.supervision },
        attachments: ['certificate', ...COVER_ATTACHMENTS.map(([k]) => k).filter((k) => fd.get('att_' + k) === 'on')],
      }),
  };

  const upload: Dialog = {
    title: 'إرفاق مستند بالمعاملة (اختياري)',
    fields: [
      {
        name: 'code',
        label: 'نوع المستند',
        type: 'select',
        options: EVIDENCE_ORDER.map((code) => ({ value: String(code), label: EVIDENCE[code] })),
      },
    ],
    body: (
      <label>
        PDF أو صورة حتى 5 MB
        <input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
      </label>
    ),
    save: async (v, fd) => {
      const file = fd.get('file') as File;
      const code = Number(v.code);
      await act('evidence', {
        code,
        ...([13, 14].includes(code) && c.certificates[0] ? { certificateId: c.certificates.at(-1).id } : {}),
        name: file.name,
        mime: file.type,
        base64: await readBase64(file),
      });
    },
  };
  return { quotes, report, order, finish, upload };
}

/** One plain sentence under the big button: what the next step does. */
const NEXT_HELP: Record<string, string> = {
  quotes: 'أدخل عروض الأسعار التي وصلتك من الشركات (عرض واحد حتى حد الشراء المباشر، و3 عروض لما يزيد).',
  report: 'راجع العروض ثم أصدر تقرير دراسة العروض؛ بعده تنتقل مباشرة إلى كتاب التكليف.',
  order: 'حدد مدة التوريد وتاريخ الإصدار؛ يصدر كتاب التكليف للشركة جاهزاً للطباعة.',
  finish: 'بعد استلام التوريد أدخل تاريخ الاستلام؛ تصدر شهادة الإنجاز وكتاب التغطية معاً.',
};

/** The next step of a file, for its main button and the quick actions of the transactions list. */
export function nextStep(c: Row): { key: 'quotes' | 'report' | 'order' | 'finish'; label: string } | null {
  if (c.state === 'DRAFT')
    return c.origin === 'MINISTRY'
      ? { key: 'quotes', label: 'بيانات التكليف الوزاري' }
      : c.quotes?.length
        ? { key: 'report', label: 'إصدار التقرير ← التكليف' }
        : { key: 'quotes', label: 'إدخال عروض الأسعار' };
  if (c.state === 'APPROVED') return { key: 'order', label: 'إعداد كتاب التكليف' };
  if (['ORDERED', 'PARTIAL', 'DELIVERED'].includes(c.state)) return { key: 'finish', label: 'إعداد الشهادة والتغطية' };
  return null;
}

export function CaseDetail({ id, intent }: { id: string; intent?: string }) {
  const w = useWorkspace();
  const [c] = useLoad<Row>(() => w.api(w.root('cases/' + id)), [id]);
  const opened = useRef(false);
  useEffect(() => {
    if (!c || opened.current || !intent) return;
    opened.current = true;
    const d = caseDialogs(w, c) as Row;
    if (d[intent]) w.open(d[intent]);
  }, [c]);
  if (!c) return <p>جارٍ التحميل…</p>;
  const act = (action: string, body: Row = {}) => w.api(w.root(`cases/${c.id}/${action}`), 'POST', body);
  const simple = (title: string, action: string, fields: Field[], extra: Row = {}): Dialog => ({
    title,
    fields,
    save: (v) => act(action, { ...v, ...extra }),
  });
  const d = caseDialogs(w, c);
  const work = w.can('ACCOUNTANT');
  const step = STEP_OF[c.state] ?? 0;
  const ministry = c.origin === 'MINISTRY';
  const lowest = [...c.quotes].filter((q: Row) => q.compliant).sort((a: Row, b: Row) => Number(a.total) - Number(b.total))[0];
  const next = nextStep(c);
  const cert = c.certificates.at(-1);
  const docs = [
    {
      n: 1,
      name: 'تقرير عروض الأسعار',
      ready: !!c.evaluationHtml,
      path: w.root(`cases/${c.id}/report-print`),
      hint: ministry ? 'لا يلزم للتكليف الوزاري' : c.quotes.length ? 'جاهز للإصدار' : 'أدخل عروض الأسعار',
      action: !ministry && c.state === 'DRAFT' ? (c.quotes.length ? d.report : d.quotes) : null,
      actionLabel: c.quotes.length ? 'إصدار التقرير' : 'إدخال العروض',
    },
    {
      n: 2,
      name: 'كتاب التكليف',
      ready: !!c.orderHtml,
      path: w.root(`cases/${c.id}/order-print`),
      hint: 'بعد تقرير العروض',
      action: c.state === 'APPROVED' ? d.order : null,
      actionLabel: 'إعداد التكليف',
    },
    {
      n: 3,
      name: 'شهادة الإنجاز',
      ready: !!cert,
      path: cert && w.root('certificates/' + cert.id),
      hint: 'بعد إتمام المعاملة',
      action: ['ORDERED', 'PARTIAL', 'DELIVERED'].includes(c.state) ? d.finish : null,
      actionLabel: 'إعداد الشهادة والتغطية',
    },
    {
      n: 4,
      name: 'كتاب التغطية',
      ready: !!cert?.coverHtml,
      path: cert && w.root(`certificates/${cert.id}/cover`),
      hint: 'يصدر مع الشهادة',
      action: null,
      actionLabel: '',
    },
  ];

  return (
    <>
      <div className="case-top">
        <Badge state={c.state} />
        <b className="mono">{c.number}</b>
        <span>{c.subject}</span>
        {c.method && <span>{METHOD_NAMES[c.method]}</span>}
        <span>الشركة: {c.supplier?.name || '—'}</span>
        {c.orderNumber && <span className="mono">أمر الشراء: {c.orderNumber}</span>}
        {c.dueDate && (
          <span>
            آخر موعد: {day(c.dueDate)} ({c.deliveryDays} يوم عمل)
          </span>
        )}
        <span>
          القيمة: <b>{currency(c.total)} ر.ق</b>
        </span>
      </div>
      <div className="stepper four">
        {STEPS.map((s, i) => (
          <div key={s} className={c.state === 'CANCELLED' ? '' : i < step ? 'done' : i === step ? 'current' : ''}>
            <b>{i < step ? '✓' : i + 1}</b>
            {s}
          </div>
        ))}
      </div>

      <div className="case-layout">
        <div className="case-main">
          {work && ['CERTIFIED', 'COMPLETE', 'REGISTERED'].includes(c.state) && (
            <div className="case-finished">✓ المعاملة مكتملة — المستندات جاهزة للطباعة من القائمة أدناه.</div>
          )}
          {work && c.state !== 'CANCELLED' && (next || c.state === 'DRAFT') && (
            <div className="panel next-step big" data-tour="next">
              {next && (
                <>
                  <p>
                    <b>الخطوة التالية:</b> {NEXT_HELP[next.key]}
                  </p>
                  <button className="primary-lg" onClick={() => w.open((d as Row)[next.key])}>
                    {next.label} ←
                  </button>
                </>
              )}
              <div className="row">
                {c.state === 'DRAFT' && !ministry && c.quotes.length > 0 && (
                  <>
                    <button className="secondary" onClick={() => w.open(d.quotes)}>
                      ＋ إضافة عروض
                    </button>
                    <button className="secondary" onClick={() => w.print(w.root(`cases/${c.id}/report-print`))}>
                      معاينة التقرير
                    </button>
                  </>
                )}
                {c.state === 'EVALUATED' && (
                  <button disabled={w.busy} onClick={() => w.task(() => act('approve'), 'تم اعتماد التقرير')}>
                    اعتماد التقرير
                  </button>
                )}
                {c.state === 'APPROVED' && !ministry && (
                  <button
                    className="secondary"
                    onClick={() => w.open(simple('إعادة فتح تقرير العروض للتعديل', 'return', [{ name: 'reason', label: 'سبب التعديل' }]))}
                  >
                    تعديل تقرير العروض
                  </button>
                )}
                {['ORDERED', 'PARTIAL'].includes(c.state) && (
                  <button
                    className="secondary"
                    onClick={() =>
                      w.open(
                        simple('تمديد مدة التنفيذ', 'extend', [
                          { name: 'due', label: 'الموعد الجديد', type: 'date' },
                          { name: 'reason', label: 'سبب ومرجع التمديد' },
                        ]),
                      )
                    }
                  >
                    تمديد المدة
                  </button>
                )}
                {['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED'].includes(c.state) && !c.deliveries.length && (
                  <button
                    className="secondary danger"
                    onClick={() => w.open(simple('إلغاء المعاملة', 'cancel', [{ name: 'reason', label: 'سبب الإلغاء' }]))}
                  >
                    إلغاء المعاملة
                  </button>
                )}
              </div>
            </div>
          )}

          {!ministry && (
            <Panel
              title="تقرير عروض الأسعار"
              actions={
                work &&
                c.state === 'DRAFT' && (
                  <button className="secondary" onClick={() => w.open(d.quotes)}>
                    ＋ إدخال عروض
                  </button>
                )
              }
            >
              {c.quotes.length ? (
                <Table heads={['م', 'اسم الشركة', 'قيمة عرض السعر', 'رقم العرض', 'الرأي الفني', '']}>
                  {[...c.quotes]
                    .sort((a: Row, b: Row) => Number(a.total) - Number(b.total))
                    .map((q: Row, i: number) => (
                      <tr
                        key={q.id}
                        className={c.selectedQuoteId === q.id || (!c.selectedQuoteId && q.id === lowest?.id) ? 'selected' : ''}
                      >
                        <td>{i + 1}</td>
                        <td>
                          <b>{q.supplier.name}</b>
                          {q.id === lowest?.id && <small className="tag-best">الأقل سعراً</small>}
                          <PerformanceNote p={c.performance?.[q.supplier.id]} />
                        </td>
                        <td>
                          <b>{currency(q.total)}</b> <small>ر.ق</small>
                        </td>
                        <td>{q.reference || '—'}</td>
                        <td>{q.note || (q.compliant ? 'مطابق للمواصفات' : 'غير مطابق')}</td>
                        <td>
                          {work && c.state === 'DRAFT' && (
                            <button
                              className="link danger"
                              onClick={() =>
                                confirm('حذف عرض هذه الشركة؟') && w.task(() => act('quote-delete', { quoteId: q.id }), 'حُذف العرض')
                              }
                            >
                              حذف
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </Table>
              ) : (
                <Empty text="أدخل اسم كل شركة وقيمة عرضها" />
              )}
              {c.awardReason && <p>التوصية: {c.awardReason}</p>}
              {c.exclusiveReason && <p>مبرر الاحتكار: {c.exclusiveReason}</p>}
            </Panel>
          )}

          <Panel title="الأصناف">
            <Table heads={['الصنف', 'بند الموازنة', 'الكمية', 'سعر الوحدة', 'القيمة']}>
              {c.items.map((i: Row) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <small>{i.unit}</small>
                  </td>
                  <td>
                    {i.budget.code}
                    <small>{i.budget.name}</small>
                  </td>
                  <td>{i.qty}</td>
                  <td>{currency(i.unitPrice)}</td>
                  <td>{currency(i.value)}</td>
                </tr>
              ))}
            </Table>
            <div className="total">
              الإجمالي <b>{currency(c.total)} ر.ق</b>
            </div>
          </Panel>

          <Panel
            title="المرفقات (اختياري)"
            actions={
              work &&
              c.state !== 'CANCELLED' && (
                <button className="secondary" onClick={() => w.open(d.upload)}>
                  إرفاق مستند
                </button>
              )
            }
          >
            {c.evidence.length ? (
              <Table heads={['المستند', 'الملف', 'التاريخ', '']}>
                {c.evidence
                  .filter((e: Row) => e.status !== 'NA')
                  .map((e: Row) => (
                    <tr key={e.id}>
                      <td>{EVIDENCE[e.code] ?? e.code}</td>
                      <td>{e.name}</td>
                      <td>{day(e.createdAt)}</td>
                      <td>
                        <button className="link" onClick={async () => downloadFile(await w.api(w.root('evidence/' + e.id)))}>
                          تنزيل
                        </button>
                      </td>
                    </tr>
                  ))}
              </Table>
            ) : (
              <p>يمكن إرفاق عروض الأسعار والفاتورة وسندات الاستلام ونسخ المستندات الموقعة للرجوع إليها.</p>
            )}
          </Panel>

          <FileCheckPanel c={c} work={work} />

          <ApprovalPanel c={c} />

          <CaseReturnsPanel c={c} />
        </div>

        <div className="case-side">
          <div className="panel">
            <h2>مستندات المعاملة</h2>
            {docs.map((x) => (
              <div key={x.n} className={'side-doc' + (x.ready ? ' ready' : '')}>
                <div className="side-doc-head">
                  <span className="dot">{x.ready ? '✓' : x.n}</span>
                  <b>{x.name}</b>
                </div>
                {x.ready && x.path ? (
                  <DocButtons link path={x.path} label="" />
                ) : x.action && work ? (
                  <button className="side-action" onClick={() => w.open(x.action!)}>
                    {x.actionLabel} ←
                  </button>
                ) : (
                  <small>{x.hint}</small>
                )}
              </div>
            ))}
            {(c.orderHtml || c.evaluationHtml) && (
              <button
                className="side-action"
                title="فهرس + كل المستندات الصادرة والمرفقة بترتيب التدقيق في ملف PDF واحد"
                onClick={() => w.task(async () => downloadFile(await w.api(w.root(`cases/${c.id}/bundle`))), 'جُهّز ملف المعاملة المجمّع')}
              >
                ⬇ ملف المعاملة المجمّع (PDF)
              </button>
            )}
            {cert && (
              <div className="side-money">
                <span>الصافي المستحق</span>
                <b>{currency(cert.net)} ر.ق</b>
                <small>
                  القيمة {currency(cert.gross)} — الغرامة {currency(cert.fine)}
                </small>
              </div>
            )}
          </div>
          <div className="panel">
            <h2>ERP</h2>
            {c.erp ? (
              <p>
                مسجلة بالرقم <b>{c.erp.reference}</b> بتاريخ {day(c.erp.date)}.
              </p>
            ) : (
              <p>بعد إصدار الشهادة سجّل المعاملة في نظام الوزارة ثم دوّن رقم القيد هنا.</p>
            )}
            <a className="erp-link" href={ERP_URL} target="_blank" rel="noopener noreferrer">
              فتح نظام ERP الوزارة ↗
            </a>
            {work && ['CERTIFIED', 'COMPLETE'].includes(c.state) && !c.erp && (
              <button
                className="secondary"
                onClick={() =>
                  w.open(
                    simple('تسجيل رقم القيد في ERP', 'erp', [
                      { name: 'reference', label: 'رقم القيد في ERP' },
                      { name: 'date', label: 'تاريخ التسجيل', type: 'date', value: dateNow() },
                      { name: 'evidence', label: 'ملاحظة / مرجع الإثبات', value: 'تسجيل يدوي' },
                    ]),
                  )
                }
              >
                تسجيل رقم القيد
              </button>
            )}
          </div>
          {w.me.user.isTenantAdmin && (
            <div className="panel">
              <h2>مدير النظام</h2>
              <button
                className="secondary danger"
                onClick={() =>
                  w.open({
                    title: 'حذف المعاملة نهائياً',
                    intro: <p className="warn">تُحذف المعاملة وكل مستنداتها، وتُعاد مبالغها إلى أرصدة بنود الموازنة. لا يمكن التراجع.</p>,
                    fields: [{ name: 'confirm', label: 'اكتب كلمة «حذف» للتأكيد' }],
                    submit: 'حذف نهائي',
                    save: async (v) => {
                      await w.api('admin/purge', 'POST', { scope: 'case', id: c.id, confirm: v.confirm });
                      w.go('cases');
                    },
                  })
                }
              >
                حذف المعاملة نهائياً
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** The supplier's delivery record next to its quotation: late deliveries, penalties, files sent back. */
function PerformanceNote({ p }: { p?: Row }) {
  if (!p) return null;
  const tone = p.rating === 'POOR' ? 'danger' : p.rating === 'WATCH' ? 'warn-text' : 'muted';
  return (
    <small className={tone} title="من شهادات الإنجاز السابقة والحالية">
      {p.rating === 'POOR' ? '⚠ ' : ''}
      تأخر في {p.late} من {p.files} ({p.lateRate}%){p.returns ? ` — مرتجعات ${p.returns}` : ''}
    </small>
  );
}

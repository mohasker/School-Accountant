'use client';
import { useWorkspace } from '../components/context';
import type { Dialog, Field } from '../components/FormDialog';
import { Badge, DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, downloadFile, EVIDENCE, EVIDENCE_ORDER, METHOD_NAMES, readBase64 } from '../lib/format';

const STEPS = ['مسودة وعروض', 'دراسة واعتماد', 'تكليف', 'توريد', 'شهادة وتغطية', 'ERP'];
const STEP_OF: Row = {
  DRAFT: 0,
  EVALUATED: 1,
  APPROVED: 1,
  ORDERED: 2,
  PARTIAL: 3,
  DELIVERED: 3,
  CERTIFIED: 4,
  COMPLETE: 4,
  REGISTERED: 5,
};

const RATING_OPTIONS = [
  { value: 'EXCELLENT', label: 'ممتاز' },
  { value: 'AVERAGE', label: 'متوسط' },
  { value: 'POOR', label: 'رديء' },
];
const ADDRESSEES = [
  { value: '1', label: 'إدارة الشؤون المالية' },
  { value: '2', label: 'إدارة الخدمات العامة' },
  { value: '3', label: 'إدارة المشتريات والمناقصات' },
];
const COVER_ATTACHMENTS: [string, string, number?][] = [
  ['invoice', 'فاتورة بالمبلغ المستحق (أصل)', 6],
  ['order', 'كتاب التكليف الصادر إلى الشركة', 5],
  ['supplierReceipt', 'سند الاستلام من الشركة معتمد من المدرسة', 7],
  ['schoolReceipt', 'سند الاستلام من المدرسة معتمد', 8],
  ['iban', 'صورة IBAN', 10],
  ['quoteReport', 'تقرير عروض الأسعار معتمد', 4],
  ['quotes', 'عروض الأسعار للشركات المختلفة', 2],
  ['crs', 'السجلات التجارية للشركات', 3],
  ['deptApproval', 'موافقة القسم المختص بالوزارة', 11],
  ['undertaking', 'التعهد (الإقرار) بعدم التابعية', 9],
  ['localPo', 'أمر شراء محلي (إدارة المشتريات والمناقصات)'],
  ['beneficiaries', 'كشوف بيانات المستفيدين بالهدايا', 12],
  ['procurementApproval', 'موافقة إدارة المشتريات على أمر التوريد', 15],
];

export function CaseDetail({ id }: { id: string }) {
  const w = useWorkspace();
  const [c] = useLoad<Row>(() => w.api(w.root('cases/' + id)), [id]);
  if (!c) return <p>جارٍ التحميل…</p>;
  const policy = w.setup.policy || {};
  const act = (action: string, body: Row = {}) => w.api(w.root(`cases/${c.id}/${action}`), 'POST', body);
  const simple = (title: string, action: string, fields: Field[], extra: Row = {}): Dialog => ({
    title,
    fields,
    save: (v) => act(action, { ...v, ...extra }),
  });
  const suppliers = (w.setup.suppliers || []).filter((s: Row) => s.active).map((s: Row) => ({ value: s.id, label: s.name }));
  const verified = new Set(c.evidence.filter((e: Row) => e.status === 'VERIFIED').map((e: Row) => e.code));
  const step = STEP_OF[c.state] ?? 0;

  const quoteDialog = (direct: boolean): Dialog => ({
    title: direct ? 'إدخال أسعار التكليف الوزاري' : 'إضافة عرض سعر',
    wide: true,
    fields: [
      { name: 'supplierId', label: 'المورد', type: 'select', options: suppliers },
      ...(!direct
        ? ([
            { name: 'reference', label: 'رقم عرض السعر' },
            { name: 'quoteDate', label: 'تاريخ عرض السعر', type: 'date', value: dateNow() },
            {
              name: 'compliant',
              label: 'مطابق للمواصفات',
              type: 'select',
              options: [
                { value: 'true', label: 'نعم' },
                { value: 'false', label: 'لا' },
              ],
            },
            { name: 'note', label: 'الرأي الفني / سبب الاستبعاد', required: false },
          ] as Field[])
        : [{ name: 'reason', label: 'مرجع اعتماد الأسعار من الوزارة' }]),
    ],
    body: (
      <>
        <h3>سعر الوحدة لكل صنف</h3>
        {c.items.map((i: Row) => (
          <label key={i.id}>
            {i.name} — الكمية {i.qty} {i.unit}
            <input name={'price_' + i.id} type="number" min="0.01" step="0.01" placeholder="سعر الوحدة" required />
          </label>
        ))}
      </>
    ),
    save: (v, fd) =>
      act(direct ? 'direct-order' : 'quotes', {
        ...v,
        ...(!direct ? { compliant: v.compliant === 'true' } : {}),
        prices: c.items.map((i: Row) => ({ itemId: i.id, price: String(fd.get('price_' + i.id)) })),
      }),
  });

  const evaluateDialog: Dialog = {
    title: 'اختيار العرض وإعداد تقرير الدراسة',
    intro: (
      <p>
        حتى {currency(policy.singleQuoteLimit)} ر.ق يكفي عرض واحد. ما يزيد يتطلب {policy.minQuotes} عروض على الأقل (المسجل الآن:{' '}
        {c.quotes.length})، أو ذكر مبرر احتكار المورد للصنف.
      </p>
    ),
    fields: [
      {
        name: 'quoteId',
        label: 'العرض المختار',
        type: 'select',
        options: c.quotes
          .filter((q: Row) => q.compliant)
          .map((q: Row) => ({ value: q.id, label: q.supplier.name + ' — ' + currency(q.total) })),
      },
      { name: 'reason', label: 'مبرر الاختيار', value: 'الأقل سعراً والمطابق للمواصفات' },
      { name: 'exclusiveReason', label: 'مبرر احتكار المورد (عند وجود عرض واحد فوق الحد)', required: false },
    ],
    save: (v) =>
      act('evaluate', { quoteId: v.quoteId, reason: v.reason, ...(v.exclusiveReason ? { exclusiveReason: v.exclusiveReason } : {}) }),
  };

  const issueDialog: Dialog = {
    title: 'إصدار كتاب التكليف',
    intro: <p>مدة التوريد بأيام العمل (الأحد – الخميس) مع استبعاد الإجازات الرسمية المسجلة. يوم الإصدار لا يُحتسب.</p>,
    fields: [
      { name: 'trigger', label: 'تاريخ كتاب التكليف', type: 'date', value: dateNow() },
      { name: 'days', label: 'مدة التوريد (أيام عمل)', type: 'number', step: '1', min: '1', value: policy.defaultDeliveryDays ?? 15 },
      ...(c.origin === 'SCHOOL'
        ? [{ name: 'orderNumber', label: 'رقم أمر الشراء (اتركه فارغاً للترقيم التلقائي)', required: false } as Field]
        : []),
    ],
    save: (v) =>
      act('issue', {
        trigger: v.trigger,
        days: Number(v.days),
        policyConfirmed: true,
        ...(v.orderNumber ? { orderNumber: v.orderNumber } : {}),
      }),
  };

  const deliverDialog: Dialog = {
    title: 'تسجيل توريد واستلام',
    wide: true,
    fields: [
      { name: 'date', label: 'تاريخ التوريد الفعلي', type: 'date', value: dateNow() },
      { name: 'note', label: 'رقم إذن التسليم' },
      { name: 'invoice', label: 'رقم الفاتورة' },
    ],
    body: (
      <>
        <p>سجّل المقبول فقط؛ الفرق بين المستلم والمقبول يظل غير منجز. التأخير يُحسب بأيام العمل بعد {day(c.dueDate)}.</p>
        {c.items.map((i: Row) => (
          <div className="item-form delivery" key={i.id}>
            <b>
              {i.name}
              <small>المتبقي {Number(i.qty) - Number(i.acceptedQty)}</small>
            </b>
            <label>
              المستلم
              <input name={'received_' + i.id} type="number" min="0" step="0.001" defaultValue={Number(i.qty) - Number(i.acceptedQty)} />
            </label>
            <label>
              المقبول
              <input name={'accepted_' + i.id} type="number" min="0" step="0.001" defaultValue={Number(i.qty) - Number(i.acceptedQty)} />
            </label>
          </div>
        ))}
      </>
    ),
    save: (v, fd) =>
      act('deliver', {
        ...v,
        lines: c.items
          .map((i: Row) => ({
            itemId: i.id,
            received: String(fd.get('received_' + i.id) || '0'),
            accepted: String(fd.get('accepted_' + i.id) || '0'),
          }))
          .filter((l: Row) => Number(l.received) > 0),
      }),
  };

  const certificateDialog: Dialog = {
    title: 'إصدار شهادة إنجاز أعمال',
    wide: true,
    fields: [
      {
        name: 'kind',
        label: 'نوع الشهادة',
        type: 'select',
        options: c.state === 'DELIVERED' ? [{ value: 'FINAL', label: 'نهائية' }] : [{ value: 'PARTIAL', label: 'جزئية' }],
      },
      { name: 'date', label: 'تاريخ الشهادة', type: 'date', value: dateNow() },
      { name: 'addressee', label: 'موجهة إلى', type: 'select', options: ADDRESSEES },
      { name: 'invoice', label: 'رقم الفاتورة (افتراضياً من التوريدات)', required: false },
      { name: 'scope', label: 'الالتزام بنطاق العمل', type: 'select', options: RATING_OPTIONS },
      { name: 'time', label: 'الالتزام بالمدة الزمنية', type: 'select', options: RATING_OPTIONS },
      { name: 'supervision', label: 'الالتزام بتعليمات جهة الإشراف', type: 'select', options: RATING_OPTIONS },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', required: false },
    ],
    save: (v) =>
      act('certificate', {
        kind: v.kind,
        date: v.date,
        addressee: Number(v.addressee),
        ...(v.invoice ? { invoice: v.invoice } : {}),
        notes: v.notes,
        ratings: { scope: v.scope, time: v.time, supervision: v.supervision },
      }),
  };

  const coverDialog = (cert: Row): Dialog => ({
    title: 'كتاب التغطية — صرف مستحقات الشركة',
    intro: <p>حدد المرفقات التي ستُرسل مع الكتاب. شهادة إنجاز الأعمال مرفقة دائماً.</p>,
    fields: [{ name: 'date', label: 'تاريخ الكتاب', type: 'date', value: dateNow() }],
    body: (
      <div className="check-grid">
        {COVER_ATTACHMENTS.map(([key, label, code]) => (
          <label key={key} className="check">
            <input type="checkbox" name={'att_' + key} defaultChecked={code ? verified.has(code) : false} />
            {label}
          </label>
        ))}
      </div>
    ),
    save: (v, fd) =>
      act('cover', {
        certificateId: cert.id,
        date: v.date,
        attachments: COVER_ATTACHMENTS.map(([k]) => k).filter((k) => fd.get('att_' + k) === 'on'),
      }),
  });

  const uploadDialog: Dialog = {
    title: 'رفع مستند مؤيد',
    fields: [
      {
        name: 'code',
        label: 'نوع المستند',
        type: 'select',
        options: EVIDENCE_ORDER.map((code) => ({ value: String(code), label: `${code}. ${EVIDENCE[code]}` })),
      },
      {
        name: 'certificateId',
        label: 'الشهادة المرتبطة — للنسخ الموقعة فقط',
        type: 'select',
        required: false,
        options: [{ value: '', label: 'غير مرتبط' }, ...c.certificates.map((x: Row) => ({ value: x.id, label: x.number }))],
      },
    ],
    body: (
      <label>
        PDF أو PNG أو JPEG حتى 5 MB
        <input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required />
      </label>
    ),
    save: async (v, fd) => {
      const file = fd.get('file') as File;
      await act('evidence', {
        code: Number(v.code),
        ...(v.certificateId ? { certificateId: v.certificateId } : {}),
        name: file.name,
        mime: file.type,
        base64: await readBase64(file),
      });
    },
  };

  return (
    <>
      <div className="case-top">
        <Badge state={c.state} />
        <b className="mono">{c.number}</b>
        <span>{c.subject}</span>
        <span>المصدر: {c.origin === 'MINISTRY' ? 'الوزارة' : 'مشتريات المدرسة'}</span>
        {c.method && <span>الطريقة: {METHOD_NAMES[c.method]}</span>}
        <span>المورد: {c.supplier?.name || '—'}</span>
        {c.orderNumber && <span className="mono">أمر الشراء: {c.orderNumber}</span>}
        {c.dueDate && (
          <span>
            آخر موعد: {day(c.dueDate)} ({c.deliveryDays} يوم عمل)
          </span>
        )}
      </div>
      <div className="stepper">
        {STEPS.map((s, i) => (
          <div key={s} className={c.state === 'CANCELLED' ? '' : i < step ? 'done' : i === step ? 'current' : ''}>
            <b>{i + 1}</b>
            {s}
          </div>
        ))}
      </div>
      <div className="actions panel">
        {c.state === 'DRAFT' && w.can('ACCOUNTANT') && (
          <button onClick={() => w.open(quoteDialog(c.origin === 'MINISTRY'))}>
            {c.origin === 'MINISTRY' ? 'إدخال أسعار التكليف الوزاري' : 'إضافة عرض سعر'}
          </button>
        )}
        {c.state === 'DRAFT' && c.quotes.length > 0 && c.origin === 'SCHOOL' && w.can('ACCOUNTANT') && (
          <button onClick={() => w.open(evaluateDialog)}>اختيار العرض وإعداد التقرير</button>
        )}
        {c.state === 'EVALUATED' && c.origin === 'SCHOOL' && (
          <button className="secondary" onClick={() => w.print(w.root(`cases/${c.id}/report-print`))}>
            معاينة تقرير الدراسة
          </button>
        )}
        {c.state === 'EVALUATED' && w.can('APPROVER') && (
          <>
            <button disabled={w.busy} onClick={() => w.task(() => act('approve'), 'تم الاعتماد')}>
              اعتماد
            </button>
            <button
              className="secondary"
              onClick={() => w.open(simple('إرجاع للتصحيح', 'return', [{ name: 'reason', label: 'سبب الإرجاع' }]))}
            >
              إرجاع
            </button>
          </>
        )}
        {c.state === 'APPROVED' && w.can('ACCOUNTANT') && <button onClick={() => w.open(issueDialog)}>إصدار كتاب التكليف</button>}
        {['ORDERED', 'PARTIAL'].includes(c.state) && w.can('ACCOUNTANT') && (
          <button onClick={() => w.open(deliverDialog)}>تسجيل توريد</button>
        )}
        {['PARTIAL', 'DELIVERED'].includes(c.state) && w.can('APPROVER') && (
          <button onClick={() => w.open(certificateDialog)}>إصدار شهادة إنجاز</button>
        )}
        {c.state === 'CERTIFIED' && w.can('APPROVER') && (
          <button disabled={w.busy} onClick={() => w.task(() => act('complete'))}>
            تأكيد اكتمال الملف
          </button>
        )}
        {c.state === 'COMPLETE' && w.can('ERP') && (
          <button
            onClick={() =>
              w.open(
                simple('إثبات التسجيل في ERP', 'erp', [
                  { name: 'reference', label: 'رقم القيد الوزاري' },
                  { name: 'date', label: 'تاريخ التسجيل', type: 'date', value: dateNow() },
                  { name: 'evidence', label: 'مرجع إثبات التسجيل' },
                ]),
              )
            }
          >
            تسجيل ERP
          </button>
        )}
        {c.evaluationHtml && <DocButtons path={w.root(`cases/${c.id}/report-print`)} label="تقرير الدراسة" />}
        {c.orderHtml && <DocButtons path={w.root(`cases/${c.id}/order-print`)} label="كتاب التكليف" />}
        {['ORDERED', 'PARTIAL'].includes(c.state) && w.can('APPROVER') && (
          <button
            className="secondary"
            onClick={() =>
              w.open(
                simple('تمديد معتمد لموعد التوريد', 'extend', [
                  { name: 'due', label: 'الموعد الجديد', type: 'date' },
                  { name: 'reason', label: 'سبب ومرجع التمديد' },
                ]),
              )
            }
          >
            تمديد المدة
          </button>
        )}
        {['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED'].includes(c.state) && w.can('APPROVER') && (
          <button
            className="secondary danger"
            onClick={() => w.open(simple('إلغاء المعاملة', 'cancel', [{ name: 'reason', label: 'سبب الإلغاء' }]))}
          >
            إلغاء
          </button>
        )}
      </div>

      <Panel title="الأصناف">
        <Table heads={['الصنف', 'بند الموازنة', 'الكمية', 'سعر الوحدة', 'المقبول', 'المعتمد بشهادات', 'القيمة']}>
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
              <td>{i.acceptedQty}</td>
              <td>{i.certifiedQty}</td>
              <td>{currency(i.value)}</td>
            </tr>
          ))}
        </Table>
        <div className="total">
          إجمالي التكليف <b>{currency(c.total)} ر.ق</b>
        </div>
      </Panel>

      {!!c.quotes.length && (
        <Panel title="عروض الأسعار">
          <Table heads={['المورد', 'رقم العرض', 'التاريخ', 'القيمة', 'المطابقة', 'الرأي الفني']}>
            {c.quotes.map((q: Row) => (
              <tr key={q.id} className={c.selectedQuoteId === q.id ? 'selected' : ''}>
                <td>{q.supplier.name}</td>
                <td>{q.reference}</td>
                <td>{day(q.quoteDate)}</td>
                <td>{currency(q.total)}</td>
                <td>{q.compliant ? 'مطابق' : 'غير مطابق'}</td>
                <td>{q.note || '—'}</td>
              </tr>
            ))}
          </Table>
          {c.awardReason && <p>مبرر الاختيار: {c.awardReason}</p>}
          {c.exclusiveReason && <p>مبرر الاحتكار: {c.exclusiveReason}</p>}
        </Panel>
      )}

      <Panel title="سجل التوريدات">
        {c.deliveries.length ? (
          <Table heads={['التاريخ', 'إذن التسليم', 'الفاتورة', 'المقبول والتأخير (أيام عمل)']}>
            {c.deliveries.map((d: Row) => (
              <tr key={d.id}>
                <td>{day(d.date)}</td>
                <td>{d.note}</td>
                <td>{d.invoice}</td>
                <td>
                  {d.portions.map((r: Row) => (
                    <div key={r.id}>
                      {c.items.find((i: Row) => i.id === r.itemId)?.name}: {r.accepted} — {r.lateDays} يوم تأخير — {currency(r.value)} ر.ق
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لم تُسجّل توريدات بعد" />
        )}
      </Panel>

      <Panel
        title="المستندات المؤيدة"
        actions={w.can('ACCOUNTANT') && c.state !== 'REGISTERED' && <button onClick={() => w.open(uploadDialog)}>رفع مستند</button>}
      >
        <p>تُراجع المستندات قبل الشهادة بواسطة مستخدم غير رافعها. النسخ الموقعة للشهادة والتغطية تُستكمل بعدها.</p>
        <div className="docs-grid">
          {EVIDENCE_ORDER.map((code) => {
            const files = c.evidence.filter((e: Row) => e.code === code);
            const rule = c.checklist.find((x: Row) => x.code === code);
            return (
              <div className="doc" key={code}>
                <div>
                  <b>
                    {code}. {EVIDENCE[code]}
                  </b>
                  <span>{files.some((f: Row) => ['VERIFIED', 'NA'].includes(f.status)) ? '✓' : '○'}</span>
                </div>
                {files.map((f: Row) => (
                  <div key={f.id}>
                    <small>
                      {f.name} — <Badge state={f.status} />
                    </small>
                    <div className="actions">
                      {f.status !== 'NA' && (
                        <button className="link" onClick={async () => downloadFile(await w.api(w.root('evidence/' + f.id)))}>
                          تنزيل
                        </button>
                      )}
                      {w.can('REVIEWER', 'APPROVER') && f.status === 'PENDING' && (
                        <button
                          className="link"
                          onClick={() =>
                            w.open(
                              simple(
                                'مراجعة المستند',
                                'verify',
                                [
                                  {
                                    name: 'decision',
                                    label: 'القرار',
                                    type: 'select',
                                    options: [
                                      { value: 'VERIFIED', label: 'تم التحقق' },
                                      { value: 'REJECTED', label: 'مرفوض' },
                                    ],
                                  },
                                  { name: 'reason', label: 'ملاحظة المراجعة' },
                                ],
                                { evidenceId: f.id },
                              ),
                            )
                          }
                        >
                          مراجعة
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!files.length && <small>لم يُرفق مستند</small>}
                {w.can('APPROVER') && rule?.waivable && !rule.complete && (
                  <button
                    className="link"
                    onClick={() =>
                      w.open(simple('تسجيل عدم الانطباق', 'not-applicable', [{ name: 'reason', label: 'السبب والمرجع' }], { code }))
                    }
                  >
                    لا ينطبق
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="شهادات الإنجاز وكتب التغطية">
        {c.certificates.length ? (
          <Table heads={['الشهادة', 'القيمة', 'الغرامة', 'الصافي', 'المستندات']}>
            {c.certificates.map((x: Row) => (
              <tr key={x.id}>
                <td>
                  {x.number}
                  <small>{x.kind === 'FINAL' ? 'نهائية' : 'جزئية'}</small>
                </td>
                <td>{currency(x.gross)}</td>
                <td>{currency(x.fine)}</td>
                <td>{currency(x.net)}</td>
                <td>
                  <div className="actions">
                    <DocButtons link path={w.root('certificates/' + x.id)} label="الشهادة" />
                    {x.coverHtml ? (
                      <DocButtons link path={w.root(`certificates/${x.id}/cover`)} label="كتاب التغطية" />
                    ) : (
                      w.can('ACCOUNTANT') && (
                        <button className="link" onClick={() => w.open(coverDialog(x))}>
                          إعداد كتاب التغطية
                        </button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لم تصدر شهادات بعد" />
        )}
        {c.erp && (
          <div className="success">
            مسجلة في النظام الوزاري بالمرجع {c.erp.reference} بتاريخ {day(c.erp.date)}. إثبات يدوي، وليس اتصالاً مباشراً بالنظام الوزاري.
          </div>
        )}
      </Panel>
    </>
  );
}

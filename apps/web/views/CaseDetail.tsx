'use client';
import { useWorkspace } from '../components/context';
import type { Dialog, Field } from '../components/FormDialog';
import { Badge, DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, dateNow, day, downloadFile, EVIDENCE, EVIDENCE_ORDER, METHOD_NAMES, readBase64 } from '../lib/format';

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
const ADDRESSEES = [
  { value: '1', label: 'إدارة الشؤون المالية' },
  { value: '2', label: 'إدارة الخدمات العامة' },
  { value: '3', label: 'إدارة المشتريات والمناقصات' },
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
  const work = w.can('ACCOUNTANT');
  const step = STEP_OF[c.state] ?? 0;
  const ministry = c.origin === 'MINISTRY';
  const lowest = [...c.quotes].filter((q: Row) => q.compliant).sort((a: Row, b: Row) => Number(a.total) - Number(b.total))[0];

  const companies = (
    <datalist id="companies">
      {(w.setup.suppliers || []).map((s: Row) => (
        <option key={s.id} value={s.name} />
      ))}
    </datalist>
  );

  const quoteDialog: Dialog = {
    title: ministry ? 'أسعار التكليف الوزاري' : 'إضافة عرض سعر شركة',
    wide: true,
    intro: ministry ? undefined : (
      <p>اكتب اسم الشركة كما في عرض السعر (أو اختره من القائمة). تُضاف الشركة الجديدة إلى دليل الموردين تلقائياً.</p>
    ),
    fields: [
      { name: 'supplierName', label: 'اسم الشركة', list: 'companies' },
      ...(ministry
        ? [{ name: 'reason', label: 'مرجع اعتماد الأسعار من الوزارة' } as Field]
        : ([
            { name: 'reference', label: 'رقم عرض السعر', required: false },
            { name: 'quoteDate', label: 'تاريخ عرض السعر', type: 'date', value: dateNow() },
            {
              name: 'compliant',
              label: 'مطابق للمواصفات',
              type: 'select',
              options: [
                { value: 'true', label: 'نعم' },
                { value: 'false', label: 'لا — مستبعد' },
              ],
            },
            { name: 'note', label: 'الرأي الفني (اختياري؛ إلزامي للمستبعد)', required: false },
          ] as Field[])),
    ],
    body: (
      <>
        {companies}
        <h3>{c.items.length > 1 ? 'سعر الوحدة لكل صنف' : 'سعر الوحدة'}</h3>
        {c.items.map((i: Row) => (
          <label key={i.id}>
            {i.name} — الكمية {i.qty} {i.unit}
            <input name={'price_' + i.id} type="number" min="0.01" step="0.01" placeholder="سعر الوحدة (ر.ق)" required />
          </label>
        ))}
      </>
    ),
    save: (v, fd) =>
      act(ministry ? 'direct-order' : 'quotes', {
        ...v,
        ...(!ministry ? { compliant: v.compliant === 'true' } : {}),
        ...(!ministry && !v.reference ? { reference: '' } : {}),
        prices: c.items.map((i: Row) => ({ itemId: i.id, price: String(fd.get('price_' + i.id)) })),
      }),
  };

  const overLimit = lowest && Number(lowest.total) > Number(policy.singleQuoteLimit);
  const reportDialog: Dialog = {
    title: 'إصدار تقرير عروض الأسعار',
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
    submit: 'إصدار التقرير',
    save: (v) => act('evaluate', { date: v.date, ...(v.exclusiveReason ? { exclusiveReason: v.exclusiveReason } : {}) }),
  };

  const issueDialog: Dialog = {
    title: 'إصدار كتاب التكليف',
    intro: <p>مدة التنفيذ بأيام العمل (الأحد – الخميس) مع استبعاد الإجازات الرسمية المسجلة؛ يوم الإصدار لا يُحتسب.</p>,
    fields: [
      { name: 'trigger', label: 'تاريخ كتاب التكليف', type: 'date', value: dateNow() },
      { name: 'days', label: 'مدة التنفيذ (أيام عمل)', type: 'number', step: '1', min: '1', value: policy.defaultDeliveryDays ?? 15 },
      ...(!ministry ? [{ name: 'orderNumber', label: 'رقم أمر الشراء (فارغ = ترقيم تلقائي)', required: false } as Field] : []),
    ],
    submit: 'إصدار التكليف',
    save: (v) =>
      act('issue', {
        trigger: v.trigger,
        days: Number(v.days),
        policyConfirmed: true,
        ...(v.orderNumber ? { orderNumber: v.orderNumber } : {}),
      }),
  };

  const finishDialog: Dialog = {
    title: 'إصدار شهادة الإنجاز وكتاب التغطية',
    wide: true,
    intro: (
      <p>
        بعد إتمام المعاملة: تاريخ الإنجاز الفعلي يُقارن بآخر موعد ({day(c.dueDate)}) بأيام العمل، وتُحسب الغرامة تلقائياً إن وجد تأخير. يصدر
        كتاب التغطية مع الشهادة مباشرة.
      </p>
    ),
    fields: [
      { name: 'completionDate', label: 'تاريخ الإنجاز / التوريد الفعلي', type: 'date', value: dateNow() },
      { name: 'invoice', label: 'رقم فاتورة الشركة' },
      { name: 'date', label: 'تاريخ الشهادة وكتاب التغطية', type: 'date', value: dateNow() },
      { name: 'addressee', label: 'الشهادة موجهة إلى', type: 'select', options: ADDRESSEES },
      { name: 'scope', label: 'الالتزام بنطاق العمل', type: 'select', options: RATING_OPTIONS },
      { name: 'time', label: 'الالتزام بالمدة الزمنية', type: 'select', options: RATING_OPTIONS },
      { name: 'supervision', label: 'الالتزام بتعليمات جهة الإشراف', type: 'select', options: RATING_OPTIONS },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', required: false },
    ],
    body: (
      <>
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
    save: (v, fd) =>
      act('finish', {
        completionDate: v.completionDate,
        invoice: v.invoice,
        date: v.date,
        addressee: Number(v.addressee),
        notes: v.notes,
        ratings: { scope: v.scope, time: v.time, supervision: v.supervision },
        attachments: ['certificate', ...COVER_ATTACHMENTS.map(([k]) => k).filter((k) => fd.get('att_' + k) === 'on')],
      }),
  };

  const uploadDialog: Dialog = {
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

  const cert = c.certificates.at(-1);
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

      {work && c.state !== 'CANCELLED' && (
        <div className="actions panel">
          {c.state === 'DRAFT' && (
            <>
              <button onClick={() => w.open(quoteDialog)}>{ministry ? 'إدخال أسعار التكليف الوزاري' : '＋ إضافة عرض سعر شركة'}</button>
              {!ministry && c.quotes.length > 0 && (
                <>
                  <button onClick={() => w.open(reportDialog)}>إصدار تقرير عروض الأسعار ←</button>
                  <button className="secondary" onClick={() => w.print(w.root(`cases/${c.id}/report-print`))}>
                    معاينة التقرير
                  </button>
                </>
              )}
            </>
          )}
          {c.state === 'EVALUATED' && (
            <button disabled={w.busy} onClick={() => w.task(() => act('approve'), 'تم اعتماد التقرير')}>
              اعتماد التقرير
            </button>
          )}
          {c.state === 'APPROVED' && (
            <>
              <button onClick={() => w.open(issueDialog)}>إصدار كتاب التكليف ←</button>
              {!ministry && (
                <button
                  className="secondary"
                  onClick={() => w.open(simple('إعادة فتح تقرير العروض للتعديل', 'return', [{ name: 'reason', label: 'سبب التعديل' }]))}
                >
                  تعديل تقرير العروض
                </button>
              )}
            </>
          )}
          {['ORDERED', 'PARTIAL', 'DELIVERED'].includes(c.state) && (
            <>
              <button onClick={() => w.open(finishDialog)}>إصدار شهادة الإنجاز وكتاب التغطية ←</button>
              {c.state !== 'DELIVERED' && (
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
            </>
          )}
          {['CERTIFIED', 'COMPLETE'].includes(c.state) && (
            <button
              className="secondary"
              onClick={() =>
                w.open(
                  simple('تسجيل المعاملة في ERP (اختياري)', 'erp', [
                    { name: 'reference', label: 'رقم القيد في ERP' },
                    { name: 'date', label: 'تاريخ التسجيل', type: 'date', value: dateNow() },
                    { name: 'evidence', label: 'ملاحظة / مرجع الإثبات', value: 'تسجيل يدوي' },
                  ]),
                )
              }
            >
              تسجيل رقم ERP
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
      )}

      <Panel title="مستندات المعاملة">
        <div className="doc-list">
          <div className={c.evaluationHtml ? 'ready' : ''}>
            <span>1</span>
            <b>تقرير عروض الأسعار</b>
            {c.evaluationHtml ? (
              <DocButtons link path={w.root(`cases/${c.id}/report-print`)} label="" />
            ) : (
              <small>{ministry ? 'لا يلزم للتكليف الوزاري' : 'يصدر بعد إدخال العروض'}</small>
            )}
          </div>
          <div className={c.orderHtml ? 'ready' : ''}>
            <span>2</span>
            <b>كتاب التكليف</b>
            {c.orderHtml ? <DocButtons link path={w.root(`cases/${c.id}/order-print`)} label="" /> : <small>بعد التقرير</small>}
          </div>
          <div className={cert ? 'ready' : ''}>
            <span>3</span>
            <b>شهادة الإنجاز</b>
            {cert ? <DocButtons link path={w.root('certificates/' + cert.id)} label="" /> : <small>بعد إتمام المعاملة</small>}
          </div>
          <div className={cert?.coverHtml ? 'ready' : ''}>
            <span>4</span>
            <b>كتاب التغطية</b>
            {cert?.coverHtml ? <DocButtons link path={w.root(`certificates/${cert.id}/cover`)} label="" /> : <small>يصدر مع الشهادة</small>}
          </div>
        </div>
        {cert && (
          <p>
            قيمة الأعمال {currency(cert.gross)} ر.ق — الغرامة {currency(cert.fine)} ر.ق — الصافي المستحق <b>{currency(cert.net)} ر.ق</b>
          </p>
        )}
        {c.erp && (
          <div className="success">
            مسجلة في ERP بالرقم {c.erp.reference} بتاريخ {day(c.erp.date)}.
          </div>
        )}
      </Panel>

      {!ministry && (
        <Panel title="عروض أسعار الشركات">
          {c.quotes.length ? (
            <Table heads={['م', 'اسم الشركة', 'رقم العرض', 'التاريخ', 'قيمة العرض', 'الرأي الفني', '']}>
              {[...c.quotes]
                .sort((a: Row, b: Row) => Number(a.total) - Number(b.total))
                .map((q: Row, i: number) => (
                  <tr key={q.id} className={c.selectedQuoteId === q.id || (!c.selectedQuoteId && q.id === lowest?.id) ? 'selected' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      {q.supplier.name}
                      {q.id === lowest?.id && <small>الأقل سعراً</small>}
                    </td>
                    <td>{q.reference || '—'}</td>
                    <td>{day(q.quoteDate)}</td>
                    <td>{currency(q.total)}</td>
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
            <Empty text="لم تُسجل عروض أسعار بعد — أضف عرض كل شركة" />
          )}
          {c.awardReason && <p>التوصية: {c.awardReason}</p>}
          {c.exclusiveReason && <p>مبرر الاحتكار: {c.exclusiveReason}</p>}
        </Panel>
      )}

      <Panel title="الأصناف">
        <Table heads={['الصنف', 'بند الموازنة', 'الكمية', 'سعر الوحدة', 'القيمة', 'المستلم']}>
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
              <td>{i.acceptedQty}</td>
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
            <button className="secondary" onClick={() => w.open(uploadDialog)}>
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

      {w.me.user.isTenantAdmin && (
        <Panel title="صلاحيات مدير النظام">
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
        </Panel>
      )}
    </>
  );
}

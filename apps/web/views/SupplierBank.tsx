'use client';
import { useState } from 'react';
import { useWorkspace } from '../components/context';
import type { Dialog } from '../components/FormDialog';
import { Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, day } from '../lib/format';

/** Full card of one supplier: legal data, bank data, every contact channel and a free note. */
export function cardFields(r?: Row) {
  return [
    { name: 'name', label: 'اسم المورد (كما يظهر في المستندات)', value: r?.name },
    { name: 'legalName', label: 'الاسم القانوني الكامل كما في السجل التجاري', value: r?.legalName, required: false },
    { name: 'nameEn', label: 'الاسم بالإنجليزية', value: r?.nameEn, required: false },
    { name: 'cr', label: 'رقم السجل التجاري', value: r?.cr, required: false },
    {
      name: 'crExpiry',
      label: 'تاريخ انتهاء السجل التجاري (تنبيه قبل 30 يوماً)',
      type: 'date' as const,
      value: r?.crExpiry ? String(r.crExpiry).slice(0, 10) : '',
      required: false,
    },
    { name: 'category', label: 'النشاط / التخصص (قرطاسية، صيانة، أثاث…)', value: r?.category, required: false },
    { name: 'contact', label: 'اسم مسؤول التواصل', value: r?.contact, required: false },
    { name: 'mobile', label: 'رقم الجوال', value: r?.mobile, required: false },
    { name: 'phone', label: 'هاتف المكتب', value: r?.phone, required: false },
    { name: 'email', label: 'البريد الإلكتروني', value: r?.email, required: false },
    { name: 'accountsEmail', label: 'بريد قسم الحسابات (للمستحقات)', value: r?.accountsEmail, required: false },
    { name: 'website', label: 'الموقع الإلكتروني', value: r?.website, required: false },
    { name: 'address', label: 'العنوان', value: r?.address, required: false },
    { name: 'bank', label: 'اسم البنك', value: r?.bank, required: false },
    { name: 'beneficiary', label: 'اسم المستفيد في البنك', value: r?.beneficiary, required: false },
    { name: 'iban', label: 'IBAN', value: r?.iban, required: false },
    {
      name: 'ibanVerified',
      label: 'تم التحقق من IBAN (خطاب بنكي أو تحويل ناجح)',
      type: 'checkbox' as const,
      value: r?.ibanVerified ?? false,
      required: false,
    },
    { name: 'note', label: 'ملاحظات (التزام، جودة، تنبيهات…)', value: r?.note, type: 'textarea' as const, required: false },
  ];
}

export function cardPayload(v: Record<string, unknown>, active = true) {
  const s = (k: string) => String(v[k] ?? '').trim();
  return {
    name: s('name'),
    legalName: s('legalName'),
    cr: s('cr'),
    category: s('category'),
    contact: s('contact'),
    mobile: s('mobile'),
    phone: s('phone'),
    email: s('email'),
    address: s('address'),
    bank: s('bank'),
    iban: s('iban'),
    note: s('note'),
    nameEn: s('nameEn'),
    crExpiry: s('crExpiry'),
    accountsEmail: s('accountsEmail'),
    website: s('website'),
    beneficiary: s('beneficiary'),
    ibanVerified: Boolean(v.ibanVerified),
    active,
  };
}

/**
 * The supplier bank: one card per company for all schools, with every contact channel, the bank
 * data and the company's history in the earlier certificates. A school picks its suppliers from here.
 */
export function SupplierBank() {
  const w = useWorkspace();
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [cards] = useLoad<Row[]>(() => w.api('admin/supplier-bank?' + new URLSearchParams({ q, all: all ? '1' : '0' })), [q, all]);
  const editor = w.can('ACCOUNTANT', 'ADMIN') || w.me.user.isTenantAdmin;
  const mine = new Set((w.setup.suppliers || []).map((s: Row) => s.cardId));

  const form = (r?: Row): Dialog => ({
    title: r ? 'تعديل بطاقة المورد' : 'إضافة مورد إلى البنك',
    intro: <p>البطاقة مشتركة بين كل المدارس؛ تعديل الاسم أو السجل أو IBAN أو التواصل ينعكس على نسخ المدارس.</p>,
    fields: cardFields(r),
    save: (v) => w.api('admin/supplier-bank' + (r ? '/' + r.id : ''), r ? 'PATCH' : 'POST', cardPayload(v, r ? r.active : true)),
  });

  const mergeDialog = (r: Row): Dialog => ({
    title: `دمج «${r.name}» في مورد آخر`,
    intro: (
      <p>
        تنتقل نسخ المدارس إلى المورد المختار، وتُكمَّل بياناته الفارغة من هذا المورد، ثم يُحذف هذا المورد. المستندات الصادرة تبقى كما صدرت.
        يُسجَّل الدمج في سجل التدقيق.
      </p>
    ),
    fields: [
      {
        name: 'into',
        label: 'المورد الذي يبقى',
        type: 'select',
        options: (cards ?? []).filter((x) => x.id !== r.id).map((x) => ({ value: x.id, label: x.name + (x.cr ? ` — ${x.cr}` : '') })),
      },
    ],
    submit: 'دمج',
    save: (v) => w.api('admin/supplier-bank/' + r.id + '/merge', 'POST', { into: v.into }),
  });
  return (
    <Panel
      title="بنك الموردين — كل الموردين وبيانات التواصل"
      actions={
        editor && (
          <>
            <button onClick={() => w.open(form())}>＋ مورد جديد</button>
            <button
              className="secondary"
              title="يضيف بطاقات الموردين الواردين في شيتي شهادة الإنجاز والتكليف الناقصة فقط"
              onClick={() =>
                w.task(async () => {
                  const r = await w.api('admin/supplier-bank/standard', 'POST', {});
                  if (!r.added) throw Error('كل موردي الشيتات موجودون في البنك بالفعل');
                }, 'أُضيفت بطاقات الموردين الناقصة')
              }
            >
              إضافة موردي الشيتات
            </button>
          </>
        )
      }
    >
      <div className="toolbar wrap">
        <input
          placeholder="ابحث بالاسم أو السجل أو الهاتف أو البريد أو النشاط"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> إظهار الموقوفين
        </label>
        <small>{cards ? `${cards.length} مورد` : ''}</small>
      </div>
      {!cards ? (
        <p>جارٍ التحميل…</p>
      ) : cards.length ? (
        <Table heads={['المورد', 'السجل التجاري', 'التواصل', 'البنك / IBAN', 'الشهادات السابقة', 'الأداء', 'المدارس', 'المستندات', '']}>
          {cards.map((r) => (
            <tr key={r.id} className={r.active ? '' : 'muted'}>
              <td>
                <b>{r.name}</b>
                {r.legalName && r.legalName !== r.name && <small>{r.legalName}</small>}
                {r.nameEn && <small>{r.nameEn}</small>}
                {r.category && <small>{r.category}</small>}
                {r.note && <small className="muted">{r.note}</small>}
              </td>
              <td>
                <span className="mono">{r.cr || '—'}</span>
                {r.crExpiry && (
                  <small className={r.crStatus === 'expired' ? 'danger' : r.crStatus === 'soon' ? 'warn-text' : ''}>
                    {r.crStatus === 'expired' ? '⚠ منتهٍ ' : r.crStatus === 'soon' ? '⚠ ينتهي قريباً ' : 'ساري حتى '}
                    {day(r.crExpiry)}
                  </small>
                )}
              </td>
              <td>
                {r.contact && <div>{r.contact}</div>}
                {r.mobile && <div className="mono">{r.mobile}</div>}
                {r.phone && <div className="mono">{r.phone}</div>}
                {r.email && (
                  <div>
                    <a href={'mailto:' + r.email}>{r.email}</a>
                  </div>
                )}
                {r.accountsEmail && (
                  <small>
                    الحسابات: <a href={'mailto:' + r.accountsEmail}>{r.accountsEmail}</a>
                  </small>
                )}
                {r.website && (
                  <small>
                    <a href={r.website.startsWith('http') ? r.website : 'https://' + r.website} target="_blank" rel="noreferrer">
                      {r.website}
                    </a>
                  </small>
                )}
                {r.address && <small>{r.address}</small>}
                {!r.contact && !r.mobile && !r.phone && !r.email && '—'}
              </td>
              <td>
                {r.bank && <div>{r.bank}</div>}
                {r.beneficiary && <small>المستفيد: {r.beneficiary}</small>}
                <span className="mono">{r.iban || '—'}</span>
                {r.iban && <small>{r.ibanVerified ? '✓ تم التحقق' : 'لم يُتحقق منه'}</small>}
                {r.pendingIban && (
                  <small className="warn-text">
                    بانتظار موافقة على IBAN جديد: <span className="mono">{r.pendingIban}</span>{' '}
                    {r.pendingBy !== w.me.user.id && editor && (
                      <>
                        <button
                          className="link"
                          onClick={() =>
                            w.task(
                              () => w.api('admin/supplier-bank/' + r.id + '/iban-decision', 'POST', { approve: true }),
                              'اعتُمد IBAN الجديد',
                            )
                          }
                        >
                          موافقة
                        </button>
                        <button
                          className="link danger"
                          onClick={() =>
                            w.task(
                              () => w.api('admin/supplier-bank/' + r.id + '/iban-decision', 'POST', { approve: false }),
                              'رُفض التغيير',
                            )
                          }
                        >
                          رفض
                        </button>
                      </>
                    )}
                  </small>
                )}
              </td>
              <td>
                {r.history ? (
                  <>
                    {r.history.count} شهادة — {currency(r.history.total)} ر.ق<small>آخرها {day(r.history.last)}</small>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {r.performance ? (
                  <span className={r.performance.rating === 'POOR' ? 'danger' : r.performance.rating === 'WATCH' ? 'warn-text' : ''}>
                    {r.performance.rating === 'POOR' ? 'ضعيف' : r.performance.rating === 'WATCH' ? 'يحتاج متابعة' : 'جيد'}
                    <small>
                      تأخر {r.performance.late}/{r.performance.files} — غرامات {currency(r.performance.fines)}
                      {r.performance.returns ? ` — مرتجعات ${r.performance.returns}` : ''}
                    </small>
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td>{r.schools || 0}</td>
              <td>
                {r.documents ? (
                  <button className="link" onClick={() => w.go('archive')} title="السجل التجاري والتعهدات والرخص في الأرشيف المشترك">
                    {r.documents} مستند
                  </button>
                ) : (
                  '—'
                )}
              </td>
              <td>
                <div className="actions">
                  {editor && w.school && !mine.has(r.id) && r.active && (
                    <button
                      className="link"
                      onClick={() => w.task(() => w.api(w.root('supplier-from-bank'), 'POST', { cardId: r.id }), 'أُضيف المورد إلى مدرستك')}
                    >
                      إضافة لمدرستي
                    </button>
                  )}
                  {editor && (
                    <button className="link" onClick={() => w.open(form(r))}>
                      تعديل
                    </button>
                  )}
                  {w.me.user.isTenantAdmin && (
                    <button className="link" onClick={() => w.open(mergeDialog(r))}>
                      دمج في مورد آخر
                    </button>
                  )}
                  {editor && r.active && (
                    <button
                      className="link danger"
                      onClick={() => {
                        if (confirm('يُحذف المورد غير المستخدم، ويُوقف إذا كانت له نسخ في المدارس. متابعة؟'))
                          w.task(() => w.api('admin/supplier-bank/' + r.id, 'DELETE', {}));
                      }}
                    >
                      حذف / إيقاف
                    </button>
                  )}
                  {editor && !r.active && (
                    <button
                      className="link"
                      onClick={() => w.task(() => w.api('admin/supplier-bank/' + r.id, 'PATCH', cardPayload(r, true)))}
                    >
                      إعادة تفعيل
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty text="لا يوجد موردون مطابقون" />
      )}
      <small>
        «الشهادات السابقة» من سجل شهادات الإنجاز المرجعي (قبل النظام)؛ «المدارس» عدد المدارس التي تتعامل مع المورد في النظام؛ «المستندات»
        السجل التجاري والتعهدات والرخص المحفوظة باسم الشركة في الأرشيف المشترك.
      </small>
    </Panel>
  );
}

/** Reference register of the certificates issued before the system (from the approved workbook). */
export function LegacyCertificates() {
  const w = useWorkspace();
  const empty = { q: '', school: '', supplier: '', from: '', to: '' };
  const [form, setForm] = useState(empty),
    [filters, setFilters] = useState(empty);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  const qs = new URLSearchParams(params).toString();
  const [data] = useLoad<Row>(() => w.api('admin/legacy-certificates?' + qs), [qs]);
  const [open, setOpen] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  return (
    <Panel
      title="سجل شهادات الإنجاز السابقة (مرجعي — قبل النظام)"
      actions={
        <>
          <button className="secondary" onClick={() => setOpen((o) => !o)}>
            {open ? 'إخفاء' : 'عرض'} السجل
          </button>
          {open && (
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const { downloadFile } = await import('../lib/format');
                  downloadFile(await w.api('admin/legacy-certificates?' + new URLSearchParams({ ...params, format: 'xlsx' })));
                } catch (e) {
                  w.fail(e);
                }
              }}
            >
              Excel
            </button>
          )}
        </>
      }
    >
      {!open ? (
        <p>
          شهادات الإنجاز الصادرة قبل النظام ({data?.totals?.count ?? '…'} شهادة) للاسترشاد بالأسعار والموردين والغرامات السابقة. لا تؤثر على
          الموازنة أو الحسابات.
        </p>
      ) : (
        <>
          <form
            className="toolbar wrap"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters(form);
            }}
          >
            <input
              placeholder="بحث: المورد / الموضوع / رقم التكليف / الفاتورة / ملاحظة"
              value={form.q}
              onChange={set('q')}
              style={{ minWidth: 260 }}
            />
            <select value={form.school} onChange={set('school')}>
              <option value="">كل المدارس</option>
              {(data?.schools ?? []).map((s: string) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input placeholder="المورد" value={form.supplier} onChange={set('supplier')} />
            <input type="date" value={form.from} onChange={set('from')} title="من تاريخ" />
            <input type="date" value={form.to} onChange={set('to')} title="إلى تاريخ" />
            <button type="submit">بحث</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setForm(empty);
                setFilters(empty);
              }}
            >
              مسح
            </button>
          </form>
          {data && (
            <p>
              <b>{data.totals.count}</b> شهادة — قيمة التكليفات <b>{currency(data.totals.orderValue)}</b> — الغرامات{' '}
              <b>{currency(data.totals.fine)}</b> — الصافي المصروف <b>{currency(data.totals.net)}</b> ر.ق
            </p>
          )}
          {!data ? (
            <p>جارٍ التحميل…</p>
          ) : data.rows.length ? (
            <Table
              heads={[
                'م',
                'التاريخ',
                'المدرسة',
                'المورد',
                'الموضوع',
                'رقم التكليف',
                'الفاتورة',
                'قيمة التكليف',
                'تاريخ التوريد',
                'تأخير',
                'الغرامة',
                'الصافي',
                'ملاحظة',
              ]}
            >
              {data.rows.map((r: Row) => (
                <tr key={r.id}>
                  <td>{r.seq}</td>
                  <td className="mono">{day(r.date)}</td>
                  <td>{r.schoolName}</td>
                  <td>{r.supplier}</td>
                  <td>{r.subject || '—'}</td>
                  <td className="mono">{r.orderNo}</td>
                  <td className="mono">{r.invoice}</td>
                  <td className="mono">{currency(r.orderValue)}</td>
                  <td className="mono">{day(r.deliveryDate)}</td>
                  <td>{r.lateDays || '—'}</td>
                  <td className="mono">{Number(r.fine) ? currency(r.fine) : '—'}</td>
                  <td className="mono">{currency(r.net)}</td>
                  <td>
                    <small>{r.note}</small>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty text="لا توجد شهادات مطابقة" />
          )}
        </>
      )}
    </Panel>
  );
}

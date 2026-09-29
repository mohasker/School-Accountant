'use client';
import { useWorkspace } from '../components/context';
import { Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import type { Dialog } from '../components/FormDialog';
import { BUDGET_GROUPS, dateNow, day } from '../lib/format';

const show = (v: unknown) => (Array.isArray(v) ? v.join('، ') : String(v));

function AiStatus() {
  const w = useWorkspace();
  const [st] = useLoad<Row>(() => w.api('ai/status'));
  if (!st) return <p>جارٍ التحميل…</p>;
  return (
    <p>
      الحالة: <b>{st.configured ? 'مفعّل' : 'غير مفعّل'}</b>
      {st.configured && (
        <>
          {' '}
          — المصدر: {st.source === 'env' ? 'متغير الخادم ANTHROPIC_API_KEY' : 'مفتاح مسؤول النظام'} — النموذج {st.model}
        </>
      )}
    </p>
  );
}

/** Financial policy values with dated history; a change applies from its effective date forward. */
export function Policy() {
  const w = useWorkspace();
  const admin = w.me.user.isTenantAdmin;
  const [data] = useLoad<Row>(() => (admin ? w.api('admin/policy') : null));
  const [catalog] = useLoad<Row[]>(() => (admin ? w.api('admin/budget-catalog') : null));
  if (!admin) return <p>السياسة المالية تظهر لمدير النظام فقط.</p>;
  if (!data) return <p>جارٍ التحميل…</p>;
  const catalogDialog = (row?: Row): Dialog => ({
    title: row ? 'تعديل بند في دليل الموازنة' : 'إضافة بند',
    intro: <p>يظهر البند في موازنة المدارس عند فتح عام مالي جديد، أو من شاشة الموازنة «إضافة البنود الرسمية».</p>,
    fields: [
      { name: 'code', label: 'رقم الحساب', value: row?.code },
      { name: 'nameAr', label: 'اسم البند', value: row?.nameAr },
      { name: 'nameEn', label: 'الاسم بالإنجليزية', value: row?.nameEn, required: false },
      { name: 'assetCode', label: 'حساب الأصل (إن وجد، مثل 110805 للمكتبة)', value: row?.assetCode, required: false },
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
  const label = (key: string) => data.definitions.find((d: Row) => d.key === key)?.label ?? key;
  return (
    <>
      <Panel
        title="المساعد الذكي — مفتاح Anthropic API"
        actions={
          <button
            className="secondary"
            onClick={() =>
              w.open({
                title: 'مفتاح Anthropic API',
                intro: (
                  <p>
                    يُحفظ المفتاح على الخادم ولا يظهر للمستخدمين. احصل عليه من console.anthropic.com. اتركه فارغاً لإيقاف المساعد. إن كان
                    المتغير ANTHROPIC_API_KEY معرفاً على الخادم فهو المستخدم.
                  </p>
                ),
                fields: [{ name: 'key', label: 'المفتاح (sk-ant-…)', type: 'password', required: false }],
                save: (v) => w.api('ai/key', 'POST', { key: v.key }),
              })
            }
          >
            تعيين المفتاح
          </button>
        }
      >
        <AiStatus />
      </Panel>
      <Panel title="القيم السارية">
        <p>تُحفظ كل قيمة جديدة بتاريخ سريان، ولا تُعدّل القيم السابقة، فتبقى المعاملات القديمة على القاعدة التي طُبقت عليها.</p>
        <Table heads={['البند', 'القيمة الحالية', 'الوصف', '']}>
          {data.definitions.map((d: Row) => (
            <tr key={d.key}>
              <td>
                <b>{d.label}</b>
              </td>
              <td className="mono">{show(data.current[d.key])}</td>
              <td>
                <small>{d.help}</small>
              </td>
              <td>
                {admin && (
                  <button
                    className="link"
                    onClick={() =>
                      w.open({
                        title: 'تعديل: ' + d.label,
                        intro: <p>{d.help}</p>,
                        fields: [
                          { name: 'value', label: 'القيمة الجديدة', value: show(data.current[d.key]) },
                          { name: 'effectiveFrom', label: 'تاريخ السريان', type: 'date', value: dateNow() },
                          { name: 'reason', label: 'السبب / مرجع التعميم' },
                        ],
                        save: (v) => {
                          const value =
                            typeof d.default === 'number'
                              ? Number(v.value)
                              : Array.isArray(d.default)
                                ? String(v.value)
                                    .split(/[،,\s]+/)
                                    .filter(Boolean)
                                    .map(Number)
                                : String(v.value).trim();
                          return w.api('admin/policy', 'POST', { key: d.key, value, effectiveFrom: v.effectiveFrom, reason: v.reason });
                        },
                      })
                    }
                  >
                    تعديل
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="دليل بنود الموازنة وأرقام الحسابات" actions={<button onClick={() => w.open(catalogDialog())}>＋ بند</button>}>
        <Table heads={['رقم الحساب', 'حساب الأصل', 'البند', 'المجموعة', 'ملاحظة', 'الحالة', '']}>
          {(catalog || []).map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.code}</td>
              <td className="mono">{c.assetCode || '—'}</td>
              <td>
                {c.nameAr}
                <small>{c.nameEn}</small>
              </td>
              <td>{BUDGET_GROUPS[c.groupKey]}</td>
              <td>
                <small>{c.note}</small>
              </td>
              <td>{c.active ? 'فعال' : 'موقوف'}</td>
              <td>
                <button className="link" onClick={() => w.open(catalogDialog(c))}>
                  تعديل
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      <Panel title="سجل التعديلات">
        <Table heads={['البند', 'القيمة', 'يسري من', 'السبب', 'وقت التسجيل']}>
          {data.history.map((h: Row) => (
            <tr key={h.id}>
              <td>{label(h.key)}</td>
              <td className="mono">{show(h.value)}</td>
              <td>{day(h.effectiveFrom)}</td>
              <td>{h.reason}</td>
              <td>{new Date(h.createdAt).toLocaleString('ar-QA')}</td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}

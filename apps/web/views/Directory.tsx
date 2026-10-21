'use client';
import { useMemo, useState } from 'react';
import { useWorkspace } from '../components/context';
import { Panel, Stat } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { readBase64 } from '../lib/format';

const short = (v: string) => (v.includes('/') ? v.split('/').pop()!.trim() : v);

/**
 * The ministry's schools list (administrator): filter, tick schools, and give them an accountant and a
 * financial supervisor in one step. A school is opened in the system on its first assignment.
 */
export function Directory() {
  const w = useWorkspace();
  const [d, reload] = useLoad<Row>(() => w.api('admin/directory'));
  const [q, setQ] = useState('');
  const [district, setDistrict] = useState('');
  const [show, setShow] = useState('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [accountant, setAccountant] = useState('');
  const [supervisor, setSupervisor] = useState('');
  const rows: Row[] = d?.rows ?? [];
  const districts = useMemo(
    () => [...new Set(rows.map((r) => short(r.district)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')),
    [rows],
  );
  const list = rows.filter(
    (r) =>
      (!q || `${r.nameAr} ${r.nameEn} ${r.sn} ${r.accountant ?? ''} ${r.supervisor ?? ''}`.toLowerCase().includes(q.toLowerCase())) &&
      (!district || short(r.district) === district) &&
      (show === 'all' ||
        (show === 'no-accountant' && !r.accountantId && r.status.includes('تعمل')) ||
        (show === 'no-supervisor' && !r.supervisorId && r.status.includes('تعمل')) ||
        (show === 'assigned' && (r.accountantId || r.supervisorId)) ||
        (show === 'evacuated' && !r.status.includes('تعمل')) ||
        show === r.accountantId ||
        show === r.supervisorId),
  );
  if (!d) return <p>جارٍ التحميل…</p>;
  const users: Row[] = d.users;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const assign = (field: 'accountantId' | 'supervisorId', value: string) =>
    w.task(
      async () => {
        await w.api('admin/directory/assign', 'POST', { ids: [...picked], [field]: value });
        setPicked(new Set());
        reload();
      },
      field === 'accountantId' ? 'تم تعيين المحاسب للمدارس المختارة' : 'تم تعيين المراقب للمدارس المختارة',
    );
  const importFile = (file?: File) =>
    file &&
    w.task(async () => {
      await w.api('admin/directory/import', 'POST', { base64: await readBase64(file) });
      reload();
    }, 'تم تحديث دليل المدارس');

  return (
    <>
      <div className="cards">
        <Stat label="مدارس الدليل" value={rows.length} hint={`تعمل ${rows.filter((r) => r.status.includes('تعمل')).length}`} />
        <Stat label="مفتوحة في النظام" value={rows.filter((r) => r.schoolId).length} />
        <Stat label="لها محاسب" value={rows.filter((r) => r.accountantId).length} onClick={() => setShow('assigned')} />
        <Stat
          label="تعمل بدون محاسب / بدون مراقب"
          value={`${rows.filter((r) => !r.accountantId && r.status.includes('تعمل')).length} / ${rows.filter((r) => !r.supervisorId && r.status.includes('تعمل')).length}`}
          onClick={() => setShow('no-accountant')}
        />
      </div>
      <Panel
        title="دليل المدارس — تعيين المحاسب والمراقب المالي"
        actions={
          <label className="button-like secondary" title="ملف Excel بنفس أعمدة دليل الوزارة">
            تحديث الدليل من Excel
            <input type="file" accept=".xlsx" hidden onChange={(e) => importFile(e.target.files?.[0])} />
          </label>
        }
      >
        <p>
          اختر المدارس بالعلامة ثم حدد <b>المحاسب</b> الذي يمسك حساباتها و<b>المراقب المالي</b> الذي يراجعها. المدرسة تُفتح في النظام عند
          أول تعيين (بعامها المالي وبنود الدليل والموردين). عند تغيير المحاسب تبقى المدرسة عند السابق «غير فعالة» للاطلاع على تاريخها.
        </p>
        <div className="dir-filters">
          <input placeholder="بحث بالاسم أو الرقم أو المحاسب…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">كل المناطق</option>
            {districts.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">كل المدارس</option>
            <option value="no-accountant">تعمل بدون محاسب</option>
            <option value="no-supervisor">تعمل بدون مراقب</option>
            <option value="assigned">لها محاسب أو مراقب</option>
            <option value="evacuated">مفرغة / لا تعمل</option>
            <optgroup label="حسب الحساب">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="muted">{list.length} مدرسة</span>
        </div>
        <div className={'dir-bar' + (picked.size ? ' on' : '')}>
          <b>المختار: {picked.size}</b>
          <button type="button" className="link" onClick={() => setPicked(new Set(list.map((r) => r.id)))}>
            اختيار كل المعروض
          </button>
          <button type="button" className="link" onClick={() => setPicked(new Set())}>
            إلغاء الاختيار
          </button>
          <span className="sep" />
          <select value={accountant} onChange={(e) => setAccountant(e.target.value)}>
            <option value="">— المحاسب —</option>
            <option value="none">بدون محاسب</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!picked.size || !accountant}
            onClick={() => assign('accountantId', accountant === 'none' ? '' : accountant)}
          >
            تعيين المحاسب
          </button>
          <select value={supervisor} onChange={(e) => setSupervisor(e.target.value)}>
            <option value="">— المراقب المالي —</option>
            <option value="none">بدون مراقب</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!picked.size || !supervisor}
            onClick={() => assign('supervisorId', supervisor === 'none' ? '' : supervisor)}
          >
            تعيين المراقب
          </button>
        </div>
        <div className="dir-table">
          <table>
            <thead>
              <tr>
                <th />
                <th>م</th>
                <th>المدرسة</th>
                <th>المنطقة</th>
                <th>المرحلة / النوع</th>
                <th>الحالة</th>
                <th>المحاسب</th>
                <th>المراقب المالي</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={picked.has(r.id) ? 'picked' : ''} onClick={() => toggle(r.id)}>
                  <td>
                    <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td className="mono">{r.sn}</td>
                  <td>
                    <b>{r.nameAr}</b>
                    <small>{r.nameEn}</small>
                  </td>
                  <td>{short(r.district)}</td>
                  <td>
                    {r.stage}
                    <small>{short(r.gender)}</small>
                  </td>
                  <td>
                    {r.status.includes('تعمل') ? (
                      <span className="badge s-REGISTERED">تعمل</span>
                    ) : (
                      <span className="badge s-CANCELLED">مفرغة</span>
                    )}
                  </td>
                  <td>{r.accountant ?? <span className="muted">—</span>}</td>
                  <td>{r.supervisor ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

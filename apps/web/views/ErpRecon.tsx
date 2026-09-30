'use client';
import { useMemo, useState } from 'react';
import { useWorkspace } from '../components/context';
import { Select } from '../components/Select';
import { DocButtons, Empty, Panel, Table } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { currency, downloadFile, readBase64 } from '../lib/format';

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const STATUS: Row = {
  MATCH: 'مطابق',
  ERP_MORE: 'ERP أعلى — يحتاج تسجيلاً',
  SYSTEM_MORE: 'النظام أعلى — راجع ERP',
  SETTLED: 'سُوّي في النظام',
};

/**
 * Upload the monthly ERP expense report (PDF), compare it with the system line by line, then either
 * settle the lines where ERP shows more (a direct expense per line) or export the differences.
 */
export function ErpRecon() {
  const w = useWorkspace();
  const year = (w.setup.years || []).find((y: Row) => y.id === w.year);
  const months = useMemo(() => {
    if (!year) return [];
    const out: { value: string; label: string }[] = [];
    const end = String(year.endDate).slice(0, 7);
    for (let m = String(year.startDate).slice(0, 7); m <= end && out.length < 24;) {
      out.push({ value: m, label: `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` });
      const [y, mo] = m.split('-').map(Number);
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out;
  }, [year?.id]);
  const now = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(months.find((m) => m.value === now)?.value ?? months.at(-1)?.value ?? '');
  const [mode, setMode] = useState('month');
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<Row | null>(null);
  const [col, setCol] = useState(0);
  const [agg, setAgg] = useState<'sum' | 'first'>('sum');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Row | null>(null);
  const [history] = useLoad<Row[]>(() => w.api(w.root('erp-recon?year=' + w.year)));

  const read = () =>
    w.task(async () => {
      if (!file) throw Error('اختر ملف تقرير ERP (PDF)');
      if (file.size > 6 * 1024 * 1024) throw Error('حجم الملف حتى 6 ميجابايت');
      const r = await w.api('erp-recon/parse', 'POST', {
        school: w.school,
        yearId: w.year,
        period,
        mode,
        name: file.name,
        base64: await readBase64(file),
      });
      setData(r);
      setCol(r.columns.col);
      setAgg(r.columns.agg);
      setEdits({});
      setSaved(null);
    }, 'تمت قراءة التقرير');

  // Each choice shows the number it takes from the first line found, so the right column is easy to spot.
  const example: number[] = (data?.rows || []).find((r: Row) => r.lines.length)?.lines[0] ?? [];
  const columnOptions = [0, 1, 2, 3]
    .filter((i) => i === 0 || i < example.length)
    .map((i) => ({
      value: String(i),
      label: `العمود ${i + 1}${example.length > i ? ' — مثال: ' + currency(example[example.length - 1 - i]) : ''}`,
    }));
  const erpOf = (r: Row) => {
    if (edits[r.budgetId] !== undefined) return Number(edits[r.budgetId]) || 0;
    const vals = r.lines.map((l: number[]) => l[l.length - 1 - col]).filter((v: number | undefined) => v !== undefined);
    return agg === 'first' ? (vals[0] ?? 0) : vals.reduce((a: number, v: number) => a + v, 0);
  };
  const rows = (data?.rows || []).map((r: Row) => {
    const erp = Math.round(erpOf(r) * 100) / 100;
    const diff = Math.round((erp - Number(r.system)) * 100) / 100;
    return { ...r, erp, diff, status: Math.abs(diff) < 0.01 ? 'MATCH' : diff > 0 ? 'ERP_MORE' : 'SYSTEM_MORE' };
  });
  const differences = rows.filter((r: Row) => r.status !== 'MATCH');

  const save = (settle: boolean) =>
    w.task(
      async () => {
        const toSettle = rows.filter((r: Row) => r.status === 'ERP_MORE');
        if (settle && !toSettle.length) throw Error('لا توجد بنود فيها ERP أعلى من النظام لتسويتها');
        if (
          settle &&
          !confirm(
            `سيُسجَّل مصروف مباشر للفرق في ${toSettle.length} بند (إجمالي ${currency(toSettle.reduce((a: number, r: Row) => a + r.diff, 0))} ر.ق) بتاريخ نهاية الشهر. متابعة؟`,
          )
        )
          throw Error('أُلغيت التسوية');
        const r = await w.api(w.root('erp-recon'), 'POST', {
          yearId: w.year,
          period,
          mode,
          fileName: data!.fileName,
          settle,
          rows: rows.map((x: Row) => ({ budgetId: x.budgetId, erp: x.erp })),
        });
        setSaved(r);
      },
      settle ? 'سُوّيت الفروق في النظام وحُفظت المطابقة' : 'حُفظت المطابقة',
    );

  return (
    <>
      <Panel title="مطابقة تقرير المصاريف الفعلية الشهري من ERP">
        <p>
          صدّر من نظام ERP تقرير المصاريف الفعلية للشهر بصيغة PDF، ثم ارفعه هنا. يقرأ النظام كل سطر فيه رمز بند موازنة، ويقارنه بالمصروف
          المسجل في النظام لنفس الفترة (الشهادات وفواتير العهد والمصروفات المباشرة بتواريخها). لا يُحفظ شيء قبل أن تضغط الحفظ أو التسوية.
        </p>
        <div className="toolbar wrap">
          <label>
            الشهر
            <Select value={period} onChange={setPeriod} options={months} />
          </label>
          <label>
            الفترة
            <Select
              value={mode}
              onChange={setMode}
              options={[
                { value: 'month', label: 'الشهر وحده' },
                { value: 'ytd', label: 'تراكمي من بداية العام حتى نهاية الشهر' },
              ]}
            />
          </label>
          <label>
            ملف التقرير (PDF)
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button onClick={read} disabled={w.busy || !file || !period}>
            قراءة التقرير والمقارنة
          </button>
        </div>
      </Panel>

      {data && (
        <Panel title={`النتيجة — ${data.fileName} (${data.period.from} إلى ${data.period.to})`}>
          <div className="toolbar wrap">
            <label>
              عمود المبلغ الفعلي في التقرير
              <Select value={String(col)} onChange={(v) => (setCol(Number(v)), setEdits({}))} options={columnOptions} />
            </label>
            <label>
              إذا تكرر البند في أكثر من سطر
              <Select
                value={agg}
                onChange={(v) => (setAgg(v as 'sum' | 'first'), setEdits({}))}
                options={[
                  { value: 'sum', label: 'اجمع كل السطور' },
                  { value: 'first', label: 'خذ السطر الأول (تقرير إجماليات)' },
                ]}
              />
            </label>
          </div>
          <p className="muted">
            اختار النظام العمود الأقرب لأرقامك تلقائياً؛ غيّره إن لزم، ويمكنك تعديل أي مبلغ يدوياً. قُرئ {data.lineCount} سطراً.
          </p>
          {rows.length ? (
            <Table heads={['رمز البند', 'البند', 'تقرير ERP', 'النظام', 'الفرق', 'الحالة']}>
              {rows.map((r: Row) => (
                <tr key={r.budgetId} className={r.status === 'MATCH' ? '' : 'diff-row'}>
                  <td className="mono">{r.code}</td>
                  <td>
                    {r.name}
                    {r.lines.length > 1 && <small>{r.lines.length} سطور في التقرير</small>}
                    {!r.lines.length && <small>غير موجود في التقرير</small>}
                  </td>
                  <td>
                    <input
                      className="num-input"
                      inputMode="decimal"
                      value={edits[r.budgetId] ?? String(r.erp)}
                      onChange={(e) => setEdits({ ...edits, [r.budgetId]: e.target.value.replace(/[^\d.-]/g, '') })}
                    />
                  </td>
                  <td>{currency(r.system)}</td>
                  <td>
                    <b>{currency(r.diff)}</b>
                  </td>
                  <td>
                    <span className={'recon ' + r.status}>{STATUS[r.status]}</span>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty text="لم يُعثر في التقرير على رموز بنود الموازنة ولا مصروفات في النظام لهذه الفترة" />
          )}
          <div className="recon-summary">
            {differences.length ? (
              <>
                <b>{differences.length} بند فيه فرق.</b> «ERP أعلى»: مصروف ظهر في ERP ولم يُسجل في النظام — يمكن تسويته بمصروف مباشر.
                «النظام أعلى»: مسجل في النظام ولم يظهر في ERP بعد — راجع تسجيله في ERP.
              </>
            ) : (
              rows.length > 0 && <b className="ok">✓ النظام مطابق لتقرير ERP لهذه الفترة.</b>
            )}
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => save(false)} disabled={w.busy || !rows.length}>
              حفظ المطابقة واستخراج الفروق
            </button>
            {rows.some((r: Row) => r.status === 'ERP_MORE') && (
              <button onClick={() => save(true)} disabled={w.busy}>
                تسوية الفروق في النظام حسب ملف ERP
              </button>
            )}
          </div>
          {saved && (
            <div className="actions">
              <span>
                حُفظت المطابقة{saved.settled ? ` — سُوّي ${saved.settled} بند` : ''}؛ المتبقي للمراجعة {saved.differences} بند:
              </span>
              <DocButtons path={w.root('erp-recon/' + saved.id)} label="كشف الفروق" />
              <button className="secondary" onClick={async () => downloadFile(await w.api(w.root(`erp-recon/${saved.id}?format=xlsx`)))}>
                Excel
              </button>
            </div>
          )}
          {(data.unknownCodes.length > 0 || !rows.some((r: Row) => r.lines.length)) && (
            <details className="recon-debug">
              <summary>تفاصيل القراءة (إذا لم تُقرأ الأرقام صحيحة)</summary>
              {data.unknownCodes.length > 0 && <p>رموز في التقرير غير موجودة في موازنة المدرسة: {data.unknownCodes.join('، ')}</p>}
              <pre>{data.sample.join('\n')}</pre>
            </details>
          )}
        </Panel>
      )}

      <Panel title="المطابقات السابقة">
        {history?.length ? (
          <Table heads={['الفترة', 'الملف', 'الفروق', 'سُوّي', 'التاريخ', '']}>
            {history.map((h) => (
              <tr key={h.id}>
                <td>
                  {h.period} {h.mode === 'ytd' ? '(تراكمي)' : ''}
                </td>
                <td>{h.fileName}</td>
                <td>{(h.rows as Row[]).filter((x) => !['MATCH', 'SETTLED'].includes(x.status)).length}</td>
                <td>{h.settled}</td>
                <td>{new Date(h.createdAt).toLocaleDateString('en-GB')}</td>
                <td>
                  <DocButtons link path={w.root('erp-recon/' + h.id)} label="" />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty text="لا توجد مطابقات محفوظة لهذا العام" />
        )}
      </Panel>
    </>
  );
}

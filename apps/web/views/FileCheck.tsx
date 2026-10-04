'use client';
import { useRef, useState } from 'react';
import { useWorkspace } from '../components/context';
import { DocButtons, Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { readBase64 } from '../lib/format';

const RESULT: Record<string, { text: string; cls: string }> = {
  READY: { text: '✅ جاهز للإرسال', cls: 'notice' },
  REVIEW: { text: '🟡 جاهز بعد مراجعة التنبيهات', cls: 'warn' },
  FIX: { text: '⛔ يحتاج تصحيحاً قبل الإرسال', cls: 'error' },
};
const LEVEL: Record<string, string> = { ERROR: '⛔', WARN: '🟡', NOTE: '•' };
const DOC_NAMES: Record<string, string> = {
  INVITATION: 'دعوة الشركات',
  QUOTE: 'عروض الأسعار',
  CR: 'السجلات التجارية',
  QUOTE_REPORT: 'تقرير دراسة العروض',
  PROCUREMENT_APPROVAL: 'موافقة إدارة المشتريات',
  DEPT_APPROVAL: 'موافقة القسم المختص',
  ORDER: 'كتاب التكليف',
  DELIVERY_NOTE: 'إذن التسليم من المورد',
  RECEIPT: 'إذن الاستلام من المدرسة',
  INVOICE: 'الفاتورة',
  IBAN: 'إثبات الحساب البنكي',
  UNDERTAKING: 'التعهد',
  BENEFICIARIES: 'كشوف المستفيدين',
  CERTIFICATE: 'شهادة الإنجاز',
  COVER: 'كتاب التغطية',
};
/** Documents the administrator may require in every file at payment. */
const REQUIRABLE = [
  'INVITATION',
  'QUOTE',
  'CR',
  'PROCUREMENT_APPROVAL',
  'DEPT_APPROVAL',
  'DELIVERY_NOTE',
  'RECEIPT',
  'INVOICE',
  'IBAN',
  'UNDERTAKING',
  'BENEFICIARIES',
];
const MAX_TOTAL = 25 * 1024 * 1024;

/** Photos are reduced to 2000 px JPEG in the browser (clear enough to read, small enough to send); PDFs go as they are. */
async function prepare(file: File, enhance = false) {
  if (file.type === 'application/pdf') return { name: file.name, mime: 'application/pdf', base64: await readBase64(file), size: file.size };
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw Error(`«${file.name}»: أرفق PDF أو صور JPG / PNG فقط`);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  // Phone photos of paper: grey scale with more contrast keeps text, signatures and stamps readable.
  if (enhance) ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.08)';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(Error('تعذر تجهيز الصورة'))), 'image/jpeg', 0.85),
  );
  const name = file.name.replace(/\.\w+$/, '') + '.jpg';
  return { name, mime: 'image/jpeg', base64: await readBase64(new File([blob], name)), size: blob.size };
}

/**
 * «فحص الملف قبل الإرسال»: upload the signed, scanned file (or photos of its pages); the server reads
 * the pages, compares them with this transaction and returns a one-page report.
 */
export function FileCheckPanel({ c, work }: { c: Row; work: boolean }) {
  if (!c.issueDate && !c.reportDate) return null;
  return (
    <CheckPanel
      id={c.id}
      work={work}
      post="file-check"
      prompt="file-check-prompt"
      title="فحص الملف قبل الإرسال"
      intro="ارفع الملف الموقّع بعد مسحه ضوئياً (PDF) أو صور أوراقه بالترتيب. يُراجَع اسم المدرسة في كل ورقة، وتسلسل التواريخ، وأرقام التكليف والفاتورة، والأصناف والمبالغ والغرامة والصافي، والسجلات التجارية وIBAN والتعهد، والتوقيعات والأختام، ومتطلبات الإدارة، ويصدر تقرير من صفحة واحدة. لا يتغير شيء في المعاملة."
    />
  );
}

/** The same check for an imprest settlement statement and its invoices. */
export function ImprestCheckPanel({ settlementId }: { settlementId: string }) {
  return (
    <CheckPanel
      id={settlementId}
      work
      post="imprest-check"
      prompt="imprest-check-prompt"
      title="فحص كشف التسوية وفواتيره قبل الإرسال"
      intro="ارفع فواتير الكشف (PDF أو صور). تُطابق كل فاتورة مسجلة في الكشف برقمها ومورّدها وتاريخها ومبلغها، وتُكشف الفواتير الزائدة، وحد فاتورة النثرية، والتواريخ، وختم المورد، والإجمالي."
    />
  );
}

function CheckPanel({
  id,
  work,
  post,
  prompt,
  title,
  intro,
}: {
  id: string;
  work: boolean;
  post: string;
  prompt: string;
  title: string;
  intro: string;
}) {
  const c = { id };
  const w = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<File[]>([]);
  const [enhance, setEnhance] = useState(true);
  const addFiles = (list: FileList | null) => {
    if (list?.length) setPages((p) => [...p, ...Array.from(list)]);
    if (input.current) input.current.value = '';
    if (camera.current) camera.current.value = '';
  };
  const move = (i: number, d: number) =>
    setPages((p) => {
      const n = [...p];
      const j = i + d;
      if (j < 0 || j >= n.length) return p;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<Row | null>(null);
  const [prompts, setPrompts] = useState<Row | null>(null);
  const [shown, setShown] = useState<'reading' | 'review' | null>(null);
  const [pasted, setPasted] = useState('');
  const [history] = useLoad<Row[]>(() => w.api(w.root('file-checks?case=' + c.id)), [c.id, last?.id]);
  const latest: Row | null = last ?? history?.[0] ?? null;

  /** Copies one of the two prompts; when the browser refuses the clipboard, the text is shown to copy by hand. */
  const copyPrompt = async (kind: 'reading' | 'review') => {
    try {
      const p = prompts ?? (await w.api(w.root(prompt + '/' + c.id)));
      setPrompts(p);
      setShown(kind);
      await navigator.clipboard?.writeText(p[kind]).catch(() => {});
    } catch (e) {
      w.fail(e);
    }
  };
  const runPasted = async () => {
    if (pasted.trim().length < 2) return w.fail(Error('الصق رد Claude / ChatGPT أولاً'));
    setRunning(true);
    try {
      setLast(await w.api(`${post}/${w.school}/${c.id}`, 'POST', { pasted }));
      setPasted('');
    } catch (e) {
      w.fail(e);
    } finally {
      setRunning(false);
    }
  };

  const run = async () => {
    const files = pages;
    if (!files.length) return w.fail(Error('اختر ملف PDF أو صور أوراق المعاملة أولاً، أو صوّرها بالكاميرا'));
    setRunning(true);
    try {
      const ready = [];
      for (const f of files) ready.push(await prepare(f, enhance));
      if (ready.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) throw Error('حجم الملفات أكبر من 25 ميجابايت؛ قسّمها على دفعتين');
      const r = await w.api(`${post}/${w.school}/${c.id}`, 'POST', { files: ready.map(({ size: _size, ...f }) => f) });
      setLast(r);
      setPages([]);
    } catch (e) {
      w.fail(e);
    } finally {
      setRunning(false);
    }
  };

  const findings: Row[] = latest?.findings ?? [];
  const checklist: string[] = latest?.checklist ?? latest?.facts?.checklist ?? [];
  return (
    <Panel title={title}>
      <p>
        <small>{intro}</small>
      </p>
      {work && (
        <>
          <div className="toolbar wrap">
            <input
              ref={input}
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png"
              disabled={running}
              onChange={(e) => addFiles(e.target.files)}
            />
            <label className="secondary button-like">
              📷 تصوير الأوراق
              <input
                ref={camera}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                hidden
                disabled={running}
                onChange={(e) => addFiles(e.target.files)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /> تحسين وضوح الصور
            </label>
            <button onClick={run} disabled={running || w.busy || !pages.length}>
              {running ? 'جارٍ الفحص… (قد يستغرق دقيقة)' : `فحص الملف${pages.length ? ` (${pages.length})` : ''}`}
            </button>
          </div>
          {pages.length > 0 && (
            <ol className="page-list">
              {pages.map((f, i) => (
                <li key={i + f.name}>
                  {f.name} <small>({Math.round(f.size / 1024)} ك.ب)</small>{' '}
                  <button className="link" onClick={() => move(i, -1)} disabled={i === 0} title="لأعلى">
                    ↑
                  </button>
                  <button className="link" onClick={() => move(i, 1)} disabled={i === pages.length - 1} title="لأسفل">
                    ↓
                  </button>
                  <button className="link danger" onClick={() => setPages((p) => p.filter((_, j) => j !== i))} title="حذف">
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {work && (
        <details className="external-check">
          <summary>
            <b>بدون رصيد: الفحص عبر Claude أو ChatGPT</b>
          </summary>
          <ol>
            <li>اضغط «نسخ أمر القراءة»، ثم افتح Claude أو ChatGPT وارفع ملف المعاملة (PDF أو الصور) والصق الأمر وأرسله.</li>
            <li>انسخ الرد كاملاً والصقه في المربع أدناه ثم اضغط «فحص الرد»؛ يطبّق النظام قواعده ويصدر التقرير الرسمي من صفحة واحدة.</li>
            <li>أو «نسخ أمر المراجعة الكاملة» لمراجعة داخل المحادثة نفسها بالبيانات المسجلة (نتيجتها للاسترشاد ولا تُحفظ في النظام).</li>
          </ol>
          <div className="toolbar wrap">
            <button className="secondary" onClick={() => copyPrompt('reading')}>
              نسخ أمر القراءة
            </button>
            <button className="secondary" onClick={() => copyPrompt('review')}>
              نسخ أمر المراجعة الكاملة
            </button>
          </div>
          {prompts && shown && (
            <>
              <small>نُسخ الأمر. إن لم يُنسخ تلقائياً فانسخه من هنا:</small>
              <textarea readOnly rows={5} value={prompts[shown]} onFocus={(e) => e.target.select()} dir="auto" style={{ width: '100%' }} />
              {prompts.required && (
                <small>المستندات المطلوبة لهذه المعاملة: {prompts.required.map((r: Row) => DOC_NAMES[r.type] ?? r.type).join('، ')}</small>
              )}
            </>
          )}
          <textarea
            rows={4}
            placeholder="الصق هنا رد Claude / ChatGPT (نتيجة JSON)"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            style={{ width: '100%', marginTop: 8, direction: 'ltr' }}
          />
          <button onClick={runPasted} disabled={running || w.busy || !pasted.trim()}>
            {running ? 'جارٍ الفحص…' : 'فحص الرد'}
          </button>
          <p>
            <small>الملف يُرفع إلى حسابك في الخدمة الخارجية؛ التزم بسياسة الإدارة في مشاركة المستندات.</small>
          </p>
        </details>
      )}
      {latest && (
        <>
          <div className={RESULT[latest.result]?.cls ?? 'notice'}>
            <b>{RESULT[latest.result]?.text}</b> — أخطاء {latest.errors} — تنبيهات {latest.warnings} — ملاحظات {latest.notes} (
            {latest.pages} صفحة، {latest.mode === 'AI' ? 'قراءة آلية' : latest.mode === 'EXTERNAL' ? 'Claude / ChatGPT' : 'نص PDF فقط'})
          </div>
          {findings.length > 0 && (
            <ul className="check-list">
              {findings.slice(0, 15).map((f, i) => (
                <li key={i} className={'lvl-' + f.level}>
                  {LEVEL[f.level]} {f.text}
                </li>
              ))}
              {findings.length > 15 && <li>… و {findings.length - 15} بنداً آخر في التقرير</li>}
            </ul>
          )}
          {checklist.length > 0 && (
            <>
              <b>مراجعة يدوية:</b>
              <ul style={{ listStyle: 'none', paddingInlineStart: 8 }}>
                {checklist.map((x) => (
                  <li key={x}>☐ {x}</li>
                ))}
              </ul>
            </>
          )}
          <DocButtons path={w.root('file-checks/' + latest.id)} label="تقرير الفحص" />
        </>
      )}
      {history && history.length > 1 && (
        <details>
          <summary>الفحوص السابقة ({history.length - 1})</summary>
          <ul>
            {history.slice(1).map((h) => (
              <li key={h.id}>
                {new Date(h.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Qatar' })} — {h.byName} — {RESULT[h.result]?.text} (
                {h.errors}/{h.warnings}) {h.source === 'TELEGRAM' ? '— تليجرام' : ''}{' '}
                <DocButtons link path={w.root('file-checks/' + h.id)} label="" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

/** Administrator: AI reading switch and the administration's requirements checked on every file. */
export function FileCheckSettingsPanel() {
  const w = useWorkspace();
  const [st] = useLoad<Row>(() => w.api('admin/file-check'));
  const [text, setText] = useState('');
  const [level, setLevel] = useState('WARN');
  if (!st) return null;
  const save = (patch: Row) =>
    w.task(
      () =>
        w.api('admin/file-check', 'POST', {
          ai: st.ai,
          prompt: st.prompt,
          gate: st.gate,
          fourEyes: st.fourEyes,
          fourEyesLimit: st.fourEyesLimit,
          docs: st.docs,
          rules: st.rules,
          ...patch,
        }),
      'حُفظت إعدادات الفحص',
    );
  return (
    <Panel title="فحص المعاملات قبل الإرسال">
      <label className="check">
        <input type="checkbox" checked={st.ai} onChange={(e) => save({ ai: e.target.checked })} disabled={w.busy} /> السماح بقراءة الصور
        والملفات الممسوحة آلياً (يُرسل الملف إلى خدمة Anthropic عبر مفتاح المساعد الذكي)
      </label>
      <p>
        <small>
          {st.ai && !st.aiConfigured
            ? '⚠ لا يوجد مفتاح للمساعد الذكي؛ أضفه من لوحة المساعد الذكي أعلاه وإلا يُقرأ نص ملفات PDF فقط.'
            : st.ai
              ? 'تُقرأ كل صفحة آلياً (الأسماء والتواريخ والأرقام والتوقيعات والأختام)، ثم تُقارن بقواعد ثابتة مع بيانات النظام.'
              : 'بدون القراءة الآلية لا يخرج أي ملف من الخادم: تُفحص الأرقام والتواريخ من نص ملفات PDF، والباقي في قائمة مراجعة يدوية.'}
        </small>
      </p>
      <label className="check">
        <input type="checkbox" checked={st.prompt} onChange={(e) => save({ prompt: e.target.checked })} disabled={w.busy} /> السماح
        للمحاسبين بالفحص عبر Claude أو ChatGPT الخاص بهم (أمر جاهز يُنسخ، ثم يُلصق الرد في النظام)
      </label>
      <label className="check">
        <input type="checkbox" checked={st.gate} onChange={(e) => save({ gate: e.target.checked })} disabled={w.busy} /> بوابة قبل شهادة
        الإنجاز: لا تصدر الشهادة إلا بعد تأكيد وجود المستندات المطلوبة أدناه في الملف، وتحقق IBAN المورد، وسريان سجله التجاري
      </label>
      <h3>مراجعة من شخص آخر</h3>
      <label className="check">
        <input type="checkbox" checked={st.fourEyes} onChange={(e) => save({ fourEyes: e.target.checked })} disabled={w.busy} /> تغيير IBAN
        لمورد له IBAN مسجل ينتظر موافقة مستخدم آخر
      </label>
      <label>
        وشهادة الإنجاز لمعاملة قيمتها من (ر.ق، 0 = بلا موافقة):{' '}
        <input
          type="number"
          min={0}
          defaultValue={st.fourEyesLimit}
          style={{ width: 140 }}
          onBlur={(e) => Number(e.target.value) !== st.fourEyesLimit && save({ fourEyesLimit: Number(e.target.value || 0) })}
        />
      </label>
      <h3>مستندات مطلوبة دائماً عند الصرف</h3>
      <p>
        <small>
          تُضاف إلى ما تتطلبه مرحلة المعاملة وما أشير إليه في شهادة الإنجاز وكتاب التغطية. السجل التجاري يُطلب لكل شركة قدمت عرضاً.
        </small>
      </p>
      <div className="check-grid">
        {REQUIRABLE.map((d) => (
          <label key={d} className="check">
            <input
              type="checkbox"
              checked={st.docs.includes(d)}
              disabled={w.busy}
              onChange={(e) => save({ docs: e.target.checked ? [...st.docs, d] : st.docs.filter((x: string) => x !== d) })}
            />
            {DOC_NAMES[d]}
          </label>
        ))}
      </div>
      <h3>متطلبات الإدارة (تُفحص في كل معاملة)</h3>
      {st.rules.length ? (
        <ol>
          {st.rules.map((r: Row) => (
            <li key={r.id}>
              {r.level === 'ERROR' ? '⛔' : '🟡'} {r.text}{' '}
              <button className="link danger" onClick={() => save({ rules: st.rules.filter((x: Row) => x.id !== r.id) })}>
                حذف
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>
          <small>لا توجد متطلبات بعد. أمثلة: «الفاتورة إلكترونية وعليها رمز QR»، «سند الاستلام موقّع من أمين المخزن».</small>
        </p>
      )}
      <form
        className="toolbar wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length < 4) return;
          save({ rules: [...st.rules, { text: text.trim(), level, docType: '' }] }).then(() => setText(''));
        }}
      >
        <input
          placeholder="متطلب جديد، مثل: الفاتورة عليها رمز QR"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="WARN">تنبيه</option>
          <option value="ERROR">خطأ يمنع الإرسال</option>
        </select>
        <button type="submit" disabled={w.busy}>
          ＋ إضافة
        </button>
      </form>
    </Panel>
  );
}

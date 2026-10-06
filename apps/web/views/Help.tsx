'use client';
import { useWorkspace, type View } from '../components/context';
import { Panel } from '../components/ui';
import { useLoad } from '../components/useLoad';
import type { Row } from '../lib/api';
import { APP_NAME, APP_TITLE } from '../lib/brand';

type Guide = { key: string; title: string; view: View; steps: string[] };

/** Step-by-step guides of the daily work, in plain words; the same text makes the one-page A4 guide. */
export const GUIDES: Guide[] = [
  {
    key: 'case',
    title: 'معاملة شراء من البداية للنهاية',
    view: 'cases',
    steps: [
      'من «المعاملات» اضغط «＋ معاملة جديدة» واكتب الموضوع والأصناف والكميات وبند الموازنة.',
      'اضغط الزر الكبير «إدخال عروض الأسعار» وأدخل عروض الشركات (عرض واحد حتى حد الشراء المباشر، و3 عروض لما يزيد).',
      'اضغط «إصدار التقرير ← التكليف»: راجع الملخص ثم «تأكيد وإصدار»؛ يصدر تقرير دراسة العروض.',
      'في نافذة التكليف حدد التاريخ ومدة التنفيذ، ثم «تأكيد وإصدار»؛ يصدر كتاب التكليف للطباعة.',
      'بعد التوريد اضغط «إعداد الشهادة والتغطية»، أدخل تاريخ الإنجاز ورقم الفاتورة؛ تصدر الشهادة وكتاب التغطية معاً (والغرامة تُحسب تلقائياً عند التأخير).',
      'سجّل المعاملة في ERP ثم اضغط «إثبات ERP» في المعاملة.',
    ],
  },
  {
    key: 'imprest',
    title: 'العهدة: من الاستلام حتى الإغلاق',
    view: 'imprests',
    steps: [
      'من «العهد» اضغط «＋ عهدة جديدة» واختر النوع (نثرية، يوم التعليم، معرض الكتاب…) واكتب القيمة المستلمة.',
      'اجمع الفواتير لدى أمين العهدة طوال الفترة؛ لا تُدخل شيئاً في النظام حتى الانتهاء.',
      'اضغط «تسوية — إدخال الفواتير» وأدخل كل الفواتير مرة واحدة في الجدول؛ يصدر كشف التسوية وكتاب التغطية معاً.',
      'النثرية: عند بلوغ 75% اختر «تسوية واستعاضة»، وبعد صرف المبلغ اضغط «استلام الاستعاضة».',
      'الإغلاق: اختر «تسوية وإغلاق» واكتب مرجع إيصال رد الرصيد المتبقي.',
    ],
  },
  {
    key: 'budget',
    title: 'الموازنة والمصروفات المباشرة',
    view: 'budget',
    steps: [
      'في بداية العام: من «الموازنة» أدخل المبلغ المعتمد لكل بند.',
      'المصروف الذي دُفع مباشرة (ليس من عهدة) أو القديم قبل النظام: «＋ مصروف مباشر» أو استورده من نموذج Excel.',
      'الأرصدة تُخصم تلقائياً من التكليفات والشهادات والعهد؛ البند الذي قارب النفاد يظهر تنبيهه في «مدارسي».',
    ],
  },
  {
    key: 'erp',
    title: 'مطابقة تقرير ERP الشهري',
    view: 'erp-recon',
    steps: [
      'من ERP صدّر تقرير المصاريف الفعلية للشهر بصيغة PDF.',
      'من «مطابقة تقرير ERP» اختر الشهر وارفع الملف واضغط «قراءة التقرير والمقارنة».',
      'راجع العمود المختار (يظهر بجانبه مثال) وعدّل أي رقم إن لزم.',
      '«ERP أعلى»: اضغط «تسوية الفروق في النظام». «النظام أعلى»: راجع تسجيله في ERP.',
      'احفظ المطابقة واطبع كشف الفروق أو نزّله Excel.',
    ],
  },
  {
    key: 'school',
    title: 'إضافة مدرسة والموردين',
    view: 'settings',
    steps: [
      'من «الإعدادات» اضغط «＋ مدرسة»، اكتب الاسم أو اختره من القائمة، وأدخل المدير ومسؤولي العهد والمشتريات وكود ERP.',
      'تأتي المدرسة بقائمة الموردين من الشيتات المعتمدة؛ عدّل أي مورد من «الموردون»، أو أضف مورداً من «بنك الموردين» (كل الموردين ببيانات التواصل والبنك وتاريخهم في الشهادات السابقة).',
      'أدخل مبالغ الموازنة المعتمدة من «الموازنة».',
    ],
  },
  {
    key: 'telegram',
    title: 'إصدار التكليفات من الهاتف (تليجرام)',
    view: 'settings',
    steps: [
      'يفعّل مدير النظام البوت من «السياسة المالية ← بوت تليجرام» برمز BotFather.',
      'من «الإعدادات ← ربط تليجرام» تحصل على رمز من 6 أرقام وترسله للبوت مرة واحدة.',
      'أرسل للبوت «المعلقة» ثم «تكليف ورقم الملف» ثم مدة التوريد ثم «نعم»؛ يصلك كتاب التكليف PDF.',
    ],
  },
  {
    key: 'file-check',
    title: 'فحص الملف الورقي قبل الإرسال',
    view: 'cases',
    steps: [
      'بعد التوقيع والختم امسح الملف أو صوّر أوراقه بالترتيب.',
      'من صفحة المعاملة ← «فحص الملف قبل الإرسال» ارفع الملفات ثم «فحص الملف»، أو من تليجرام: «فحص TR-00012» ثم الصور ثم «تم».',
      'بدون رصيد: «نسخ أمر القراءة» ثم Claude أو ChatGPT مع الملف، والصق الرد في النظام ← «فحص الرد».',
      'صحّح الأخطاء الحمراء، وقرّر في التنبيهات الصفراء، وعلّم على القائمة اليدوية، ثم اطبع تقرير الفحص مع الملف.',
    ],
  },
  {
    key: 'returns',
    title: 'الملف المجمّع والمرتجعات',
    view: 'returns',
    steps: [
      'صفحة المعاملة ← «⬇ ملف المعاملة المجمّع» ينزّل كل المستندات في PDF واحد بفهرس داخلي.',
      'إذا رجع الملف من التدقيق: «المرتجعات والملاحظات» ← سجّل السبب، ثم «تم التصحيح» بعد الإصلاح.',
      'شاشة «المرتجعات وأسبابها» تعرض أكثر الأخطاء تكراراً، و«إضافة كقاعدة فحص» تحوّل الخطأ لفحص آلي.',
      'نافذة الترحيب تنبّه للبنود القريبة من النفاد والتكليفات القريبة من موعدها.',
    ],
  },
  {
    key: 'backups',
    title: 'النسخ الاحتياطية والاستعادة (مدير النظام)',
    view: 'admin',
    steps: [
      'لوحة مدير النظام ← «النسخ الاحتياطية»: نسخة يومية تلقائية، ونسخة قبل أي مسح.',
      '«مجلد نسخة ثانية»: اختر فلاشة أو مجلد OneDrive لتُنسخ إليه كل نسخة.',
      'للرجوع: «استعادة هذه النسخة» ثم اكتب «استعادة»؛ البيانات الحالية تُحفظ أولاً كنسخة.',
    ],
  },
  {
    key: 'print',
    title: 'الطباعة والإرسال',
    view: 'registry',
    steps: [
      'كل مستند له أزرار: «طباعة» و«PDF» و«بريد» و«واتساب».',
      'السجلات (تقارير العروض، التكليفات، الشهادات) تعيد طباعة أي مستند سابق.',
      'زر 🔔 أعلى الشاشة يعرض ما ينتظرك في كل مدارسك.',
    ],
  },
];

export function Help() {
  const w = useWorkspace();
  const admin = w.me.user.isTenantAdmin;
  const [videos] = useLoad<Row>(() => w.api('admin/help-videos'));
  const open = (g: Guide, tour: boolean) => {
    w.go(g.view);
    if (tour) setTimeout(() => window.dispatchEvent(new Event('moesas-tour')), 300);
  };
  const printGuide = () =>
    w.printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>دليل الجيب — ${APP_NAME}</title>
<style>@page{size:A4;margin:10mm}body{font-family:Calibri,Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#111}
h1{font-size:15pt;margin:0 0 2mm;color:#861b3a}h2{font-size:11.5pt;margin:3mm 0 1mm;color:#142836;border-bottom:1px solid #ccc}
ol{margin:0;padding-inline-start:6mm}li{margin:.6mm 0}.cols{columns:2;column-gap:8mm}.box{break-inside:avoid}
p{margin:0 0 2mm;color:#444}</style></head><body>
<h1>${APP_NAME} — دليل الجيب</h1><p>${APP_TITLE}. علّقه بجانب الكمبيوتر. زر «؟ شرح الشاشة» و«✦ ساعدني» أعلى كل شاشة.</p>
<div class="cols">${GUIDES.map((g) => `<div class="box"><h2>${g.title}</h2><ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol></div>`).join('')}</div>
</body></html>`);
  const setVideo = (g: Guide) =>
    w.open({
      title: 'رابط فيديو الشرح: ' + g.title,
      intro: <p>سجّل الشاشة (في Windows: مفتاح Windows + Alt + R) وارفع الفيديو على OneDrive أو YouTube (غير مدرج)، ثم الصق الرابط.</p>,
      fields: [{ name: 'url', label: 'الرابط (فارغ = حذف)', value: videos?.[g.key] ?? '', required: false }],
      save: (v) => w.api('admin/help-videos', 'POST', { ...(videos || {}), [g.key]: String(v.url || '') }),
    });
  return (
    <>
      <Panel
        title="كيف أعمل…؟"
        actions={
          <button className="secondary" onClick={printGuide}>
            ⎙ طباعة دليل الجيب (صفحة A4)
          </button>
        }
      >
        <p>
          اختر العمل الذي تريده واتبع الخطوات. «افتح الشاشة مع الشرح» ينقلك للشاشة ويشرحها بالفقاعات خطوة بخطوة. ولأي سؤال اضغط «✦ ساعدني»
          أعلى أي شاشة.
        </p>
      </Panel>
      <div className="guides">
        {GUIDES.map((g, i) => (
          <section key={g.key} className="guide">
            <h3>
              <span>{i + 1}</span>
              {g.title}
            </h3>
            <ol>
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="actions">
              <button onClick={() => open(g, true)}>افتح الشاشة مع الشرح</button>
              {videos?.[g.key] && (
                <a className="secondary button-link" href={videos[g.key]} target="_blank" rel="noreferrer">
                  ▶ شاهد الفيديو
                </a>
              )}
              {admin && (
                <button className="link" onClick={() => setVideo(g)}>
                  {videos?.[g.key] ? 'تغيير رابط الفيديو' : 'إضافة رابط فيديو'}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

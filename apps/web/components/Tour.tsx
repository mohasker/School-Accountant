'use client';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { markTourSeen, tourSeen } from '../lib/prefs';

type Step = { target: string; title: string; text: string };

/**
 * Short explanations shown the first time a screen is opened: each bubble points at one part of the
 * screen. Steps whose element is not on the screen (e.g. a button the user's role does not have)
 * are skipped. «شرح الشاشة» replays them at any time.
 */
export const TOURS: Record<string, Step[]> = {
  dashboard: [
    { target: '[data-tour=nav]', title: 'القائمة', text: 'من هنا تنتقل بين شاشات النظام. الشاشة المفتوحة ملوّنة.' },
    {
      target: '[data-tour=school]',
      title: 'المدرسة والعام',
      text: 'اختر المدرسة التي تعمل عليها والعام المالي؛ كل الشاشات تعرض بياناتها.',
    },
    { target: '.quick-links', title: 'روابط سريعة', text: 'أهم الأعمال بضغطة واحدة: «معاملة جديدة» تبدأ أي شراء جديد.' },
    { target: '[data-tour=bell]', title: 'التنبيهات', text: 'الجرس يعرض المعاملات المعلقة في كل مدارسك والخطوة التالية لكل منها.' },
    { target: '[data-tour=font]', title: 'حجم الخط', text: 'إذا كان الخط صغيراً اضغط هنا لتكبيره.' },
  ],
  cases: [
    { target: '[data-tour=new-case]', title: 'معاملة جديدة', text: 'ابدأ من هنا: اكتب الموضوع والأصناف، ثم أدخل عروض الأسعار.' },
    { target: '[data-tour=search]', title: 'البحث', text: 'ابحث برقم المعاملة أو أمر الشراء أو اسم المورد.' },
    {
      target: '.row-actions',
      title: 'الخطوة التالية',
      text: 'كل معاملة غير مكتملة لها زر بالخطوة التالية؛ اضغطه وأكمل البيانات المطلوبة.',
    },
  ],
  case: [
    {
      target: '.stepper',
      title: 'مراحل المعاملة',
      text: 'المعاملة أربع مراحل: تقرير العروض ← التكليف ← الشهادة والتغطية. المرحلة الحالية ملوّنة.',
    },
    { target: '[data-tour=next]', title: 'الزر الكبير', text: 'اضغط هذا الزر دائماً؛ يفتح لك الخطوة التالية بالبيانات المطلوبة فقط.' },
  ],
  imprests: [
    { target: '[data-tour=new-imprest]', title: 'عهدة جديدة', text: 'عند استلام عهدة: اختر نوعها واكتب قيمتها.' },
    {
      target: '[data-tour=settle]',
      title: 'التسوية',
      text: 'عند اكتمال الفواتير لدى أمين العهدة أدخلها كلها مرة واحدة هنا؛ يصدر الكشف وكتاب التغطية.',
    },
  ],
  budget: [
    {
      target: 'main .panel',
      title: 'الموازنة',
      text: 'أدخل المبالغ المعتمدة لكل بند مرة في بداية العام؛ الصرف يُخصم تلقائياً من المعاملات والعهد.',
    },
  ],
};

export function Tour({
  view,
  user,
  blocked,
  replay,
  onDone,
}: {
  view: string;
  user: string;
  blocked: boolean;
  replay: number;
  onDone?: () => void;
}) {
  const steps = TOURS[view] ?? [];
  const [index, setIndex] = useState(-1);
  const [box, setBox] = useState<DOMRect | null>(null);

  // First visit of a screen (or «شرح الشاشة»): start once the screen has drawn and nothing covers it.
  useEffect(() => {
    setIndex(-1);
    if (!steps.length || blocked || (!replay && tourSeen(user, view))) return;
    const t = setTimeout(() => setIndex(first(0)), 900);
    return () => clearTimeout(t);
  }, [view, blocked, replay]);

  const first = (from: number) => {
    for (let i = from; i < steps.length; i++) if (document.querySelector(steps[i].target)) return i;
    return -1;
  };
  const place = () => {
    const el = index >= 0 ? document.querySelector(steps[index]?.target) : null;
    setBox(el ? el.getBoundingClientRect() : null);
  };
  useLayoutEffect(() => {
    if (index < 0) return;
    const el = document.querySelector(steps[index].target);
    el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [index]);

  const finish = () => {
    markTourSeen(user, view);
    setIndex(-1);
    onDone?.();
  };
  if (index < 0 || !box) return null;
  const step = steps[index];
  const next = first(index + 1);
  const zoom = Number((document.documentElement.style as any).zoom || 1);
  const r = { top: box.top / zoom, left: box.left / zoom, width: box.width / zoom, height: box.height / zoom };
  const vh = window.innerHeight / zoom,
    vw = window.innerWidth / zoom;
  const below = r.top + r.height + 190 < vh;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - 170, vw - 352));
  return (
    <div className="tour" role="dialog" aria-label={step.title}>
      <div className="tour-hole" style={{ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 }} />
      <div
        className="tour-tip"
        style={below ? { top: r.top + r.height + 14, left } : { top: Math.max(12, r.top - 14), left, transform: 'translateY(-100%)' }}
      >
        <small>
          {steps.filter((s, i) => i <= index && document.querySelector(s.target)).length} /{' '}
          {steps.filter((s) => document.querySelector(s.target)).length}
        </small>
        <b>{step.title}</b>
        <p>{step.text}</p>
        <div>
          {next >= 0 ? <button onClick={() => setIndex(next)}>التالي</button> : <button onClick={finish}>فهمت ✓</button>}
          {next >= 0 && (
            <button className="link" onClick={finish}>
              إنهاء الشرح
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

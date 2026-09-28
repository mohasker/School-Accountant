'use client';
import type { Workspace } from './context';
import { ItemLines, readItemLines, type Dialog } from './FormDialog';
import type { Row } from '../lib/api';
import { currency, IMPREST_TYPES } from '../lib/format';

export function newCaseDialog(w: Workspace): Dialog {
  const p = w.setup.policy || {};
  return {
    title: 'معاملة جديدة — تقرير عروض الأسعار',
    wide: true,
    intro: (
      <p>
        سجّل موضوع المعاملة والأصناف، ثم أدخل عروض أسعار الشركات؛ يُكلَّف الأقل سعراً المطابق للمواصفات، أو الشركة الوحيدة. حتى{' '}
        {currency(p.singleQuoteLimit)} ر.ق يكفي عرض واحد، وما يزيد يتطلب {p.minQuotes} عروض إلا للمورد المحتكر. ما يزيد عن{' '}
        {currency(p.tenderLimit)} ر.ق من اختصاص إدارة المشتريات بالوزارة.
      </p>
    ),
    fields: [
      { name: 'subject', label: 'موضوع المعاملة (مثل: توريد أقلام سبورة تفاعلية)' },
      {
        name: 'origin',
        label: 'نوع المعاملة',
        type: 'select',
        options: [
          { value: 'SCHOOL', label: 'مشتريات المدرسة (عروض أسعار)' },
          { value: 'MINISTRY', label: 'تكليف وارد من الوزارة' },
        ],
      },
      { name: 'ministryReference', label: 'مرجع التكليف الوزاري (للتكليف الوارد فقط)', required: false },
    ],
    body: <ItemLines budgets={w.setup.budgets || []} />,
    save: async (v, fd) => {
      const row = await w.api(w.root('cases'), 'POST', {
        subject: v.subject,
        origin: v.origin,
        ...(v.ministryReference ? { ministryReference: v.ministryReference } : {}),
        yearId: w.year,
        items: readItemLines(fd),
      });
      w.go('case', row.id);
    },
  };
}

/** New imprest: type, name, custodian, value and funding reference are asked every time. */
export function openImprestDialog(w: Workspace): Dialog {
  const school = w.setup.school || {};
  const yearLabel = w.setup.years?.find((y: Row) => y.id === w.year)?.label ?? '';
  return {
    title: 'عهدة جديدة',
    intro: (
      <p>
        حدد نوع العهدة وقيمتها المستلمة. العهدة النثرية تُستعاض عند صرف{' '}
        {Math.round(Number(w.setup.policy?.pettyReplenishPct ?? 0.75) * 100)}% من قيمتها؛ عهدة يوم التعليم ومعرض الكتاب والعهدة الخاصة
        تُسوّى وتُغلق.
      </p>
    ),
    fields: [
      {
        name: 'type',
        label: 'نوع العهدة',
        type: 'select',
        options: Object.entries(IMPREST_TYPES).map(([value, label]) => ({ value, label: String(label) })),
      },
      { name: 'name', label: 'اسم العهدة', value: 'العهدة ' + yearLabel },
      { name: 'custodian', label: 'مسؤول / أمين العهدة', value: school.pettyCustodian },
      { name: 'amount', label: 'قيمة العهدة المستلمة (ر.ق)', type: 'number' },
      { name: 'reference', label: 'مرجع التمويل (رقم الشيك / الكتاب)' },
    ],
    save: async (v) => {
      await w.api(w.root('imprests'), 'POST', {
        ...v,
        name: v.name.trim() === 'العهدة ' + yearLabel ? `${IMPREST_TYPES[v.type]} ${yearLabel}` : v.name,
        yearId: w.year,
      });
      w.go('imprests');
    },
  };
}

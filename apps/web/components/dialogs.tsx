'use client';
import type { Workspace } from './context';
import { ItemLines, readItemLines, type Dialog } from './FormDialog';
import { currency } from '../lib/format';

export function newCaseDialog(w: Workspace): Dialog {
  const p = w.setup.policy || {};
  return {
    title: 'معاملة شراء جديدة',
    wide: true,
    intro: (
      <p>
        حتى {currency(p.singleQuoteLimit)} ر.ق يكفي عرض سعر واحد، وما يزيد يتطلب {p.minQuotes} عروض أسعار على الأقل إلا إذا كان المورد
        محتكراً للصنف. ما يزيد عن {currency(p.tenderLimit)} ر.ق من اختصاص إدارة المشتريات والمناقصات بالوزارة. الاحتياجات الطارئة البسيطة
        تُصرف من النثرية.
      </p>
    ),
    fields: [
      { name: 'subject', label: 'موضوع المعاملة (يظهر في التقرير والتكليف)' },
      {
        name: 'origin',
        label: 'مصدر التكليف',
        type: 'select',
        options: [
          { value: 'SCHOOL', label: 'مشتريات المدرسة (عروض أسعار)' },
          { value: 'MINISTRY', label: 'تكليف وارد من الوزارة' },
        ],
      },
      { name: 'ministryReference', label: 'مرجع التكليف الوزاري (إن وجد)', required: false },
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

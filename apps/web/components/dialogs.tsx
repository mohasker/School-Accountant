'use client';
import type { Workspace } from './context';
import type { Dialog } from './FormDialog';
import { toNumberText } from './NumberInput';
import { caseDialogs, QuoteRows, readItems, readQuotes } from '../views/CaseDetail';
import type { Row } from '../lib/api';
import { currency, dateNow, IMPREST_TYPES } from '../lib/format';

/**
 * New file = the quote report itself: subject, budget line, report date and the companies with their
 * quote values. Saving issues the report (lowest compliant quote, or the only company) and opens the
 * assignment letter straight away. A ministry assignment takes the company and value of the first row.
 */
export function newCaseDialog(w: Workspace): Dialog {
  const p = w.setup.policy || {};
  return {
    title: 'معاملة جديدة — تقرير عروض الأسعار',
    wide: true,
    intro: (
      <p>
        اكتب موضوع المعاملة وبند الموازنة، ثم <b>الأصناف بكمياتها</b>، ثم لكل شركة <b>سعر الوحدة لكل صنف</b> (تُحسب القيمة تلقائياً). تظهر
        الأصناف صنفاً صنفاً في التقرير وكتاب التكليف. يُكلَّف الأقل سعراً أو الشركة الوحيدة، وتنتقل مباشرة إلى كتاب التكليف. حتى{' '}
        {currency(p.singleQuoteLimit)} ر.ق يكفي عرض واحد، وما يزيد يتطلب {p.minQuotes} عروض إلا للمورد المحتكر.
      </p>
    ),
    fields: [
      { name: 'subject', label: 'موضوع المعاملة (مثل: توريد أقلام سبورة تفاعلية)' },
      {
        name: 'budgetId',
        label: 'بند الموازنة',
        type: 'select',
        options: (w.setup.budgets || []).map((b: Row) => ({ value: b.id, label: `${b.code} — ${b.name}` })),
      },
      { name: 'date', label: 'تاريخ التقرير', type: 'date', value: dateNow() },
      {
        name: 'origin',
        label: 'نوع المعاملة',
        type: 'select',
        options: [
          { value: 'SCHOOL', label: 'مشتريات المدرسة (عروض أسعار)' },
          { value: 'MINISTRY', label: 'تكليف وارد من الوزارة' },
        ],
      },
      { name: 'exclusiveReason', label: 'مبرر احتكار الشركة (عند عرض واحد فوق الحد)', required: false },
      { name: 'ministryReference', label: 'مرجع التكليف الوزاري (للتكليف الوارد فقط)', required: false },
    ],
    body: <QuoteRows suppliers={w.setup.suppliers || []} />,
    submit: 'إصدار التقرير ← إعداد التكليف',
    save: async (v, fd) => {
      const items = readItems(fd);
      // Columns of the price grid follow the typed item rows; empty item rows are left out.
      const typed: number[] = [];
      for (let j = 0; fd.has('it_name_' + j); j++) if (String(fd.get('it_name_' + j) || '').trim()) typed.push(j);
      readQuotes(fd, typed.map(String), typed);
      const ministry = v.origin === 'MINISTRY';
      if (ministry && !v.ministryReference) throw Error('أدخل مرجع التكليف الوزاري');
      const row = await w.api(w.root('cases'), 'POST', {
        subject: v.subject,
        origin: v.origin,
        ...(ministry ? { ministryReference: v.ministryReference } : {}),
        yearId: w.year,
        items: items.map((it) => ({ ...it, budgetId: v.budgetId })),
      });
      const created = await w.api(w.root('cases/' + row.id));
      const ids = [...created.items].sort((a: Row, b: Row) => a.position - b.position).map((i: Row) => i.id);
      const quotes = readQuotes(fd, ids, typed);
      const act = (action: string, body: Row) => w.api(w.root(`cases/${row.id}/${action}`), 'POST', body);
      w.go('case', row.id);
      try {
        if (ministry)
          await act('direct-order', { supplierName: quotes[0].supplierName, prices: quotes[0].prices, reason: v.ministryReference });
        else {
          for (const q of quotes) await act('quotes', { ...q, quoteDate: v.date });
          await act('evaluate', { date: v.date, ...(v.exclusiveReason ? { exclusiveReason: v.exclusiveReason } : {}) });
        }
        w.open(caseDialogs(w, await w.api(w.root('cases/' + row.id))).order);
      } catch (e) {
        // The file and its quotes are saved; the message tells what is missing to issue the report.
        w.fail(e);
      }
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

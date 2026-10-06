'use client';
import type { Workspace } from '../components/context';
import { Table } from '../components/ui';
import type { Row } from '../lib/api';
import { currency } from '../lib/format';

/**
 * «الشهادات السابقة في سنواتها»: the school's certificates from the earlier register entered as earlier
 * expenses in their own fiscal years (missing years are opened). Shown first as a summary per year.
 */
export async function openLegacyImport(w: Workspace) {
  try {
    const preview = await w.api(w.root('legacy-import'));
    const pending = preview.years.filter((y: Row) => y.imported < y.count);
    w.open({
      title: 'إدخال الشهادات السابقة في سنواتها المالية',
      wide: true,
      intro: (
        <>
          <p>
            شهادات <b>{preview.school}</b> من سجل الشهادات السابقة تُسجَّل كمصروفات سابقة في عامها المالي، فتظهر في موازنة كل سنة. السنة غير
            الموجودة تُفتح تلقائياً ببنود الدليل. البند يُحدد من موضوع الشهادة ويُكتب «راجعه» في الملاحظة.
          </p>
          <p>
            في السنوات المنتهية: البند الذي لم يُدخل له اعتماد يُرفع بقدر ما صُرف (يمكن تعديل الاعتماد الحقيقي بعدها). في العام الحالي لا
            يتغير الاعتماد؛ الشهادة التي لا يكفيها رصيد البند تُذكر ولا تُسجل. التكرار لا يضيف شيئاً.
          </p>
          {preview.years.length ? (
            <Table heads={['العام', 'عدد الشهادات', 'الإجمالي', 'مسجلة من قبل']}>
              {preview.years.map((y: Row) => (
                <tr key={y.year}>
                  <td>{y.year}</td>
                  <td>{y.count}</td>
                  <td>{currency(y.total)}</td>
                  <td>{y.imported ? `${y.imported} من ${y.count}` : '—'}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="warn">لا توجد شهادات سابقة باسم هذه المدرسة في السجل.</p>
          )}
        </>
      ),
      submit: pending.length ? 'إدخال الشهادات' : 'إغلاق',
      save: async () => {
        if (!pending.length) return;
        const r = await w.api(w.root('legacy-import'), 'POST', {});
        setTimeout(
          () =>
            w.open({
              title: 'تم إدخال الشهادات السابقة',
              intro: (
                <>
                  <p>
                    سُجلت <b>{r.count}</b> شهادة بإجمالي <b>{currency(r.total)}</b> ر.ق.
                    {r.opened.length ? ` فُتحت السنوات: ${r.opened.join('، ')}.` : ''}
                  </p>
                  {r.raised.length > 0 && <p>رُفع اعتماد بنود في سنوات منتهية بقدر المصروف: {r.raised.join('، ')}.</p>}
                  {r.skipped.length > 0 && (
                    <p className="warn">
                      لم تُسجل {r.skipped.length}:{' '}
                      {r.skipped
                        .slice(0, 8)
                        .map((x: Row) => `م ${x.seq} (${x.reason})`)
                        .join('، ')}
                      {r.skipped.length > 8 ? '…' : ''}
                    </p>
                  )}
                  <p>اختر العام من أعلى الشاشة لرؤية موازنته.</p>
                </>
              ),
              submit: 'تم',
              save: async () => location.reload(),
            }),
          50,
        );
      },
    });
  } catch (e) {
    w.fail(e);
  }
}

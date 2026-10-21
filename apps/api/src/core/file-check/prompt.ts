import { DOC_TYPES } from './extract';
import { READING_RULES } from './extract';
import type { Expected } from './rules';
import { showAmount, showDate } from './normalize';

/**
 * Prompts the accountant copies, with the scanned file, into their own Claude or ChatGPT.
 * - reading: the service only reads the pages and answers in JSON; the reply is pasted back into the
 *   system, which applies its fixed rules and issues the official one-page report. It is not told the
 *   recorded values, so it cannot simply confirm them.
 * - review: a self-contained review in the chat (recorded values and rules included) for when the
 *   reply will not be pasted back; its result is advice, not the system's report.
 */

const SKELETON = `{
  "pages": [
    {
      "page": 1,
      "docType": "ORDER",
      "schoolName": "…",
      "supplierName": "…",
      "documentDate": "YYYY-MM-DD",
      "otherDates": [{ "label": "…", "date": "YYYY-MM-DD" }],
      "orderNumber": null,
      "invoiceNumber": null,
      "quoteReference": null,
      "crNumber": null,
      "validUntil": null,
      "iban": null,
      "amounts": { "total": null, "gross": null, "fine": null, "net": null },
      "items": [{ "name": "…", "qty": 0, "unitPrice": null, "total": null }],
      "signatures": [{ "role": "مدير المدرسة", "signed": true }],
      "stamp": true,
      "legible": "high",
      "remarks": null
    }
  ],
  "rules": [{ "id": "…", "met": "yes", "page": 1, "evidence": "…" }]
}`;

export function readingPrompt(rules: Expected['rules']) {
  return `${READING_RULES}

Administration requirements to answer in "rules" (by id):
${rules.length ? rules.map((r) => `- ${r.id}: ${r.text}`).join('\n') : '- none: return "rules": []'}

Output: ONE JSON object only, inside a single \`\`\`json code block, exactly in this shape (every field present; null or [] when not visible; numbers without commas or currency; dates YYYY-MM-DD; docType one of: ${Object.keys(DOC_TYPES).join(', ')}):
${SKELETON}

اقرأ الملف المرفق صفحة صفحة وأخرج النتيجة بصيغة JSON أعلاه فقط، دون أي شرح قبلها أو بعدها.`;
}

export function reviewPrompt(x: Expected) {
  const lines: string[] = [];
  lines.push('أنت مدقق مالي لمعاملات الشراء في المدارس الحكومية بدولة قطر. المرفق هو الملف الورقي الموقّع لمعاملة واحدة.');
  lines.push(
    'راجع كل ورقة مقابل البيانات المسجلة أدناه، واذكر كل مخالفة أو عدم تطابق أو نقص. لا تخمّن: ما لا يمكن قراءته اذكره كـ«غير مقروء».',
  );
  lines.push('');
  lines.push('البيانات المسجلة في النظام:');
  lines.push(`- المدرسة: ${x.school}`);
  lines.push(`- رقم المعاملة: ${x.caseNumber}`);
  if (x.supplier)
    lines.push(
      `- المورد: ${x.supplier.names.join(' / ')}${x.supplier.cr ? ` — سجل تجاري ${x.supplier.cr}` : ''}${x.supplier.iban ? ` — IBAN ${x.supplier.iban}` : ''}`,
    );
  if (x.report) {
    lines.push(`- تقرير دراسة العروض بتاريخ ${showDate(x.report.date)}، والعروض:`);
    for (const q of x.report.quotes)
      lines.push(`  • ${q.supplier} — مرجع ${q.reference || '—'} — ${showAmount(q.total)} ر.ق${q.date ? ` — ${showDate(q.date)}` : ''}`);
  }
  if (x.order)
    lines.push(
      `- كتاب التكليف رقم ${x.order.number} بتاريخ ${showDate(x.order.date)} بقيمة ${showAmount(x.order.total)} ر.ق، آخر موعد للتوريد ${showDate(x.order.dueDate)}`,
    );
  if (x.items.length) {
    lines.push(`- الأصناف (${x.items.length}):`);
    for (const i of x.items)
      lines.push(`  • ${i.name} — الكمية ${i.qty} — سعر الوحدة ${showAmount(i.unitPrice)}${i.accepted ? ` — المستلم ${i.accepted}` : ''}`);
  }
  for (const d of x.deliveries)
    lines.push(`- توريد بتاريخ ${showDate(d.date)} — فاتورة رقم ${d.invoice} — القيمة المستلمة ${showAmount(d.value)} ر.ق`);
  for (const c of x.certificates)
    lines.push(
      `- شهادة إنجاز بتاريخ ${showDate(c.date)}: المستحق ${showAmount(c.gross)}، الغرامة ${showAmount(c.fine)}، الصافي ${showAmount(c.net)} ر.ق${c.addressee ? `، موجهة إلى ${c.addressee}` : ''}${c.coverDate ? `؛ كتاب التغطية بتاريخ ${showDate(c.coverDate)}` : ''}`,
    );
  lines.push(`- العام المالي: ${showDate(x.year.start)} إلى ${showDate(x.year.end)}. تاريخ اليوم: ${showDate(x.today)}.`);
  lines.push('');
  lines.push('المستندات المطلوبة في الملف:');
  for (const r of x.required) lines.push(`- ${DOC_TYPES[r.type]} (${r.why})`);
  lines.push('');
  lines.push('ما يجب مراجعته:');
  lines.push('1. اسم المدرسة في كل ورقة صادرة من المدرسة وبنفس الصيغة تماماً؛ أي اسم مدرسة أخرى خطأ.');
  lines.push(
    '2. تسلسل التواريخ: دعوة الشركات ← عروض الأسعار ← تقرير العروض ← كتاب التكليف ← إذن التسليم من المورد ← إذن الاستلام من المدرسة ← شهادة الإنجاز ← كتاب التغطية؛ الفاتورة بعد التكليف وقبل الشهادة؛ لا تاريخ مستقبلي؛ وتاريخ كل مستند صادر من المدرسة يطابق المسجل.',
  );
  lines.push('3. رقم التكليف في التكليف والشهادة والفاتورة وإذن التسليم، ورقم الفاتورة في الفاتورة والشهادة.');
  lines.push(
    '4. الأصناف: العدد والأسماء والكميات في التكليف والعرض المرسى عليه والفاتورة وإذني التسليم والاستلام؛ وسعر الوحدة في الفاتورة لا يزيد عن التكليف.',
  );
  lines.push(
    '5. المبالغ: قيمة التكليف، الفاتورة لا تتجاوز التكليف، المستحق والغرامة والصافي في الشهادة، الصافي = المستحق − الغرامة، وصافي كتاب التغطية. إن كان الاستلام بعد آخر موعد فيجب وجود غرامة.',
  );
  lines.push('6. السجل التجاري لكل شركة قدمت عرضاً: موجود وساري في تاريخ التقرير.');
  lines.push('7. IBAN في إثبات الحساب البنكي (وأي ورقة أخرى) يطابق المسجل، واسم المستفيد هو المورد.');
  lines.push('8. التعهد بعدم تبعية الشركة لأي من منسوبي الوزارة: موجود وموقّع ومختوم من المورد.');
  lines.push(
    '9. التوقيعات: تقرير العروض (اللجنة / المدير)، التكليف (المدير)، إذن الاستلام (المستلم في المدرسة)، الشهادة (المدير والمحاسب)، التغطية (المدير)؛ وختم أو توقيع المورد على عرضه وفاتورته وإذن التسليم والتعهد؛ وختم المدرسة على التكليف والشهادة والتغطية.',
  );
  lines.push('10. اسم المورد نفسه في التكليف والفاتورة وإذن التسليم والشهادة والتغطية والتعهد وإثبات الحساب.');
  if (x.rules.length) {
    lines.push('11. متطلبات الإدارة:');
    for (const r of x.rules) lines.push(`   - ${r.text} (${r.level === 'ERROR' ? 'مخالفتها خطأ' : 'مخالفتها تنبيه'})`);
  }
  lines.push('');
  lines.push('شكل الإجابة (صفحة واحدة بالعربية):');
  lines.push('- سطر النتيجة: «جاهز للإرسال» أو «جاهز بعد مراجعة التنبيهات» أو «يحتاج تصحيحاً قبل الإرسال»، مع عدد الأخطاء والتنبيهات.');
  lines.push('- أخطاء تمنع الإرسال: نقطة لكل خطأ تذكر رقم الصفحة ونوع المستند والقيمة على الورق مقابل المسجل.');
  lines.push('- تنبيهات تحتاج قراراً، ثم ملاحظات.');
  lines.push('- جدول قصير بالمستندات المطلوبة: موجود / غير موجود / غير مقروء، ورقم الصفحة.');
  lines.push('لا تكتب أي شيء خارج هذا الشكل.');
  return lines.join('\n');
}

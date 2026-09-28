/**
 * Supporting documents of a purchase file. Codes 1–12 and 15 are reviewed before the completion
 * certificate; 13 and 14 are the signed certificate and its covering letter, linked to a certificate.
 * `print` is the wording used in the attachments list of the completion certificate.
 */
export const EVIDENCE: Record<number, { name: string; print: string }> = {
  1: { name: 'دعوة الشركات', print: 'دعوة الشركات للمشاركة وتقديم عروض الأسعار.' },
  2: { name: 'عروض الأسعار', print: 'عروض الأسعار كاملة.' },
  3: { name: 'السجلات التجارية', print: 'السجلات التجارية للشركات المقدمة لعروض الأسعار.' },
  4: { name: 'تقرير دراسة العروض', print: 'تقرير دراسة عروض الأسعار.' },
  5: { name: 'كتاب التكليف', print: 'أمر التكليف / التوريد.' },
  6: { name: 'الفاتورة', print: 'فاتورة المورد.' },
  7: { name: 'إذن التسليم من المورد', print: 'إذن الاستلام / التسليم من المورد.' },
  8: { name: 'إذن الاستلام من المدرسة', print: 'إذن الاستلام من المدرسة.' },
  9: { name: 'كتاب التعهد (إقرار المورد)', print: 'التعهد (إقرار المورد).' },
  10: { name: 'إثبات الحساب البنكي IBAN', print: 'رقم الحساب البنكي.' },
  11: { name: 'موافقة القسم المختص', print: 'موافقة القسم المختص (إذا كانت مطلوبة).' },
  12: { name: 'كشوف المستفيدين / توزيع الهدايا', print: 'كشوف وبيانات المستفيدين.' },
  13: { name: 'شهادة الإنجاز الموقعة', print: 'شهادة الإنجاز الموقعة.' },
  14: { name: 'كتاب التغطية الموقع', print: 'كتاب التغطية الموقع.' },
  15: { name: 'موافقة إدارة المشتريات على أمر التوريد', print: 'موافقة إدارة المشتريات على إصدار أمر التوريد.' },
};

/** Documents required before a certificate. */
export const PRE_CERTIFICATE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15];
export const SIGNED = [13, 14];

/** Which documents may be marked "not applicable" (with a reason) for a given purchase method. */
export function waivable(code: number, origin: string, method?: string | null) {
  if ([11, 12, 15].includes(code)) return true;
  if (origin === 'MINISTRY') return [1, 2, 3, 4].includes(code);
  if (method === 'SINGLE_QUOTE' || method === 'EXCLUSIVE') return code === 1;
  return false;
}

/** Attachments list of the payment covering letter (from the completion-certificate workbook). */
export const COVER_ATTACHMENTS: { key: string; text: string; evidence?: number }[] = [
  { key: 'certificate', text: 'شهادة إنجاز الأعمال.' },
  { key: 'invoice', text: 'فاتورة بالمبلغ المستحق (أصل) معتمدة من الشركة.', evidence: 6 },
  { key: 'order', text: 'كتاب التكليف الصادر إلى الشركة.', evidence: 5 },
  { key: 'supplierReceipt', text: 'سند الاستلام من الشركة معتمد من المدرسة.', evidence: 7 },
  { key: 'schoolReceipt', text: 'سند الاستلام من المدرسة معتمد.', evidence: 8 },
  { key: 'iban', text: 'صورة IBAN (بيان رقم حساب البنك للشركة).', evidence: 10 },
  { key: 'quoteReport', text: 'تقرير عروض الأسعار معتمد من المدرسة.', evidence: 4 },
  { key: 'quotes', text: 'عروض الأسعار للشركات المختلفة.', evidence: 2 },
  { key: 'crs', text: 'السجلات التجارية الخاصة بالشركات المقدمة لعروض الأسعار.', evidence: 3 },
  { key: 'deptApproval', text: 'موافقة القسم المختص بالوزارة.', evidence: 11 },
  { key: 'undertaking', text: 'التعهد (الإقرار) بعدم تابعية الشركة لأي من منسوبي الوزارة.', evidence: 9 },
  { key: 'localPo', text: 'أمر شراء محلي (إدارة المشتريات والمناقصات).' },
  { key: 'beneficiaries', text: 'كشوف بيانات المستفيدين بالهدايا.', evidence: 12 },
  { key: 'procurementApproval', text: 'موافقة إدارة المشتريات على إصدار أمر التوريد.', evidence: 15 },
];

export const METHOD_NAMES: Record<string, string> = {
  SINGLE_QUOTE: 'عرض سعر واحد (ضمن حد الشراء المباشر)',
  THREE_QUOTES: 'مقارنة عروض أسعار',
  EXCLUSIVE: 'مورد محتكر للصنف',
  MINISTRY: 'تكليف وارد من الوزارة',
};

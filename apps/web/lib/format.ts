import type { Row } from './api';

export const STATE_NAMES: Row = {
  DRAFT: 'تقرير العروض قيد الإعداد',
  EVALUATED: 'بانتظار الاعتماد',
  APPROVED: 'جاهزة لإصدار التكليف',
  ORDERED: 'صدر التكليف — قيد التنفيذ',
  PARTIAL: 'توريد جزئي',
  DELIVERED: 'تم الاستلام',
  CERTIFIED: 'منجزة — صدرت الشهادة والتغطية',
  COMPLETE: 'منجزة',
  REGISTERED: 'منجزة ومسجلة في ERP',
  CANCELLED: 'ملغاة',
};
/** States offered in the transaction filter (legacy intermediate states are still displayed). */
export const STATES = ['DRAFT', 'APPROVED', 'ORDERED', 'CERTIFIED', 'REGISTERED', 'CANCELLED'];

export const EVIDENCE_STATUS: Row = { VERIFIED: 'متحقق منه', PENDING: 'بانتظار المراجعة', REJECTED: 'مرفوض', NA: 'لا ينطبق' };

/** Supporting documents (same codes as the API). */
export const EVIDENCE: Record<number, string> = {
  1: 'دعوة الشركات',
  2: 'عروض الأسعار',
  3: 'السجلات التجارية',
  4: 'تقرير دراسة العروض',
  5: 'كتاب التكليف',
  6: 'الفاتورة',
  7: 'إذن التسليم من المورد',
  8: 'إذن الاستلام من المدرسة',
  9: 'كتاب التعهد (إقرار المورد)',
  10: 'إثبات الحساب البنكي IBAN',
  11: 'موافقة القسم المختص',
  12: 'كشوف المستفيدين / توزيع الهدايا',
  15: 'موافقة إدارة المشتريات على أمر التوريد',
  13: 'شهادة الإنجاز الموقعة',
  14: 'كتاب التغطية الموقع',
};
export const EVIDENCE_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 13, 14];

export const METHOD_NAMES: Row = {
  SINGLE_QUOTE: 'عرض سعر واحد',
  THREE_QUOTES: 'مقارنة عروض أسعار',
  EXCLUSIVE: 'مورد محتكر',
  MINISTRY: 'تكليف وزاري',
};

export const IMPREST_TYPES: Row = {
  PETTY: 'العهدة النثرية',
  EDUCATION: 'عهدة يوم التعليم',
  BOOK: 'عهدة معرض الكتاب',
  OTHER: 'عهدة خاصة',
};

/** Roles offered when assigning a user to a school: the accountant does every step; the auditor only reads. */
export const ROLE_CHOICES = ['ACCOUNTANT', 'AUDITOR'];
export const ROLE_NAMES: Row = {
  ACCOUNTANT: 'محاسب (كل الأعمال)',
  REVIEWER: 'مراجع',
  APPROVER: 'معتمد',
  ERP: 'مسجل ERP',
  AUDITOR: 'اطلاع فقط',
  ADMIN: 'مسؤول المدرسة',
};

export const BUDGET_GROUPS: Row = {
  INSTRUCTIONAL: 'الأنشطة التعليمية',
  NON_INSTRUCTIONAL: 'نشاطات غير تعليمية',
  MAINTENANCE: 'مصاريف الصيانة',
  STUDENT: 'خدمات طلابية',
  OTHER: 'بنود أخرى',
};

export const currency = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const day = (v: unknown) => (v ? String(v).slice(0, 10) : '—');
export const dateNow = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Qatar' });
export const percent = (v: unknown) => `${Math.round(Number(v || 0) * 100)}%`;

export function downloadFile(file: Row) {
  const data = Uint8Array.from(atob(file.base64 ?? file.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([data], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Opens a stored document in a new window for printing / «Save as PDF». A base URL is added so the
 * letterhead logo (/brand/moehe-logo.png) resolves in the new window.
 */
export function showPrint(html: string): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  const withBase = html.replace('<head>', `<head><base href="${location.origin}/">`);
  w.document.open();
  w.document.write(withBase);
  w.document.close();
  w.onload = () => setTimeout(() => w.print(), 200);
  return true;
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' && !quoted) {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (quoted) throw Error('علامات اقتباس غير مغلقة في CSV');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const heads = rows.shift()?.map((x) => x.replace(/^﻿/, '')) || [];
  if (!heads.includes('name') || !heads.includes('cr')) throw Error('يلزم عمودا name و cr');
  return rows.map((r) => ({
    name: r[heads.indexOf('name')] || '',
    cr: r[heads.indexOf('cr')] || '',
    phone: r[heads.indexOf('phone')] || '',
    email: r[heads.indexOf('email')] || '',
  }));
}

/** CSV with a BOM for Excel; cells starting with = + @ - are neutralised against formula injection. */
export function downloadCsv(name: string, rows: unknown[][]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? '')
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const data = rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + data], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

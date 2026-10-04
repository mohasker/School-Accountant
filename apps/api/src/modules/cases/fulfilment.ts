import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { hash } from '../../common/crypto';
import { isoDay, today } from '../../common/dates';
import { D, num, round, sum } from '../../common/money';
import { date, fail, id, parse, plain, quantity, text } from '../../common/validation';
import { COVER_ATTACHMENTS, DEFAULT_COVER, EVIDENCE, SIGNED, waivable } from '../../core/documents';
import { ACCOUNT, APPROVE, ERP, REVIEW, scope } from '../../core/identity';
import { posting } from '../../core/ledger';
import { checkUpload } from '../../core/uploads';
import { fine } from '../../core/penalty';
import { loadCalendar } from '../../core/policy';
import { formatNumber, nextNumber } from '../../core/transaction';
import { certificateCover, certificateDocument, RATINGS, type CertificateData } from '../../print/certificate';
import { ADDRESSEES } from '../../print/layout';
import type { Tx } from '../../common/db';
import type { WriteCtx } from '../context';
import { getCase, requireState, verifiedCodes, type FullCase } from './common';
import { orderPolicy } from './procurement';
import { requireCertificateApproval } from './approvals';

type Ctx = WriteCtx & { c: FullCase };

/** Records a delivery; only accepted quantities count, and each portion carries its own working-day delay. */
export async function deliver({ s, school, t, body, c }: Ctx) {
  scope(s, school, ACCOUNT);
  requireState(c, ['ORDERED', 'PARTIAL']);
  const p = parse(
    z
      .object({
        date,
        note: text,
        invoice: text,
        invoiceAmount: z.union([z.string().regex(/^\d{1,12}(\.\d{1,2})?$/), z.number().nonnegative()]).optional(),
        lines: z.array(z.object({ itemId: id, received: quantity, accepted: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/) })).min(1),
      })
      .strict(),
    body,
  );
  if (p.date > today() || p.date < isoDay(c.issueDate!)) fail('تاريخ توريد غير صالح');
  if (new Set(p.lines.map((l) => l.itemId)).size !== p.lines.length) fail('بند مكرر');
  const { rate, weekend } = orderPolicy(c);
  const calendar = await loadCalendar(t, s.user.tenantId, weekend);
  const lateDays = calendar.workingDaysBetween(isoDay(c.dueDate!), p.date);
  const d = await t.delivery.create({
    data: {
      caseId: c.id,
      schoolId: school,
      yearId: c.yearId,
      date: new Date(p.date),
      note: p.note,
      invoice: p.invoice,
      invoiceAmount: p.invoiceAmount != null ? String(p.invoiceAmount) : null,
      createdBy: s.user.id,
    },
  });
  let deliveredValue = new D(0);
  for (const l of p.lines) {
    const i = c.items.find((i) => i.id === l.itemId);
    if (!i) fail('بند غير صحيح');
    const accepted = new D(l.accepted),
      received = new D(l.received),
      newQty = i.acceptedQty.plus(accepted);
    if (accepted.gt(received) || newQty.gt(i.qty)) fail('الكمية المقبولة تتجاوز المستلم أو المتبقي');
    // Value by cumulative share, so rounding never leaves the item total off by a dirham.
    const value = round(i.value.mul(newQty).div(i.qty)).minus(i.acceptedValue);
    await t.portion.create({
      data: { caseId: c.id, deliveryId: d.id, itemId: i.id, received, accepted, value, lateDays, rawFine: value.mul(rate).mul(lateDays) },
    });
    await t.item.update({ where: { id: i.id }, data: { acceptedQty: newQty, acceptedValue: i.acceptedValue.plus(value) } });
    deliveredValue = deliveredValue.plus(value);
  }
  // The supplier's invoice must carry exactly the value of what was accepted on it.
  if (p.invoiceAmount != null && !new D(String(p.invoiceAmount)).eq(deliveredValue))
    fail(
      `قيمة الفاتورة ${num(new D(String(p.invoiceAmount)))} لا تساوي قيمة الكميات المستلمة ${num(deliveredValue)}؛ راجع الفاتورة أو الكميات`,
    );
  const items = await t.item.findMany({ where: { caseId: c.id } });
  await t.case.update({
    where: { id: c.id },
    data: { state: items.every((i) => i.acceptedQty.eq(i.qty)) ? 'DELIVERED' : 'PARTIAL', version: { increment: 1 } },
  });
  return d;
}

export async function uploadEvidence({ s, school, t, body, c }: Ctx) {
  scope(s, school, ACCOUNT);
  requireState(c, ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED', 'CERTIFIED']);
  const p = parse(
    z
      .object({
        code: z
          .number()
          .int()
          .refine((v) => v in EVIDENCE, 'نوع مستند غير معروف'),
        name: text,
        mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
        base64: z.string().max(7100000),
        certificateId: id.optional(),
      })
      .strict(),
    body,
  );
  const signed = SIGNED.includes(p.code);
  if (signed && (!p.certificateId || !c.certificates.some((x) => x.id === p.certificateId))) fail('اختر الشهادة المرتبطة بالنسخة الموقعة');
  if (!signed && p.certificateId) fail('ربط الشهادة مخصص للنسخ الموقعة');
  const data = Buffer.from(p.base64, 'base64');
  if (data.length === 0 || data.length > 5 * 1024 * 1024) fail('الملف فارغ أو يتجاوز 5 MB');
  const scanStatus = checkUpload(p.mime, data);
  return t.evidence.create({
    data: {
      caseId: c.id,
      code: p.code,
      certificateId: p.certificateId,
      name: p.name,
      mime: p.mime,
      data,
      hash: hash(data),
      uploadedBy: s.user.id,
      scanStatus,
    },
    select: { id: true, name: true, status: true, code: true },
  });
}

export async function verifyEvidence({ s, school, t, body, c }: Ctx) {
  scope(s, school, REVIEW);
  const p = parse(z.object({ evidenceId: id, decision: z.enum(['VERIFIED', 'REJECTED']), reason: text }).strict(), body);
  const e = await t.evidence.findUnique({ where: { id: p.evidenceId, caseId: c.id } });
  if (!e) throw new NotFoundException();
  if (c.state === 'REGISTERED') fail('المعاملة مسجلة؛ يلزم تصحيح مستقل');
  if (p.decision === 'VERIFIED' && process.env.DEMO_MODE !== 'true' && !['CLEAN', 'NOT_SCANNED'].includes(e.scanStatus))
    fail('يلزم فحص الملف');
  return t.evidence.update({ where: { id: e.id }, data: { status: p.decision, verifiedBy: s.user.id, reason: p.reason } });
}

export async function notApplicable({ s, school, t, body, c }: Ctx) {
  scope(s, school, APPROVE);
  const p = parse(z.object({ code: z.number().int(), reason: text }).strict(), body);
  if (!waivable(p.code, c.origin, c.method)) fail('لا يمكن إعفاء هذا المستند');
  return t.evidence.create({
    data: {
      caseId: c.id,
      code: p.code,
      name: EVIDENCE[p.code].name,
      mime: 'text/plain',
      hash: hash(p.reason),
      status: 'NA',
      uploadedBy: s.user.id,
      verifiedBy: s.user.id,
      reason: p.reason,
      scanStatus: 'NOT_APPLICABLE',
    },
  });
}

/** The addressed department: its name from the tenant's list, or (older clients) its position in it. */
const addresseeInput = z.union([z.number().int().min(1).max(50), z.string().trim().min(1).max(120)]).default(1);
export async function tenantAddressees(t: { tenant: { findUniqueOrThrow: any } }, tenantId: string): Promise<string[]> {
  const row = await t.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { addressees: true } });
  const list = Array.isArray(row.addressees) ? (row.addressees as unknown[]).map(String).filter(Boolean) : [];
  return list.length ? list : [...ADDRESSEES];
}
async function resolveAddressee(t: Tx, tenantId: string, a: number | string) {
  const list = await tenantAddressees(t, tenantId);
  if (typeof a === 'number') return list[a - 1] ?? fail('الجهة المرسل إليها غير موجودة في القائمة');
  if (!list.includes(a)) fail('الجهة المرسل إليها غير موجودة في القائمة؛ يضيفها مسؤول النظام من الإعدادات');
  return a;
}

const rating = z.enum(Object.keys(RATINGS) as [keyof typeof RATINGS, ...(keyof typeof RATINGS)[]]);

/** Completion certificate for all accepted, not yet certified quantities (partial or final). */
export async function issueCertificate({ s, school, t, body, c }: Ctx) {
  scope(s, school, APPROVE);
  requireState(c, ['PARTIAL', 'DELIVERED']);
  const p = parse(
    z
      .object({
        kind: z.enum(['PARTIAL', 'FINAL']),
        date: date.optional(),
        present: z.array(z.string().max(30)).max(30).optional(),
        addressee: addresseeInput,
        invoice: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(1000).default(''),
        ratings: z
          .object({ scope: rating, time: rating, supervision: rating })
          .default({ scope: 'EXCELLENT', time: 'EXCELLENT', supervision: 'EXCELLENT' }),
      })
      .strict(),
    body,
  );
  if (p.kind === 'PARTIAL' && c.state === 'DELIVERED') fail('اختر الشهادة النهائية بعد اكتمال التوريد');
  if (p.kind === 'FINAL' && c.state !== 'DELIVERED') fail('يلزم اكتمال التوريد للشهادة النهائية');
  const on = p.date ?? today();
  if (on > today()) fail('تاريخ مستقبلي');
  const pending = await t.portion.findMany({
    where: { caseId: c.id, certificateId: null, accepted: { gt: 0 } },
    include: { item: true, delivery: true },
    orderBy: { item: { position: 'asc' } },
  });
  if (!pending.length) fail('لا توجد كميات جديدة للشهادة');
  const lastReceipt = pending
    .map((r) => isoDay(r.delivery.date))
    .sort()
    .at(-1)!;
  if (on < lastReceipt) fail('تاريخ شهادة الإنجاز قبل تاريخ الاستلام؛ صحّح أحد التاريخين');
  await certificateGate(t, s.user.tenantId, c, p.present, on);
  await requireCertificateApproval(t, s, c);
  const all = await t.portion.findMany({ where: { caseId: c.id, accepted: { gt: 0 } } });
  const { rate, cap } = orderPolicy(c);
  const prior = sum(c.certificates.map((x) => x.fine)),
    calc = fine(
      c.total.toString(),
      all.map((r) => ({ value: r.value.toString(), lateDays: r.lateDays })),
      prior.toString(),
      rate,
      cap,
    ),
    gross = sum(pending.map((r) => r.value)),
    net = gross.minus(calc.current);
  if (net.lt(0)) fail('الخصم أكبر من المستحق الحالي؛ يلزم مراجعة');
  const supplier = (c.supplierSnapshot ?? c.supplier) as any;
  const number = formatNumber('CC', await nextNumber(t, school, c.yearId, 'CC'));
  const lateDays = Math.max(...pending.map((r) => r.lateDays));
  const data: CertificateData = {
    number,
    kind: p.kind,
    date: on,
    addressee: await resolveAddressee(t, s.user.tenantId, p.addressee),
    school: c.school.name,
    principal: c.principalName,
    accountant: c.accountantName,
    supplier: supplier?.name ?? '',
    subject: c.subject,
    orderNumber: c.orderNumber ?? '',
    orderDate: isoDay(c.issueDate!),
    orderValue: num(c.total),
    invoice: p.invoice || [...new Set(pending.map((r) => r.delivery.invoice))].join('، '),
    deliveryDate: pending
      .map((r) => isoDay(r.delivery.date))
      .sort()
      .at(-1)!,
    gross: num(gross),
    hasFine: calc.current.gt(0),
    deliveryDays: c.deliveryDays,
    lateDays,
    fine: num(calc.current),
    finePct: gross.gt(0) ? calc.current.div(gross).mul(100).toDecimalPlaces(2).toString() : '0',
    net: num(net),
    priorFine: num(prior),
    cumulativeFine: num(calc.capped),
    notes: p.notes,
    ratings: p.ratings,
    attachments: verifiedCodes(c),
  };
  const cert = await t.certificate.create({
    data: {
      caseId: c.id,
      number,
      kind: p.kind,
      gross,
      fine: calc.current,
      net,
      snapshot: plain({ ...data, supplierRecord: supplier, lines: pending, policy: c.policy, evidence: c.evidence }),
      details: plain(data),
      html: certificateDocument(data),
      createdBy: c.createdBy,
      issuedBy: s.user.id,
    },
  });
  for (const r of [...pending].sort((a, b) => a.item.budgetId.localeCompare(b.item.budgetId))) {
    await posting(t, r.item.budgetId, r.value.neg(), r.value, 'certificate:' + r.id, cert.id, s.user.id);
    await t.item.update({ where: { id: r.itemId }, data: { certifiedQty: { increment: r.accepted } } });
    await t.portion.update({ where: { id: r.id }, data: { certificateId: cert.id } });
  }
  await t.case.update({ where: { id: c.id }, data: { state: p.kind === 'FINAL' ? 'CERTIFIED' : c.state, version: { increment: 1 } } });
  return cert;
}

/** Payment covering letter; the attachments list defaults to the verified documents. */
export async function coverLetter({ s, school, t, body, c }: Ctx) {
  scope(s, school, ACCOUNT);
  const p = parse(
    z
      .object({
        certificateId: id,
        date: date.optional(),
        attachments: z.array(z.enum(COVER_ATTACHMENTS.map((a) => a.key) as [string, ...string[]])).optional(),
      })
      .strict(),
    body,
  );
  const cert = c.certificates.find((x) => x.id === p.certificateId);
  if (!cert) throw new NotFoundException();
  if (cert.coverHtml) return cert;
  const verified = verifiedCodes(c);
  const fromDocuments = COVER_ATTACHMENTS.filter((a) => a.evidence && verified.includes(a.evidence)).map((a) => a.key);
  const attachments = p.attachments ?? (fromDocuments.length ? fromDocuments : DEFAULT_COVER(c.origin, c.method));
  const details = (cert.details ?? cert.snapshot) as CertificateData;
  const coverDate = p.date ?? today();
  if (coverDate > today()) fail('تاريخ مستقبلي');
  if (coverDate < String(details.date)) fail('تاريخ كتاب التغطية قبل تاريخ شهادة الإنجاز؛ صحّح أحد التاريخين');
  return t.certificate.update({
    where: { id: cert.id },
    data: {
      coverHtml: certificateCover({ ...details, coverDate, coverAttachments: attachments }),
      details: plain({ ...details, cover: { date: coverDate, attachments } }),
    },
  });
}

/** Legacy step kept for files issued before the single-step completion: marks the file complete. */
export async function completeFile({ s, school, t, c }: Ctx) {
  scope(s, school, APPROVE);
  requireState(c, ['CERTIFIED']);
  if (!c.certificates.length || c.certificates.some((x) => !x.coverHtml)) fail('أصدر الشهادة وكتاب التغطية أولاً');
  await t.certificate.updateMany({ where: { caseId: c.id }, data: { finalized: true } });
  return t.case.update({ where: { id: c.id }, data: { state: 'COMPLETE', version: { increment: 1 } } });
}

/**
 * Completion in one step after the work is done: the remaining quantities are received on the
 * completion date (delay in working days after the due date), the final completion certificate is
 * issued, and the payment covering letter is issued with it.
 */
export async function finish(ctx: Ctx) {
  const { s, school, t, body } = ctx;
  scope(s, school, ACCOUNT);
  requireState(ctx.c, ['ORDERED', 'PARTIAL', 'DELIVERED']);
  const p = parse(
    z
      .object({
        completionDate: date,
        invoice: z.string().trim().min(1).max(200),
        invoiceAmount: z.union([z.string().regex(/^\d{1,12}(\.\d{1,2})?$/), z.number().nonnegative()]).optional(),
        present: z.array(z.string().max(30)).max(30).optional(),
        note: z.string().trim().max(200).optional(),
        date: date.optional(),
        addressee: addresseeInput,
        notes: z.string().trim().max(1000).default(''),
        ratings: z
          .object({ scope: rating, time: rating, supervision: rating })
          .default({ scope: 'EXCELLENT', time: 'EXCELLENT', supervision: 'EXCELLENT' }),
        attachments: z.array(z.enum(COVER_ATTACHMENTS.map((a) => a.key) as [string, ...string[]])).optional(),
      })
      .strict(),
    body,
  );
  let c = ctx.c;
  const remaining = c.items.filter((i) => i.acceptedQty.lt(i.qty));
  if (remaining.length) {
    await deliver({
      ...ctx,
      c,
      body: {
        date: p.completionDate,
        note: p.note || 'استلام نهائي',
        invoice: p.invoice,
        ...(p.invoiceAmount != null ? { invoiceAmount: p.invoiceAmount } : {}),
        lines: remaining.map((i) => {
          const rest = i.qty.minus(i.acceptedQty).toString();
          return { itemId: i.id, received: rest, accepted: rest };
        }),
      },
    });
    c = await getCase(t, school, c.id);
  }
  const cert = await issueCertificate({
    ...ctx,
    c,
    body: {
      kind: 'FINAL',
      date: p.date,
      addressee: p.addressee,
      invoice: p.invoice,
      notes: p.notes,
      ratings: p.ratings,
      ...(p.present ? { present: p.present } : {}),
    },
  });
  c = await getCase(t, school, c.id);
  await coverLetter({ ...ctx, c, body: { certificateId: cert.id, date: p.date, attachments: p.attachments } });
  return cert;
}

/** Manual, documented ERP registration — there is no live integration with the ministry system. */
export async function registerErp({ s, school, t, body, c }: Ctx) {
  scope(s, school, ERP);
  requireState(c, ['CERTIFIED', 'COMPLETE']);
  const p = parse(z.object({ reference: text, date, evidence: text }).strict(), body);
  if (p.date > today()) fail('تاريخ مستقبلي');
  const lastCert = c.certificates
    .map((x) => String(((x.details ?? x.snapshot) as any)?.date ?? ''))
    .sort()
    .at(-1);
  if (lastCert && p.date < lastCert) fail('تاريخ قيد ERP قبل تاريخ شهادة الإنجاز');
  const erp = await t.erp.create({
    data: { caseId: c.id, schoolId: school, reference: p.reference, date: new Date(p.date), evidence: p.evidence, actor: s.user.id },
  });
  await t.case.update({ where: { id: c.id }, data: { state: 'REGISTERED', version: { increment: 1 } } });
  return erp;
}

/**
 * Optional gate before a completion certificate (administrator's switch): every document required
 * for payment is ticked as present in the paper file, the supplier's IBAN is verified, and the
 * supplier's commercial registration is not expired on the certificate date.
 */
async function certificateGate(t: Tx, tenantId: string, c: FullCase, present: string[] | undefined, on: string) {
  const tenant = await t.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { certGate: true, checkDocs: true } });
  if (!tenant.certGate) return;
  const required = gateDocuments(c, tenant.checkDocs);
  const missing = required.filter((d) => !(present ?? []).includes(d.type));
  if (missing.length) fail('قبل الشهادة أكّد وجود هذه المستندات في الملف: ' + missing.map((d) => d.label).join('، '));
  const card = c.supplier?.cardId ? await t.supplierCard.findUnique({ where: { id: c.supplier.cardId } }) : null;
  if (!card?.ibanVerified) fail('قبل الشهادة: IBAN المورد غير متحقق منه في بنك الموردين');
  if (card.crExpiry && isoDay(card.crExpiry) < on) fail(`قبل الشهادة: السجل التجاري للمورد منتهٍ في ${isoDay(card.crExpiry)}`);
}

const GATE_LABELS: Record<string, string> = {
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
};

/** The documents the gate asks for in this case (also shown in the completion dialog). */
export function gateDocuments(c: { origin: string; reportDate?: Date | null }, checkDocs: unknown) {
  const list = new Set<string>(['ORDER', 'INVOICE', 'RECEIPT']);
  if (c.origin === 'SCHOOL' && c.reportDate) list.add('QUOTE_REPORT');
  for (const d of Array.isArray(checkDocs) ? (checkDocs as string[]) : [])
    if (GATE_LABELS[d] && !(c.origin === 'MINISTRY' && ['QUOTE', 'CR', 'QUOTE_REPORT', 'INVITATION'].includes(d))) list.add(d);
  return [...list].map((type) => ({ type, label: GATE_LABELS[type] }));
}

import { NotFoundException } from '@nestjs/common';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { hash } from '../../common/crypto';
import { isoDay, today } from '../../common/dates';
import { D, num, round, sum } from '../../common/money';
import { date, fail, id, parse, plain, quantity, text } from '../../common/validation';
import { COVER_ATTACHMENTS, EVIDENCE, SIGNED, waivable } from '../../core/documents';
import { ACCOUNT, APPROVE, ERP, REVIEW, scope } from '../../core/identity';
import { posting } from '../../core/ledger';
import { fine } from '../../core/penalty';
import { loadCalendar } from '../../core/policy';
import { formatNumber, nextNumber } from '../../core/transaction';
import { certificateCover, certificateDocument, RATINGS, type CertificateData } from '../../print/certificate';
import type { WriteCtx } from '../context';
import { checklist, independent, requireState, verifiedCodes, type FullCase } from './common';
import { orderPolicy } from './procurement';

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
        lines: z
          .array(z.object({ itemId: id, received: quantity, accepted: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/) }))
          .min(1),
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
    data: { caseId: c.id, schoolId: school, yearId: c.yearId, date: new Date(p.date), note: p.note, invoice: p.invoice, createdBy: s.user.id },
  });
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
  }
  const items = await t.item.findMany({ where: { caseId: c.id } });
  await t.case.update({
    where: { id: c.id },
    data: { state: items.every((i) => i.acceptedQty.eq(i.qty)) ? 'DELIVERED' : 'PARTIAL', version: { increment: 1 } },
  });
  return d;
}

const MIME_SIGNATURE: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
};

/** Outside demo mode every upload must pass the configured virus scanner (ClamAV by default). */
function scan(data: Buffer) {
  if (process.env.DEMO_MODE === 'true') return 'DEMO_UNSCANNED';
  const dir = mkdtempSync(join(tmpdir(), 'sa-scan-'));
  try {
    const path = join(dir, 'upload');
    writeFileSync(path, data, { mode: 0o600 });
    const result = spawnSync(process.env.UPLOAD_SCANNER || 'clamscan', ['--no-summary', path], { timeout: 30000 });
    if (result.status !== 0) fail('تعذر فحص الملف أو اكتشاف ملف غير آمن');
    return 'CLEAN';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function uploadEvidence({ s, school, t, body, c }: Ctx) {
  scope(s, school, ACCOUNT);
  requireState(c, ['DRAFT', 'EVALUATED', 'APPROVED', 'ORDERED', 'PARTIAL', 'DELIVERED', 'CERTIFIED']);
  const p = parse(
    z
      .object({
        code: z.number().int().refine((v) => v in EVIDENCE, 'نوع مستند غير معروف'),
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
  if (!MIME_SIGNATURE[p.mime](data)) fail('محتوى الملف لا يطابق نوعه');
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
      scanStatus: scan(data),
    },
    select: { id: true, name: true, status: true, code: true },
  });
}

export async function verifyEvidence({ s, school, t, body, c }: Ctx) {
  scope(s, school, REVIEW);
  const p = parse(z.object({ evidenceId: id, decision: z.enum(['VERIFIED', 'REJECTED']), reason: text }).strict(), body);
  const e = await t.evidence.findUnique({ where: { id: p.evidenceId, caseId: c.id } });
  if (!e) throw new NotFoundException();
  if (e.uploadedBy === s.user.id) fail('المراجع يجب أن يختلف عن رافع المستند');
  if (c.state === 'REGISTERED') fail('المعاملة مسجلة؛ يلزم تصحيح مستقل');
  if (p.decision === 'VERIFIED' && process.env.DEMO_MODE !== 'true' && e.scanStatus !== 'CLEAN') fail('يلزم فحص الملف');
  return t.evidence.update({ where: { id: e.id }, data: { status: p.decision, verifiedBy: s.user.id, reason: p.reason } });
}

export async function notApplicable({ s, school, t, body, c }: Ctx) {
  scope(s, school, APPROVE);
  independent(s, c);
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

const rating = z.enum(Object.keys(RATINGS) as [keyof typeof RATINGS, ...(keyof typeof RATINGS)[]]);

/** Completion certificate for all accepted, not yet certified quantities (partial or final). */
export async function issueCertificate({ s, school, t, body, c }: Ctx) {
  scope(s, school, APPROVE);
  independent(s, c);
  requireState(c, ['PARTIAL', 'DELIVERED']);
  const p = parse(
    z
      .object({
        kind: z.enum(['PARTIAL', 'FINAL']),
        date: date.optional(),
        addressee: z.number().int().min(1).max(3).default(1),
        invoice: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(1000).default(''),
        ratings: z.object({ scope: rating, time: rating, supervision: rating }).default({ scope: 'EXCELLENT', time: 'EXCELLENT', supervision: 'EXCELLENT' }),
      })
      .strict(),
    body,
  );
  if (p.kind === 'PARTIAL' && c.state === 'DELIVERED') fail('اختر الشهادة النهائية بعد اكتمال التوريد');
  if (p.kind === 'FINAL' && c.state !== 'DELIVERED') fail('يلزم اكتمال التوريد للشهادة النهائية');
  if (checklist(c).some((r) => !r.complete)) fail('مستندات ما قبل الشهادة غير مستوفاة');
  const on = p.date ?? today();
  if (on > today()) fail('تاريخ مستقبلي');
  const pending = await t.portion.findMany({
    where: { caseId: c.id, certificateId: null, accepted: { gt: 0 } },
    include: { item: true, delivery: true },
  });
  if (!pending.length) fail('لا توجد كميات جديدة للشهادة');
  const all = await t.portion.findMany({ where: { caseId: c.id, accepted: { gt: 0 } } });
  const { rate, cap } = orderPolicy(c);
  const prior = sum(c.certificates.map((x) => x.fine)),
    calc = fine(c.total.toString(), all.map((r) => ({ value: r.value.toString(), lateDays: r.lateDays })), prior.toString(), rate, cap),
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
    addressee: p.addressee,
    school: c.school.name,
    principal: c.principalName,
    accountant: c.accountantName,
    supplier: supplier?.name ?? '',
    subject: c.subject,
    orderNumber: c.orderNumber ?? '',
    orderDate: isoDay(c.issueDate!),
    orderValue: num(c.total),
    invoice: p.invoice || [...new Set(pending.map((r) => r.delivery.invoice))].join('، '),
    deliveryDate: pending.map((r) => isoDay(r.delivery.date)).sort().at(-1)!,
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
  const attachments = p.attachments ?? COVER_ATTACHMENTS.filter((a) => a.evidence && verified.includes(a.evidence)).map((a) => a.key);
  const details = (cert.details ?? cert.snapshot) as CertificateData;
  const coverDate = p.date ?? today();
  return t.certificate.update({
    where: { id: cert.id },
    data: {
      coverHtml: certificateCover({ ...details, coverDate, coverAttachments: attachments }),
      details: plain({ ...details, cover: { date: coverDate, attachments } }),
    },
  });
}

export async function completeFile({ s, school, t, c }: Ctx) {
  scope(s, school, APPROVE);
  independent(s, c);
  requireState(c, ['CERTIFIED']);
  if (!c.certificates.length || c.certificates.some((x) => !x.coverHtml) || checklist(c).some((x) => !x.complete)) fail('الملف غير مستوفٍ');
  for (const cert of c.certificates)
    for (const code of SIGNED)
      if (!c.evidence.some((e) => e.code === code && e.certificateId === cert.id && e.status === 'VERIFIED'))
        fail('أرفق النسخ الموقعة لكل شهادة وتغطيتها وتحقق منها');
  await t.certificate.updateMany({ where: { caseId: c.id }, data: { finalized: true } });
  return t.case.update({ where: { id: c.id }, data: { state: 'COMPLETE', version: { increment: 1 } } });
}

/** Manual, documented ERP registration — there is no live integration with the ministry system. */
export async function registerErp({ s, school, t, body, c }: Ctx) {
  scope(s, school, ERP);
  requireState(c, ['COMPLETE']);
  const p = parse(z.object({ reference: text, date, evidence: text }).strict(), body);
  if (p.date > today()) fail('تاريخ مستقبلي');
  const erp = await t.erp.create({
    data: { caseId: c.id, schoolId: school, reference: p.reference, date: new Date(p.date), evidence: p.evidence, actor: s.user.id },
  });
  await t.case.update({ where: { id: c.id }, data: { state: 'REGISTERED', version: { increment: 1 } } });
  return erp;
}


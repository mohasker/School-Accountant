import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { Tx } from '../../common/db';
import { fail, id, parse } from '../../common/validation';
import { scope, WORK, type Identity } from '../../core/identity';
import type { WriteCtx } from '../context';
import type { FullCase } from './common';
import { requireState } from './common';

/**
 * Second-person approval of a large certificate (administrator's switch and value): the accountant
 * asks, another user of the school (or the administrator) approves or rejects, and only then can the
 * certificate be issued, and not by the user who approved it.
 */

async function settings(t: Tx, tenantId: string) {
  return t.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { fourEyes: true, fourEyesLimit: true } });
}

export async function approvalRequired(t: Tx, tenantId: string, c: { total: { gte: (v: any) => boolean } }) {
  const st = await settings(t, tenantId);
  return st.fourEyes && Number(st.fourEyesLimit) > 0 && c.total.gte(st.fourEyesLimit);
}

/** Called before a certificate is issued. */
export async function requireCertificateApproval(t: Tx, s: Identity, c: FullCase) {
  if (!(await approvalRequired(t, s.user.tenantId, c))) return;
  const ok = await t.approval.findFirst({
    where: { caseId: c.id, kind: 'CERTIFICATE', status: 'APPROVED' },
    orderBy: { decidedAt: 'desc' },
  });
  if (!ok) fail('شهادة بهذه القيمة تحتاج موافقة مستخدم آخر؛ اطلب الموافقة من صفحة المعاملة');
  if (ok.decidedBy === s.user.id) fail('من وافق على الشهادة لا يصدرها؛ يصدرها المحاسب الآخر');
}

export async function requestApproval({ s, school, t, c }: WriteCtx & { c: FullCase }) {
  scope(s, school, WORK);
  requireState(c, ['ORDERED', 'PARTIAL', 'DELIVERED']);
  if (!(await approvalRequired(t, s.user.tenantId, c))) fail('هذه المعاملة لا تحتاج موافقة');
  const open = await t.approval.findFirst({ where: { caseId: c.id, kind: 'CERTIFICATE', status: { in: ['PENDING', 'APPROVED'] } } });
  if (open) fail(open.status === 'PENDING' ? 'طلب الموافقة قائم بالفعل' : 'تمت الموافقة بالفعل');
  return t.approval.create({
    data: { schoolId: school, caseId: c.id, kind: 'CERTIFICATE', requestedBy: s.user.id, requestedName: s.user.name },
  });
}

export async function decideApproval({ s, school, t, c, body }: WriteCtx & { c: FullCase }) {
  scope(s, school, WORK);
  const p = parse(z.object({ approvalId: id, approve: z.boolean(), note: z.string().trim().max(500).default('') }).strict(), body);
  const a = await t.approval.findFirst({ where: { id: p.approvalId, caseId: c.id, status: 'PENDING' } });
  if (!a) throw new NotFoundException('لا يوجد طلب موافقة قائم');
  if (a.requestedBy === s.user.id) fail('لا يوافق صاحب الطلب على طلبه؛ يلزم مستخدم آخر');
  if (!p.approve && !p.note) fail('اذكر سبب الرفض');
  return t.approval.update({
    where: { id: a.id },
    data: {
      status: p.approve ? 'APPROVED' : 'REJECTED',
      decidedBy: s.user.id,
      decidedName: s.user.name,
      note: p.note,
      decidedAt: new Date(),
    },
  });
}

import { NotFoundException } from '@nestjs/common';
import type { Tx } from '../../common/db';
import { fail } from '../../common/validation';
import { EVIDENCE, PRE_CERTIFICATE, waivable } from '../../core/documents';

export const STATES = [
  'DRAFT',
  'EVALUATED',
  'APPROVED',
  'ORDERED',
  'PARTIAL',
  'DELIVERED',
  'CERTIFIED',
  'COMPLETE',
  'REGISTERED',
  'CANCELLED',
];

export async function getCase(t: Tx, school: string, caseId: string) {
  const c = await t.case.findUnique({
    where: { id: caseId, schoolId: school },
    include: {
      items: { include: { budget: true }, orderBy: { position: 'asc' } },
      quotes: { include: { supplier: true } },
      deliveries: { include: { portions: true }, orderBy: { date: 'asc' } },
      certificates: { orderBy: { createdAt: 'asc' } },
      school: true,
      year: true,
      supplier: true,
      evidence: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          reason: true,
          scanStatus: true,
          certificateId: true,
          uploadedBy: true,
          verifiedBy: true,
          createdAt: true,
        },
      },
      erp: true,
    },
  });
  if (!c) throw new NotFoundException('المعاملة غير موجودة');
  return c;
}

export type FullCase = Awaited<ReturnType<typeof getCase>>;

export function requireState(c: FullCase, states: string[]) {
  if (!states.includes(c.state)) fail('حالة المعاملة لا تسمح بالإجراء');
  if (c.year.closed) fail('العام المالي مغلق');
}

export function checklist(c: FullCase) {
  return PRE_CERTIFICATE.map((code) => ({
    code,
    name: EVIDENCE[code].name,
    waivable: waivable(code, c.origin, c.method),
    complete: c.evidence.some((e) => e.code === code && ['VERIFIED', 'NA'].includes(e.status)),
  }));
}

/** Verified (not waived) documents, used to pre-tick the certificate attachments. */
export const verifiedCodes = (c: FullCase) => [...new Set(c.evidence.filter((e) => e.status === 'VERIFIED').map((e) => e.code))];

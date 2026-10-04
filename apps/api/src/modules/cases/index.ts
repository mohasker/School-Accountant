import { NotFoundException } from '@nestjs/common';
import { id, parse } from '../../common/validation';
import type { WriteCtx } from '../context';
import { getCase, type FullCase } from './common';
import * as fulfilment from './fulfilment';
import * as procurement from './procurement';
import { decideApproval, requestApproval } from './approvals';

type CaseAction = (ctx: WriteCtx & { c: FullCase }) => Promise<any>;

/** Workflow actions on an existing case: POST schools/:school/cases/:id/:action */
const ACTIONS: Record<string, CaseAction> = {
  quotes: procurement.addQuote,
  'quote-delete': procurement.removeQuote,
  'direct-order': procurement.directOrder,
  evaluate: procurement.evaluate,
  approve: procurement.approve,
  return: procurement.returnCase,
  issue: procurement.issue,
  extend: procurement.extend,
  cancel: procurement.cancel,
  deliver: fulfilment.deliver,
  evidence: fulfilment.uploadEvidence,
  verify: fulfilment.verifyEvidence,
  'not-applicable': fulfilment.notApplicable,
  certificate: fulfilment.issueCertificate,
  cover: fulfilment.coverLetter,
  complete: fulfilment.completeFile,
  finish: fulfilment.finish,
  erp: fulfilment.registerErp,
  'request-approval': requestApproval,
  'decide-approval': decideApproval,
};

export async function writeCases(ctx: WriteCtx) {
  if (!ctx.rid) return procurement.createCase(ctx);
  const handler = ctx.action && ACTIONS[ctx.action];
  if (!handler) throw new NotFoundException('الإجراء غير موجود');
  const c = await getCase(ctx.t, ctx.school, parse(id, ctx.rid));
  return handler({ ...ctx, c });
}

export { readCases, readCertificate, readDashboard, readEvidence } from './read';

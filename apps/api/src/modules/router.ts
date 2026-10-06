import { NotFoundException } from '@nestjs/common';
import { scope, type Identity } from '../core/identity';
import { transact } from '../core/transaction';
import { readBudgetEstimate, readLedger, writeBudget, writeBudgetPlan } from './budgets';
import { readCases, readCertificate, readDashboard, readEvidence, writeCases } from './cases';
import type { Reader, Writer } from './context';
import { readDirectExpenses, writeDirectExpenses } from './direct';
import { readErpRecon, writeErpRecon } from './erp-recon';
import { readFinancialReport } from './finance';
import { readImprests, writeImprests } from './imprests';
import { readAudit, readReportRuns, readTransactionsReport } from './reports';
import { readLegacyImport, writeLegacyImport } from './legacy-import';
import { readPrincipals, readSetup, writePrincipals, writeSchool, writeUser, writeYear } from './school';
import { addStandard, importSuppliers, writeSupplier } from './suppliers';
import { supplierFromBank } from './bank';
import { readCheckPrompt, readFileChecks } from './file-check';
import { readComments, readReturns, writeComments, writeReturns } from './returns';
import { readImprestPrompt } from './imprest-check';

/** GET schools/:school/:resource[/:id[/:action]] */
const READERS: Record<string, Reader> = {
  principals: readPrincipals,
  'legacy-import': readLegacyImport,
  setup: readSetup,
  dashboard: readDashboard,
  cases: readCases,
  certificates: readCertificate,
  evidence: readEvidence,
  imprests: readImprests,
  ledger: readLedger,
  'budget-estimate': readBudgetEstimate,
  reports: readTransactionsReport,
  'financial-report': readFinancialReport,
  'direct-expenses': readDirectExpenses,
  'erp-recon': readErpRecon,
  'file-checks': readFileChecks,
  'file-check-prompt': readCheckPrompt,
  'case-returns': readReturns,
  'imprest-check-prompt': readImprestPrompt,
  'case-comments': readComments,
  'report-runs': readReportRuns,
  audit: readAudit,
};

/** POST/PATCH/DELETE schools/:school/:resource[/:id[/:action]] — each runs in one idempotent transaction. */
const WRITERS: Record<string, Writer> = {
  principals: writePrincipals,
  'legacy-import': writeLegacyImport,
  suppliers: writeSupplier,
  'supplier-import': importSuppliers,
  'supplier-standard': addStandard,
  'supplier-from-bank': supplierFromBank,
  'case-returns': writeReturns,
  'case-comments': writeComments,
  school: writeSchool,
  users: writeUser,
  years: writeYear,
  budgets: writeBudget,
  'budget-plan': writeBudgetPlan,
  cases: writeCases,
  imprests: writeImprests,
  'direct-expenses': writeDirectExpenses,
  'erp-recon': writeErpRecon,
};

export function read(s: Identity, school: string, path: string[], query: Record<string, any>) {
  scope(s, school);
  const [resource, rid, action] = path;
  const reader = READERS[resource];
  if (!reader) throw new NotFoundException();
  return reader({ s, school, rid, action, query });
}

export function mutate(s: Identity, school: string, path: string[], body: any, key: string, method: string) {
  scope(s, school);
  const [resource, rid, action] = path;
  const writer = WRITERS[resource];
  if (!writer) throw new NotFoundException('الإجراء غير موجود');
  return transact(s, school, `${method}:${path.join('/')}`, body, key, (t) =>
    writer({ s, school, rid, action, query: {}, t, body, method }),
  );
}

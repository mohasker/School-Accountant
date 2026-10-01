import { HttpException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { today } from '../common/dates';
import { fail, id, parse } from '../common/validation';
import { readTextLayer, readWithAi, MAX_PAGES, type DocType, type UploadedFile } from '../core/file-check/extract';
import { evaluate, expectedFrom, manualChecklist, verdict, type Expected } from '../core/file-check/rules';
import { showAmount } from '../core/file-check/normalize';
import { requireTenantAdmin, scope, WORK, type Identity } from '../core/identity';
import { STANDARD_SCHOOLS } from '../core/standard-schools';
import { checkUpload } from '../core/uploads';
import { fileCheckReport } from '../print/file-check';
import { apiKey } from './ai';
import { getCase } from './cases/common';
import type { ReadCtx } from './context';

/**
 * Checking the signed paper file of a case before it is sent: the accountant uploads the scanned
 * PDF or photos (on the screen or to the Telegram bot), the pages are read, fixed rules compare them
 * with what the system recorded, and a one-page report lists errors, warnings and notes. Nothing in
 * the case changes; every check is kept with its report and written to the audit log.
 */

const MAX_FILES = 15;
const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 25 * 1024 * 1024;
const PER_HOUR = 20;

const DOC_KEYS = ['QUOTE', 'QUOTE_REPORT', 'ORDER', 'INVOICE', 'RECEIPT', 'CERTIFICATE', 'COVER'] as const;
const ruleSchema = z.object({
  id: z.string().max(40).optional(),
  text: z.string().trim().min(4).max(300),
  level: z.enum(['ERROR', 'WARN']).default('WARN'),
  docType: z.union([z.literal(''), z.enum(DOC_KEYS)]).default(''),
});

/* ---------- administrator settings ---------- */

export async function checkSettings(s: Identity) {
  requireTenantAdmin(s);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: s.user.tenantId }, select: { checkAi: true, checkRules: true } });
  return { ai: t.checkAi, aiConfigured: Boolean(await apiKey(s.user.tenantId)), rules: rulesOf(t.checkRules) };
}

export async function saveCheckSettings(s: Identity, t: Tx, body: any) {
  requireTenantAdmin(s);
  const p = parse(z.object({ ai: z.boolean(), rules: z.array(ruleSchema).max(40) }).strict(), body);
  const rules = p.rules.map((r) => ({ ...r, id: r.id || 'R' + randomUUID().slice(0, 8) }));
  await t.tenant.update({ where: { id: s.user.tenantId }, data: { checkAi: p.ai, checkRules: rules } });
  return { ai: p.ai, rules };
}

function rulesOf(v: unknown): Expected['rules'] {
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => ruleSchema.safeParse(r))
    .filter((r) => r.success)
    .map((r) => ({ id: r.data.id || '', text: r.data.text, level: r.data.level, docType: r.data.docType as DocType | '' }))
    .filter((r) => r.id);
}

/* ---------- running a check ---------- */

const usage = new Map<string, number[]>();
function limit(userId: string) {
  const now = Date.now(),
    recent = (usage.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= PER_HOUR) throw new HttpException(`الحد ${PER_HOUR} فحصاً في الساعة؛ حاول لاحقاً`, 429);
  recent.push(now);
  usage.set(userId, recent);
}

/** Files from the screen: base64 in JSON. */
export function filesFromBody(body: any): UploadedFile[] {
  const p = parse(
    z
      .object({
        files: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(200),
              mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
              base64: z.string().min(8),
            }),
          )
          .min(1)
          .max(MAX_FILES),
      })
      .strict(),
    body,
  );
  return p.files.map((f) => ({ name: f.name, mime: f.mime, data: Buffer.from(f.base64, 'base64') }));
}

export type CheckResult = Awaited<ReturnType<typeof runFileCheck>>;

/** Reads, compares and stores one check; returns the result with its findings. */
export async function runFileCheck(s: Identity, school: string, caseId: string, files: UploadedFile[], source: 'WEB' | 'TELEGRAM') {
  scope(s, school, WORK);
  const c = await getCase(db, school, parse(id, caseId)).catch(() => null);
  if (!c) throw new NotFoundException('المعاملة غير موجودة');
  if (!c.issueDate && !c.reportDate) fail('لا يوجد ما يُفحص بعد: يُفحص الملف بعد إصدار تقرير العروض أو كتاب التكليف');
  if (!files.length || files.length > MAX_FILES) fail(`أرفق من 1 إلى ${MAX_FILES} ملفاً`);
  let total = 0;
  for (const f of files) {
    if (f.data.length > MAX_FILE) fail(`الملف «${f.name}» أكبر من 15 ميجابايت`);
    total += f.data.length;
    checkUpload(f.mime, f.data);
  }
  if (total > MAX_TOTAL) fail('حجم الملفات أكبر من 25 ميجابايت؛ قسّمها أو صوّر بدقة أقل');
  limit(s.user.id);

  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: s.user.tenantId }, select: { checkAi: true, checkRules: true } });
  const rules = rulesOf(tenant.checkRules);
  const key = tenant.checkAi ? await apiKey(s.user.tenantId) : '';
  const extraction = key
    ? await readWithAi(
        key,
        files,
        rules.map((r) => ({ id: r.id, text: r.text })),
      )
    : await readTextLayer(files);
  if (extraction.pages.length > MAX_PAGES) fail(`عدد الصفحات أكبر من ${MAX_PAGES}؛ افحص المعاملة على دفعات`);

  const [schools, card] = await Promise.all([
    db.school.findMany({ where: { tenantId: s.user.tenantId }, select: { name: true } }),
    c.supplier?.cardId ? db.supplierCard.findUnique({ where: { id: c.supplier.cardId }, select: { legalName: true, nameEn: true } }) : null,
  ]);
  const x = expectedFrom(
    c,
    [...new Set([...schools.map((v) => v.name), ...STANDARD_SCHOOLS])],
    [card?.legalName ?? '', card?.nameEn ?? ''],
    rules,
    today(),
  );
  const findings = evaluate(x, extraction);
  const checklist = manualChecklist(x, extraction);
  const v = verdict(findings);
  const at = new Date();
  const fileList = files.map((f) => ({
    name: f.name,
    mime: f.mime,
    size: f.data.length,
    sha256: createHash('sha256').update(f.data).digest('hex'),
  }));
  const supplier = ((c.supplierSnapshot ?? c.supplier) as { name?: string } | null)?.name ?? '';
  const html = fileCheckReport({
    x,
    findings,
    checklist,
    result: v.result,
    counts: v,
    mode: extraction.mode,
    source,
    files: fileList.map((f) => ({ name: f.name, pages: 0 })),
    pages: extraction.pages.length,
    by: s.user.name,
    at,
    supplier,
    total: showAmount(Number(c.total)),
  });
  const row = await db.$transaction(async (t) => {
    const saved = await t.fileCheck.create({
      data: {
        schoolId: school,
        caseId: c.id,
        source,
        mode: extraction.mode,
        files: fileList,
        pages: extraction.pages.length,
        facts: JSON.parse(JSON.stringify({ pages: extraction.pages, rules: extraction.rules, checklist })),
        findings,
        result: v.result,
        errors: v.errors,
        warnings: v.warnings,
        notes: v.notes,
        html,
        createdBy: s.user.id,
        byName: s.user.name,
        createdAt: at,
      },
    });
    await t.audit.create({
      data: {
        schoolId: school,
        actor: s.user.id,
        action: 'file-check',
        entity: c.id,
        detail: {
          check: saved.id,
          source,
          mode: extraction.mode,
          result: v.result,
          errors: v.errors,
          warnings: v.warnings,
          files: fileList.map((f) => f.sha256),
        },
      },
    });
    return saved;
  });
  return {
    id: row.id,
    caseNumber: c.number,
    ...v,
    mode: extraction.mode,
    pages: extraction.pages.length,
    findings,
    checklist,
    createdAt: at,
  };
}

/** GET schools/:school/file-checks?case=… (list) or /file-checks/:id (the report; ?pdf=1 for a PDF). */
export async function readFileChecks({ s, school, rid, query }: ReadCtx) {
  scope(s, school);
  if (rid) {
    const row = await db.fileCheck.findFirst({ where: { id: parse(id, rid), schoolId: school } });
    if (!row) throw new NotFoundException();
    return row;
  }
  const caseId = parse(id, query.case);
  return db.fileCheck.findMany({
    where: { schoolId: school, caseId },
    select: {
      id: true,
      createdAt: true,
      source: true,
      mode: true,
      pages: true,
      result: true,
      errors: true,
      warnings: true,
      notes: true,
      byName: true,
      findings: true,
      facts: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

import type { Tx, db } from '../common/db';
import { today } from '../common/dates';

type Client = Tx | typeof db;

/**
 * The school principal on a date: the term that started last on or before it. Before the first
 * recorded term the earliest one applies; without any term the school's current principal (or the
 * name kept on the file) applies, as before principal terms existed.
 */
export async function principalOn(t: Client, schoolId: string, on: string, fallback?: string) {
  const terms = await t.principalTerm.findMany({ where: { schoolId }, orderBy: { fromDate: 'asc' } });
  if (!terms.length) return fallback ?? (await t.school.findUniqueOrThrow({ where: { id: schoolId } })).principal;
  const day = new Date(on);
  return (terms.filter((x) => x.fromDate <= day).at(-1) ?? terms[0]).name;
}

/** Keeps School.principal equal to the principal in office today (shown on the screens and the AI context). */
export async function syncCurrentPrincipal(t: Tx, schoolId: string) {
  const name = await principalOn(t, schoolId, today());
  await t.school.update({ where: { id: schoolId }, data: { principal: name } });
  return name;
}

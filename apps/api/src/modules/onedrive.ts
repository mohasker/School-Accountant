import { HttpException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, type Tx } from '../common/db';
import { fail, parse } from '../common/validation';
import { requireTenantAdmin, type Identity } from '../core/identity';
import { seal, unseal } from '../core/secrets';

/**
 * OneDrive as the store of the shared archive, through Microsoft Graph with a delegated sign-in:
 * the system administrator registers an app once (client id + secret), signs in with the OneDrive
 * account (works for personal and work/school accounts) and the server keeps only the refresh token,
 * encrypted. Files go to «<folder>/<company>/<stamp>-<name>» under that account's drive.
 * `OD_LOGIN_BASE` / `OD_GRAPH_BASE` exist only so tests can stand in for Microsoft.
 */

const login = () => process.env.OD_LOGIN_BASE || 'https://login.microsoftonline.com';
const graphBase = () => process.env.OD_GRAPH_BASE || 'https://graph.microsoft.com/v1.0';
const SCOPE = 'Files.ReadWrite offline_access User.Read';
const SIMPLE_LIMIT = 4 * 1024 * 1024;
const AUTHORITIES = ['common', 'consumers', 'organizations'] as const;

export class OneDriveError extends HttpException {
  constructor(message: string, status = 502) {
    super({ statusCode: status, message }, status);
  }
}

export const redirectUri = () => `${(process.env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/$/, '')}/api/onedrive/callback`;

async function config(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { odClientId: true, odSecret: true, odAuthority: true, odRefresh: true, odAccount: true, odFolder: true },
  });
  return {
    clientId: t.odClientId,
    secret: t.odSecret,
    authority: t.odAuthority,
    refresh: t.odRefresh,
    account: t.odAccount,
    folder: t.odFolder,
  };
}

/** True when an account is connected, i.e. new documents go to OneDrive. */
export async function isConnected(tenantId: string) {
  const c = await config(tenantId);
  return Boolean(c.clientId && c.secret && c.refresh);
}

/** What the administrator sees on the setup panel (never the secret or the token). */
export async function status(s: Identity) {
  requireTenantAdmin(s);
  const c = await config(s.user.tenantId);
  const stored = await db.archive.count({ where: { tenantId: s.user.tenantId, storage: 'DATABASE' } });
  return {
    configured: Boolean(c.clientId && c.secret),
    connected: Boolean(c.clientId && c.secret && c.refresh),
    clientId: c.clientId,
    hasSecret: Boolean(c.secret),
    authority: c.authority,
    folder: c.folder,
    account: c.account,
    redirectUri: redirectUri(),
    inDatabase: stored,
  };
}

const safeName = (v: string, fallback: string) =>
  v
    .replace(/[\\/:*?"<>|#%~&{}\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 80) || fallback;

export async function saveConfig(s: Identity, t: Tx, body: any) {
  requireTenantAdmin(s);
  const p = parse(
    z
      .object({
        clientId: z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F-]{36}$/, 'معرّف التطبيق (Application ID) يجب أن يكون بصيغة GUID'),
        secret: z.string().trim().max(300).optional(),
        authority: z.enum(AUTHORITIES),
        folder: z.string().trim().min(1).max(60),
      })
      .strict(),
    body,
  );
  const old = await t.tenant.findUniqueOrThrow({
    where: { id: s.user.tenantId },
    select: { odClientId: true, odSecret: true, odAuthority: true },
  });
  const secret = p.secret ? seal(p.secret) : old.odSecret;
  if (!secret) fail('أدخل السر (Client secret) للتطبيق');
  // Another app or account type means the earlier sign-in no longer applies.
  const changed = old.odClientId !== p.clientId || old.odAuthority !== p.authority || Boolean(p.secret);
  tokens.delete(s.user.tenantId);
  await t.tenant.update({
    where: { id: s.user.tenantId },
    data: {
      odClientId: p.clientId,
      odSecret: secret,
      odAuthority: p.authority,
      odFolder: safeName(p.folder, 'MOESAS-Archive'),
      ...(changed ? { odRefresh: '', odAccount: '' } : {}),
    },
  });
  return { saved: true, reconnect: changed };
}

export async function disconnect(s: Identity, t: Tx) {
  requireTenantAdmin(s);
  tokens.delete(s.user.tenantId);
  await t.tenant.update({ where: { id: s.user.tenantId }, data: { odRefresh: '', odAccount: '' } });
  return { disconnected: true };
}

// ---- sign-in (authorization code flow) -------------------------------------------------------------

const states = new Map<string, { tenantId: string; userId: string; exp: number }>();

/** Address the administrator's browser opens to sign in with the OneDrive account. */
export async function connectUrl(s: Identity) {
  requireTenantAdmin(s);
  const c = await config(s.user.tenantId);
  if (!c.clientId || !c.secret) fail('احفظ إعدادات التطبيق أولاً (المعرّف والسر)');
  const now = Date.now();
  for (const [k, v] of states) if (v.exp < now) states.delete(k);
  const state = randomBytes(24).toString('hex');
  states.set(state, { tenantId: s.user.tenantId, userId: s.user.id, exp: now + 10 * 60000 });
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPE,
    state,
    prompt: 'select_account',
  });
  return { url: `${login()}/${c.authority}/oauth2/v2.0/authorize?${q}` };
}

async function tokenRequest(c: Awaited<ReturnType<typeof config>>, extra: Record<string, string>) {
  const r = await fetch(`${login()}/${c.authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: unseal(c.secret), scope: SCOPE, ...extra }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const gone = j.error === 'invalid_grant';
    throw new OneDriveError(
      gone
        ? 'انتهى ربط OneDrive أو أُلغي؛ يعيد مسؤول النظام الربط من شاشة السياسة المالية'
        : `رفضت مايكروسوفت الطلب: ${j.error_description || j.error || r.status}`.slice(0, 300),
      gone ? 409 : 502,
    );
  }
  return j as { access_token: string; refresh_token?: string; expires_in?: number };
}

/** Completes the sign-in: exchanges the code, keeps the encrypted refresh token and the account name. */
export async function completeConnect(code: string, stateKey: string) {
  const st = states.get(stateKey);
  states.delete(stateKey);
  if (!st || st.exp < Date.now()) fail('انتهت صلاحية طلب الربط؛ ابدأ من جديد');
  const c = await config(st.tenantId);
  const j = await tokenRequest(c, { grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  if (!j.refresh_token) throw new OneDriveError('لم تُرجع مايكروسوفت رمز التجديد؛ تأكد من صلاحية offline_access');
  const me: any = await fetch(`${graphBase()}/me`, { headers: { Authorization: `Bearer ${j.access_token}` } })
    .then((r) => r.json())
    .catch(() => ({}));
  const account = String(me.userPrincipalName || me.mail || me.displayName || '').slice(0, 200);
  await db.tenant.update({ where: { id: st.tenantId }, data: { odRefresh: seal(j.refresh_token), odAccount: account } });
  tokens.set(st.tenantId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  await db.audit.create({
    data: { tenantId: st.tenantId, actor: st.userId, action: 'ONEDRIVE_CONNECT', entity: st.tenantId, detail: { account } },
  });
  return account;
}

// ---- access token ----------------------------------------------------------------------------------

const tokens = new Map<string, { token: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

async function refresh(tenantId: string) {
  const c = await config(tenantId);
  if (!c.clientId || !c.secret || !c.refresh) throw new OneDriveError('حساب OneDrive غير متصل', 409);
  const current = unseal(c.refresh);
  const j = await tokenRequest(c, { grant_type: 'refresh_token', refresh_token: current });
  // Microsoft may rotate the refresh token; keep the newest one.
  if (j.refresh_token && j.refresh_token !== current)
    await db.tenant.update({ where: { id: tenantId }, data: { odRefresh: seal(j.refresh_token) } });
  tokens.set(tenantId, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

function accessToken(tenantId: string) {
  const hit = tokens.get(tenantId);
  if (hit && hit.exp > Date.now() + 60000) return Promise.resolve(hit.token);
  let p = inflight.get(tenantId);
  if (!p) inflight.set(tenantId, (p = refresh(tenantId).finally(() => inflight.delete(tenantId))));
  return p;
}

/** Graph call with the bearer token; one retry with a fresh token when Microsoft answers 401. */
async function graph(tenantId: string, path: string, init: RequestInit = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${graphBase()}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await accessToken(tenantId)}` },
    });
    if (r.status === 401 && attempt === 0) {
      tokens.delete(tenantId);
      continue;
    }
    return r;
  }
}

async function failed(r: Response, what: string): Promise<never> {
  const j: any = await r.json().catch(() => ({}));
  throw new OneDriveError(`${what}: ${j?.error?.message || r.status}`.slice(0, 300));
}

// ---- files -----------------------------------------------------------------------------------------

export type Stored = { id: string; url: string };

/** Uploads to «<folder>/<company>/<stamp>-<name>»; files above 4 MB use an upload session. */
export async function upload(tenantId: string, company: string, name: string, mime: string, data: Buffer): Promise<Stored> {
  const c = await config(tenantId);
  const rel = [c.folder, safeName(company, 'شركة'), `${Date.now()}-${safeName(name, 'document')}`].map(encodeURIComponent).join('/');
  const conflict = '@microsoft.graph.conflictBehavior=rename';
  let r: Response;
  if (data.length <= SIMPLE_LIMIT) {
    r = await graph(tenantId, `/me/drive/root:/${rel}:/content?${conflict}`, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: new Uint8Array(data),
    });
  } else {
    const s = await graph(tenantId, `/me/drive/root:/${rel}:/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
    });
    if (!s.ok) return failed(s, 'تعذر بدء الرفع إلى OneDrive');
    const { uploadUrl } = (await s.json()) as { uploadUrl: string };
    // The whole file is one final chunk; the session URL carries its own authorisation.
    r = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes 0-${data.length - 1}/${data.length}`, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
  }
  if (!r.ok) return failed(r, 'تعذر الرفع إلى OneDrive');
  const j: any = await r.json();
  if (!j.id) throw new OneDriveError('ردّت مايكروسوفت دون معرّف للملف');
  return { id: String(j.id), url: String(j.webUrl ?? '') };
}

export async function download(tenantId: string, remoteId: string) {
  const r = await graph(tenantId, `/me/drive/items/${encodeURIComponent(remoteId)}/content`);
  if (r.status === 404) throw new OneDriveError('الملف غير موجود في OneDrive (حُذف أو نُقل)', 404);
  if (!r.ok) return failed(r, 'تعذر تنزيل الملف من OneDrive');
  return Buffer.from(await r.arrayBuffer());
}

/** Removes a file; a file that is already gone counts as removed. Returns false when OneDrive could not be reached. */
export async function remove(tenantId: string, remoteId: string) {
  try {
    const r = await graph(tenantId, `/me/drive/items/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
    return r.ok || r.status === 404;
  } catch {
    return false;
  }
}

import { All, Body, Controller, Get, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { db } from '../common/db';
import { parse } from '../common/validation';
import { authenticate, clearSessionCookie, login, passwordHash } from '../core/identity';
import { htmlToPdf } from '../core/pdf';
import { transact } from '../core/transaction';
import { aiStatus, chat, saveAiKey } from '../modules/ai';
import { discardOrphan, migrateArchive, prepareArchive, removeRemote } from '../modules/library';
import { completeConnect } from '../modules/onedrive';
import { caseRegister, certificateRegistry } from '../modules/reports';
import { mutate, read } from '../modules/router';
import { welcome } from '../modules/welcome';
import { schoolsOverview } from '../modules/overview';
import { parseErpReport } from '../modules/erp-recon';
import { sendNow, setEmail } from '../modules/email';
import { readTenant, writeTenant } from '../modules/tenant';

const segments = (path: string | string[]) => (Array.isArray(path) ? path : path.split('/'));
const idempotencyKey = (req: Request) => String(req.headers['idempotency-key'] ?? '');

/** `?pdf=1` on any printable GET returns the document as a PDF file (`part=cover` for a covering letter). */
async function maybePdf(query: any, result: any) {
  if (query?.pdf !== '1') return result;
  const html = query.part === 'cover' ? result?.cover : result?.html;
  if (typeof html !== 'string') throw new NotFoundException('لا يوجد مستند للطباعة');
  return htmlToPdf(html);
}

@Controller('api')
export class AuthController {
  @Get('health') async health() {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  }

  @Post('auth/login') async login(@Body() b: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const p = parse(
      z
        .object({
          username: z.string().min(3).max(50),
          password: z.string().min(8).max(128),
          location: z
            .object({
              lat: z.number().min(-90).max(90),
              lng: z.number().min(-180).max(180),
              accuracy: z.number().min(0).max(1e7).optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
      b,
    );
    return login(p.username, p.password, req, res, p.location);
  }

  @Get('auth/me') async me(@Req() req: Request) {
    const s = await authenticate(req);
    return {
      csrf: s.csrf,
      user: {
        id: s.user.id,
        name: s.user.name,
        isTenantAdmin: s.user.isTenantAdmin,
        email: s.user.email,
        mustChangePassword: s.user.mustChangePassword,
      },
      schools: s.user.memberships
        .filter((m) => m.school.active)
        .map((m) => ({ id: m.schoolId, name: m.school.name, roles: m.roles }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      demo: process.env.DEMO_MODE === 'true',
    };
  }

  @Post('auth/logout') async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await authenticate(req);
    await db.session.deleteMany({ where: { tokenHash: s.tokenHash } });
    clearSessionCookie(res);
    return { ok: true };
  }

  /** Changing the password signs out every session of the user. */
  @Post('auth/password') async password(@Body() b: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await authenticate(req),
      p = parse(z.object({ current: z.string().max(128), password: z.string().min(8).max(128) }).strict(), b);
    if (!(await argon2.verify(s.user.passwordHash, p.current))) throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');
    await db.$transaction([
      db.user.update({ where: { id: s.user.id }, data: { passwordHash: await passwordHash(p.password), mustChangePassword: false } }),
      db.session.deleteMany({ where: { userId: s.user.id } }),
    ]);
    clearSessionCookie(res);
    return { ok: true };
  }
}

@Controller('api')
export class WorkspaceController {
  /** Everything inside one school. */
  @All('schools/:school/*path') async school(
    @Param('school') school: string,
    @Param('path') path: string | string[],
    @Req() req: Request,
    @Body() b: any,
    @Query() query: any,
  ) {
    const s = await authenticate(req);
    return req.method === 'GET'
      ? maybePdf(query, await read(s, school, segments(path), query))
      : mutate(s, school, segments(path), b ?? {}, idempotencyKey(req), req.method);
  }

  /** Completion certificates across the user's schools. */
  @Get('registry/certificates') async registry(@Req() req: Request, @Query() query: any) {
    const s = await authenticate(req);
    if (query.pdf === '1') return maybePdf(query, await certificateRegistry(s, { ...query, format: 'print' }));
    return certificateRegistry(s, query);
  }

  /** Quote reports (`type=report`) or assignment letters (`type=order`) across the user's schools. */
  @Get('registry/cases') async caseRegistry(@Req() req: Request, @Query() query: any) {
    const s = await authenticate(req);
    if (query.pdf === '1') return maybePdf(query, await caseRegister(s, { ...query, format: 'print' }));
    return caseRegister(s, query);
  }

  /**
   * Microsoft sends the browser back here after the OneDrive sign-in. The session cookie is not sent on this
   * cross-site navigation, so the request is tied to the administrator by the one-time `state` issued earlier.
   */
  @Get('onedrive/callback') async oneDriveCallback(@Query() q: any, @Res() res: Response) {
    const web = (process.env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
    const back = (params: Record<string, string>) => res.redirect(302, `${web}/?${new URLSearchParams(params)}`);
    if (q.error) return back({ onedrive: 'error', message: String(q.error_description || q.error).slice(0, 300) });
    try {
      const account = await completeConnect(String(q.code ?? ''), String(q.state ?? ''));
      return back({ onedrive: 'ok', account });
    } catch (e: any) {
      const m = e?.response?.message ?? e?.message ?? 'تعذر إكمال الربط';
      return back({ onedrive: 'error', message: String(Array.isArray(m) ? m.join('، ') : m).slice(0, 300) });
    }
  }

  /** The weekly reminder: a test to the administrator or sending now to everyone (outside any DB transaction). */
  @Post('email/send') async emailSend(@Req() req: Request, @Body() b: any) {
    return sendNow(await authenticate(req), b ?? {});
  }
  /** Each account sets its own e-mail address for the reminder. */
  @Post('auth/email') async myEmail(@Req() req: Request, @Body() b: any) {
    const s = await authenticate(req);
    return db.$transaction((t) => setEmail(t, s.user.id, String(b?.email ?? '')));
  }

  /** Reads an uploaded ERP expense report (PDF) and proposes the comparison; nothing is saved. */
  @Post('erp-recon/parse') async erpParse(@Req() req: Request, @Body() b: any) {
    return parseErpReport(await authenticate(req), b ?? {});
  }

  /** General position of the schools of an accountant (the administrator may pass ?user=). */
  @Get('overview/schools') async overview(@Req() req: Request, @Query() q: any) {
    return schoolsOverview(await authenticate(req), q ?? {});
  }

  /** Reminder after sign-in: pending work in every school of the user. */
  @Get('welcome') async welcomeSummary(@Req() req: Request) {
    return welcome(await authenticate(req));
  }

  /** Assistant: availability, the administrator's key, and the chat itself (never inside a DB transaction). */
  @Get('ai/status') async aiStatus(@Req() req: Request) {
    return aiStatus(await authenticate(req));
  }
  @Post('ai/key') async aiKey(@Req() req: Request, @Body() b: any) {
    return saveAiKey(await authenticate(req), b ?? {});
  }
  @Post('ai/chat') async aiChat(@Req() req: Request, @Body() b: any) {
    return chat(await authenticate(req), b ?? {});
  }

  /** Tenant-wide settings: holidays, policy, budget catalog, schools, memberships. */
  @All('admin/*path') async admin(@Param('path') path: string | string[], @Req() req: Request, @Body() b: any, @Query() query: any) {
    const s = await authenticate(req);
    const [resource, rid, action] = segments(path);
    if (req.method === 'GET') return maybePdf(query, await readTenant(s, resource, rid, action, query));
    // Archive uploads and the move to OneDrive talk to Microsoft, so they run outside the database transaction.
    if (resource === 'archive' && req.method === 'POST' && rid === 'migrate') return migrateArchive(s);
    const prepared = resource === 'archive' && req.method === 'POST' && !rid ? await prepareArchive(s, b ?? {}) : undefined;
    try {
      const result: any = await transact(
        s,
        s.user.tenantId,
        `${req.method}:admin/${segments(path).join('/')}`,
        b ?? {},
        idempotencyKey(req),
        (t) => writeTenant(s, t, resource, rid, action, req.method, b ?? {}, prepared),
      );
      if (resource === 'archive' && req.method === 'DELETE' && result?.storage === 'ONEDRIVE' && result.remoteId)
        await removeRemote(s, result.id, result.remoteId);
      return result;
    } finally {
      if (prepared) await discardOrphan(s.user.tenantId, prepared);
    }
  }
}

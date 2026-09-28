import { All, Body, Controller, Get, Param, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { db } from '../common/db';
import { parse } from '../common/validation';
import { authenticate, clearSessionCookie, login, passwordHash } from '../core/identity';
import { transact } from '../core/transaction';
import { certificateRegistry } from '../modules/reports';
import { mutate, read } from '../modules/router';
import { readTenant, writeTenant } from '../modules/tenant';

const segments = (path: string | string[]) => (Array.isArray(path) ? path : path.split('/'));
const idempotencyKey = (req: Request) => String(req.headers['idempotency-key'] ?? '');

@Controller('api')
export class AuthController {
  @Get('health') async health() {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  }

  @Post('auth/login') async login(@Body() b: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const p = parse(z.object({ username: z.string().min(3).max(50), password: z.string().min(8).max(128) }).strict(), b);
    return login(p.username, p.password, req, res);
  }

  @Get('auth/me') async me(@Req() req: Request) {
    const s = await authenticate(req);
    return {
      csrf: s.csrf,
      user: { id: s.user.id, name: s.user.name, isTenantAdmin: s.user.isTenantAdmin },
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
      p = parse(z.object({ current: z.string().max(128), password: z.string().min(12).max(128) }).strict(), b);
    if (!(await argon2.verify(s.user.passwordHash, p.current))) throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');
    await db.$transaction([
      db.user.update({ where: { id: s.user.id }, data: { passwordHash: await passwordHash(p.password) } }),
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
      ? read(s, school, segments(path), query)
      : mutate(s, school, segments(path), b ?? {}, idempotencyKey(req), req.method);
  }

  /** Completion certificates across the user's schools. */
  @Get('registry/certificates') async registry(@Req() req: Request, @Query() query: any) {
    return certificateRegistry(await authenticate(req), query);
  }

  /** Tenant-wide settings: holidays, policy, budget catalog, schools, memberships. */
  @All('admin/*path') async admin(@Param('path') path: string | string[], @Req() req: Request, @Body() b: any, @Query() query: any) {
    const s = await authenticate(req);
    const [resource, rid] = segments(path);
    if (req.method === 'GET') return readTenant(s, resource, query);
    return transact(s, s.user.tenantId, `${req.method}:admin/${segments(path).join('/')}`, b ?? {}, idempotencyKey(req), (t) =>
      writeTenant(s, t, resource, rid, req.method, b ?? {}),
    );
  }
}

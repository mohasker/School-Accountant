import 'reflect-metadata';
import { Catch, HttpException, Module, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AuthController, WorkspaceController } from './http/controllers';

@Module({ controllers: [AuthController, WorkspaceController] })
class AppModule {}

/** Maps database errors to clear Arabic messages; unexpected errors are logged without request data. */
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = e instanceof HttpException ? e.getStatus() : 500;
    let message: any = e instanceof HttpException ? e.getResponse() : 'خطأ داخلي؛ لم يتم تنفيذ العملية';
    if (e.code === 'P2002') [status, message] = [409, 'بيانات مكررة أو تعارض؛ راجع الإدخال'];
    if (e.code === 'P2025') [status, message] = [404, 'السجل غير موجود أو تم تعديله'];
    if (e.code === 'P2003') [status, message] = [400, 'السجل مرتبط ببيانات أخرى'];
    if (status === 500) console.error('request_failed', e.code ?? '', e.message);
    res.status(status).json(typeof message === 'string' ? { statusCode: status, message } : message);
  }
}

/** Mutations must come from the web origin; responses are never cached. */
function originGuard(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== (process.env.WEB_ORIGIN || 'http://localhost:3000'))
      return res.status(403).json({ message: 'مصدر الطلب غير مسموح' });
  }
  next();
}

export async function start() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  app.use(helmet());
  app.use(cookieParser());
  app.use(express.json({ limit: '8mb' }));
  app.use(originGuard);
  app.useGlobalFilters(new ErrorFilter());
  if (process.env.TRUST_PROXY) (app.getHttpAdapter().getInstance() as express.Express).set('trust proxy', 1);
  await app.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1');
  // Weekly e-mail reminder: checked every 10 minutes; sends once on the chosen day and hour.
  const { digestTick } = await import('./modules/email');
  const timer = setInterval(() => digestTick().catch(() => {}), 10 * 60000);
  timer.unref();
  const close = app.close.bind(app);
  app.close = async () => (clearInterval(timer), close());
  return app;
}

if (require.main === module) start();

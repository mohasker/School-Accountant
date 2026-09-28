import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module,Controller,Get,Post,All,Req,Res,Body,Param,Query,UnauthorizedException,HttpException,ForbiddenException } from '@nestjs/common';
import type {Request,Response} from 'express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {z} from 'zod';
import {db} from './db';
import {login,authenticate,passwordHash} from './auth';
import {read,mutate} from './service';
import {parse,hash} from './util';
import * as argon2 from 'argon2';
@Controller('api')
class Api {
 @Get('health') async health(){await db.$queryRaw`SELECT 1`;return{ok:true};}
 @Post('auth/login') async login(@Body() b:any,@Req() req:Request,@Res({passthrough:true}) res:Response){const p=parse(z.object({username:z.string().min(3).max(50),password:z.string().min(8).max(128)}).strict(),b);return login(p.username,p.password,req,res);}
 @Get('auth/me') async me(@Req() req:Request){const s=await authenticate(req);return{csrf:s.csrf,user:{id:s.user.id,name:s.user.name},schools:s.user.memberships.filter(m=>m.school.active).map(m=>({id:m.schoolId,name:m.school.name,roles:m.roles})),demo:process.env.DEMO_MODE==='true'};}
 @Post('auth/logout') async logout(@Req() req:Request,@Res({passthrough:true}) res:Response){const s=await authenticate(req);await db.session.deleteMany({where:{tokenHash:s.tokenHash}});res.clearCookie('sa_session',{path:'/'});return{ok:true};}
 @Post('auth/password') async password(@Body() b:any,@Req() req:Request,@Res({passthrough:true}) res:Response){const s=await authenticate(req),p=parse(z.object({current:z.string().max(128),password:z.string().min(12).max(128)}).strict(),b);if(!await argon2.verify(s.user.passwordHash,p.current))throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');await db.$transaction([db.user.update({where:{id:s.user.id},data:{passwordHash:await passwordHash(p.password)}}),db.session.deleteMany({where:{userId:s.user.id}})]);res.clearCookie('sa_session',{path:'/'});return{ok:true};}
 @All('schools/:school/*path') async school(@Param('school') school:string,@Param('path') path:string|string[],@Req() req:Request,@Body() b:any,@Query() query:any){const s=await authenticate(req);const segments=Array.isArray(path)?path:path.split('/');return req.method==='GET'?read(s,school,segments,query):mutate(s,school,segments,b??{},String(req.headers['idempotency-key']??''),req.method);}
}
@Module({controllers:[Api]}) class AppModule{}
export async function start(){
 const app=await NestFactory.create(AppModule,{bodyParser:false,logger:['error','warn']});
 app.use(helmet());app.use(cookieParser());app.use(express.json({limit:'8mb'}));
 app.use((req:Request,res:Response,next:any)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.headers.origin;if(origin&&origin!==(process.env.WEB_ORIGIN||'http://localhost:3000'))return res.status(403).json({message:'مصدر الطلب غير مسموح'});}next();});
 app.useGlobalFilters({catch(e:any,host:any){const res=host.switchToHttp().getResponse();let status=e instanceof HttpException?e.getStatus():500,message=e instanceof HttpException?e.getResponse(): 'خطأ داخلي؛ لم يتم تنفيذ العملية';if(e.code==='P2002'){status=409;message='بيانات مكررة أو تعارض؛ راجع الإدخال';}if(e.code==='P2025'){status=404;message='السجل غير موجود أو تم تعديله';}if(e.code==='P2003'){status=400;message='السجل مرتبط ببيانات أخرى';}if(status===500)console.error('request_failed',e.code??e.name);res.status(status).json({message:typeof message==='string'?message:(message as any).message,code:status});}});
 await app.listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1');return app;
}
if(require.main===module)start();

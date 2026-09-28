import { ForbiddenException, UnauthorizedException, HttpException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { db } from './db';
import { hash } from './util';
export const passwordHash=(p:string)=>argon2.hash(p,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
let dummy:Promise<string>;
const buckets=new Map<string,{n:number,start:number}>();
export function throttle(key:string){let b=buckets.get(key);if(!b||Date.now()-b.start>600000){b={n:0,start:Date.now()};buckets.set(key,b);}if(++b.n>10)throw new HttpException('محاولات كثيرة؛ حاول بعد عشر دقائق',429);if(buckets.size>10000)for(const[k,v]of buckets)if(Date.now()-v.start>600000)buckets.delete(k);}
export async function login(username:string,password:string,req:Request,res:Response){
 throttle(req.ip||'unknown');throttle('u:'+hash(username.toLowerCase()));
 const user=await db.user.findUnique({where:{username}});dummy??=passwordHash(randomBytes(30).toString('hex'));
 const valid=await argon2.verify(user?.passwordHash??await dummy,password).catch(()=>false);
 if(!valid||!user?.active)throw new UnauthorizedException('بيانات الدخول غير صحيحة');
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
 await db.session.create({data:{tokenHash:hash(token),userId:user.id,csrf,expiresAt:new Date(Date.now()+8*3600000)}});
 res.cookie('sa_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',maxAge:8*3600000,path:'/'});
 return {csrf,user:{id:user.id,name:user.name}};
}
export async function authenticate(req:Request){
 const token=req.cookies?.sa_session;if(!token)throw new UnauthorizedException('سجّل الدخول');
 const session=await db.session.findUnique({where:{tokenHash:hash(token)},include:{user:{include:{memberships:{include:{school:true}}}}}});
 if(!session||!session.user.active||session.expiresAt.getTime()<Date.now()||Date.now()-session.lastSeen.getTime()>30*60000){if(session)await db.session.deleteMany({where:{tokenHash:session.tokenHash}});throw new UnauthorizedException('انتهت الجلسة');}
 if(!['GET','HEAD','OPTIONS'].includes(req.method)){
  const csrf=String(req.headers['x-csrf-token']??'');
  if(csrf.length!==session.csrf.length||!timingSafeEqual(Buffer.from(csrf),Buffer.from(session.csrf)))throw new ForbiddenException('رمز حماية الطلب غير صالح');
 }
 if(Date.now()-session.lastSeen.getTime()>60000)await db.session.update({where:{tokenHash:session.tokenHash},data:{lastSeen:new Date()}});
 return session;
}
export type Identity=Awaited<ReturnType<typeof authenticate>>;
export function scope(s:Identity,schoolId:string,roles:string[]=[]){const m=s.user.memberships.find(m=>m.schoolId===schoolId&&m.school.active);if(!m||m.school.tenantId!==s.user.tenantId||roles.length&&!roles.some(r=>m.roles.includes(r)))throw new ForbiddenException('غير مصرح بهذا الإجراء في المدرسة');return m;}

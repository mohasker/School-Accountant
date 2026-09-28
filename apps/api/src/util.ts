import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
export const D = Prisma.Decimal;
export const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/,'قيمة مالية غير صالحة');
export const quantity = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/,'كمية غير صالحة').refine(v=>new D(v).gt(0),'الكمية موجبة');
export const text = z.string().trim().min(1).max(300);
export const id = z.string().uuid();
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v,'تاريخ غير صالح');
export const round = (v: Prisma.Decimal) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);
export const hash = (v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export const today = ()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function fail(message:string):never {throw new BadRequestException(message);}
export function parse<T>(schema:z.ZodType<T>, v:unknown):T { const r=schema.safeParse(v); if(!r.success) fail(r.error.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('؛ '));return r.data; }
export const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const num=(v:unknown)=>new D(String(v)).toFixed(2);
export function dueDate(trigger:string,days:number){return new Date(new Date(trigger).getTime()+days*86400000);}
export function delay(due:Date, actual:Date){return Math.max(0,Math.round((actual.getTime()-due.getTime())/86400000));}
export function fine(total:string, portions:{value:string,lateDays:number}[],previous='0'){
 const order=new D(total),old=new D(previous);if(!order.isFinite()||order.lte(0)||!old.isFinite()||old.lt(0))fail('قيمة غير صالحة');
 let value=new D(0),raw=new D(0);
 for(const p of portions){const v=new D(p.value);if(!v.isFinite()||v.lt(0)||!Number.isSafeInteger(p.lateDays)||p.lateDays<0)fail('تفاصيل غرامة غير صالحة');value=value.plus(v);raw=raw.plus(v.mul('0.01').mul(p.lateDays));}
 if(value.gt(order))fail('قيم التوريدات تتجاوز التكليف');
 const capped=round(D.min(raw,order.mul('0.10'))),current=capped.minus(old);
 if(current.lt(0))fail('يلزم إجراء تصحيح معتمد للغرامة السابقة');
 return {raw,capped,current};
}
export function printDocument(title:string,school:string,accountant:string,body:string,ref:string){return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:16px Tahoma,Arial;line-height:1.9;color:#17212c;padding:28px;max-width:1000px;margin:auto}header{border-bottom:3px solid #8a1538;padding-bottom:16px;display:flex;justify-content:space-between}h1{font-size:24px;color:#8a1538}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{border:1px solid #aaa;padding:7px;text-align:right}th{background:#f1f3f5}.note{background:#fff3cd;padding:12px}footer{border-top:1px solid #aaa;margin-top:40px;font-size:13px}@page{size:A4;margin:16mm}@media print{body{padding:0}thead{display:table-header-group}tr{break-inside:avoid}}</style><header><div>مساعد محاسبي المدارس الحكومية<br>${esc(school)}</div><div>المرجع: ${esc(ref)}<br>${today()}</div></header><h1>${esc(title)}</h1><p class="note">نسخة اختبار — القالب والهوية والسياسات بانتظار الاعتماد الرسمي. لا تمثل مستنداً وزارياً معتمداً.</p>${body}<footer>المحاسب: ${esc(accountant)}<p>إعداد: __________ المراجعة: __________ اعتماد مدير المدرسة: __________</p></footer></html>`;}

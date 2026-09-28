import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { Identity, scope, passwordHash } from './auth';
import { D, money, quantity, text, id, date, parse, fail, round, hash, dueDate, delay, fine, today, esc, num, printDocument } from './util';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
type Tx=Prisma.TransactionClient;
const ACCOUNT=['ACCOUNTANT'], REVIEW=['REVIEWER','APPROVER'], APPROVE=['APPROVER'], ERP=['ERP'];
export const labels=['','دعوة الشركات','عروض الأسعار','السجلات التجارية الرسمية','تقرير دراسة العروض','كتاب التكليف','الفاتورة','إذن التسليم','إذن الاستلام','كتاب التعهد','إثبات IBAN','موافقة الجهة المختصة','كشف توزيع الهدايا'];
const safe=(x:any)=>JSON.parse(JSON.stringify(x));
async function audit(t:Tx,s:Identity,school:string,action:string,entity:string,detail:any={}){await t.audit.create({data:{schoolId:school,actor:s.user.id,action,entity,detail:safe(detail)}});}
async function transact(s:Identity,school:string,op:string,body:any,key:string,fn:(t:Tx)=>Promise<any>){
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(key))fail('مفتاح الطلب مطلوب');
 const full=s.user.id+':'+school+':'+op+':'+key,h=hash(JSON.stringify(body));
 for(let n=0;n<4;n++)try{return await db.$transaction(async t=>{const old=await t.idempotency.findUnique({where:{key:full}});if(old){if(old.hash!==h)throw new ConflictException('المفتاح مستخدم لطلب آخر');return old.result;}const result=safe(await fn(t));await audit(t,s,school,op,result.id??school,{requestHash:h});await t.idempotency.create({data:{key:full,hash:h,result}});return result;},{isolationLevel:'Serializable',timeout:20000,maxWait:15000});}catch(e:any){if((e.code==='P2034'||e.code==='P2002')&&n<3)continue;throw e;}
}
async function year(t:Tx,schoolId:string,yearId:string){const y=await t.fiscalYear.findUnique({where:{id:yearId,schoolId}});if(!y)throw new NotFoundException('العام غير موجود');if(y.closed)fail('العام المالي مغلق');return y;}
function inYear(y:any,d:string){if(d<y.startDate.toISOString().slice(0,10)||d>y.endDate.toISOString().slice(0,10))fail('التاريخ خارج العام المالي');}
async function next(t:Tx,school:string,yearId:string,type:string){const row=await t.sequence.upsert({where:{key:`${school}/${yearId}/${type}`},create:{key:`${school}/${yearId}/${type}`,value:1},update:{value:{increment:1}}});return `${type}-${row.value.toString().padStart(5,'0')}`;}
async function getCase(t:Tx,school:string,caseId:string){const c=await t.case.findUnique({where:{id:caseId,schoolId:school},include:{items:{include:{budget:true}},quotes:{include:{supplier:true}},deliveries:{include:{portions:true}},certificates:true,school:true,year:true,supplier:true,evidence:{select:{id:true,code:true,name:true,status:true,reason:true,scanStatus:true,certificateId:true,uploadedBy:true,verifiedBy:true}},erp:true}});if(!c)throw new NotFoundException('المعاملة غير موجودة');return c;}
async function posting(t:Tx,budgetId:string,commit:Prisma.Decimal,expense:Prisma.Decimal,eventKey:string,source:string,actor:string){
 await t.$queryRaw`SELECT id FROM "Budget" WHERE id = ${budgetId}::uuid FOR UPDATE`;
 const b=await t.budget.findUniqueOrThrow({where:{id:budgetId}}),cm=b.committed.plus(commit),sp=b.spent.plus(expense);
 if(cm.lt(0)||sp.lt(0)||cm.plus(sp).gt(b.approved))fail('رصيد بند الموازنة غير كافٍ أو حركة عكسية غير صالحة');
 await t.budget.update({where:{id:budgetId},data:{committed:cm,spent:sp}});
 await t.ledger.create({data:{budgetId,eventKey,kind:expense.eq(0)?'COMMITMENT':'EXPENSE',commitment:commit,expense,source,actor}});
}
function requireState(c:any,states:string[]){if(!states.includes(c.state))fail('حالة المعاملة لا تسمح بالإجراء');if(c.year.closed)fail('العام المالي مغلق');}
function independent(s:Identity,c:any){if(c.createdBy===s.user.id)throw new ForbiddenException('يلزم اعتماد مستخدم آخر عن معد المعاملة');}
function requirements(c:any){return labels.slice(1).map((name,i)=>({code:i+1,name,complete:c.evidence.some((e:any)=>e.code===i+1&&['VERIFIED','NA'].includes(e.status))}));}
function reportBody(c:any){return `<p>الموضوع: ${esc(c.subject)} | العام المالي: ${esc(c.year.label)}</p><table><tr><th>المورد</th><th>مرجع العرض</th><th>الإجمالي</th><th>مطابق</th></tr>${c.quotes.map((q:any)=>`<tr><td>${esc(q.supplier.name)}</td><td>${esc(q.reference)}</td><td>${num(q.total)}</td><td>${q.compliant?'نعم':'لا'}</td></tr>`).join('')}</table><p>سبب الاختيار: ${esc(c.awardReason)}</p>`;}
export async function read(s:Identity,school:string,path:string[],query:any){
 scope(s,school);const [resource,rid,action]=path;
 if(resource==='setup'){const [schoolRow,years,suppliers,budgets,users]=await Promise.all([db.school.findUniqueOrThrow({where:{id:school}}),db.fiscalYear.findMany({where:{schoolId:school},orderBy:{startDate:'desc'}}),db.supplier.findMany({where:{schoolId:school},orderBy:{name:'asc'}}),db.budget.findMany({where:{schoolId:school,...(query.year?{yearId:parse(id,query.year)}:{})},orderBy:{code:'asc'}}),db.membership.findMany({where:{schoolId:school},include:{user:{select:{id:true,name:true,username:true,active:true}}}})]);return {school:schoolRow,years,suppliers,budgets,users,roles:scope(s,school).roles,demo:process.env.DEMO_MODE==='true'};}
 if(resource==='report-runs'){
 if(!rid)return db.reportRun.findMany({where:{schoolId:school,...(query.year?{yearId:parse(id,query.year)}:{})},select:{id:true,title:true,createdAt:true,hash:true},orderBy:{createdAt:'desc'},take:100});
 const run=await db.reportRun.findFirst({where:{id:parse(id,rid),schoolId:school}});if(!run)throw new NotFoundException();
 if(action==='xlsx'){const ExcelJS=await import('exceljs');const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('المعاملات',{views:[{rightToLeft:true}]});const data=run.snapshot as any;sheet.addRow(['المدرسة',data.header.school,'المحاسب',data.header.accountant]);sheet.addRow(['من',data.header.from,'إلى',data.header.to]);sheet.addRow(['أساس التاريخ',data.header.dateBasis,'العام',data.header.year]);sheet.addRow(['الرقم','الموضوع','المحاسب','المورد','القيمة','الحالة','ERP']);for(const r of data.rows)sheet.addRow([r.number,r.subject,r.accountantName,r.supplier?.name??'',r.total,r.state,r.erp?.reference??'']);sheet.columns.forEach(c=>c.width=25);sheet.getRow(4).font={bold:true};const bytes=await workbook.xlsx.writeBuffer();return {base64:Buffer.from(bytes).toString('base64'),name:'transactions-'+run.id+'.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};}
 return {...run.snapshot as any,id:run.id,html:run.html};
 }
 if(resource==='cases'&&rid){const c=await getCase(db,school,parse(id,rid));if(action==='report-print'&&c.evaluationHtml)return {html:c.evaluationHtml};if(action==='order-print'&&c.orderHtml)return {html:c.orderHtml};if(action==='report-print')return {html:printDocument('تقرير دراسة عروض الأسعار',c.school.name,c.accountantName,reportBody(c),c.evaluationNumber??c.number)};if(action==='order-print')return{html:printDocument('كتاب التكليف',c.school.name,c.accountantName,`<p>إلى: ${esc(c.supplier?.name)} | ${esc(c.subject)}</p><p>آخر موعد: ${c.dueDate?.toISOString().slice(0,10)??'—'}</p><table><tr><th>البند</th><th>الكمية</th><th>القيمة</th></tr>${c.items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${num(i.value)}</td></tr>`).join('')}</table><p>الإجمالي ${num(c.total)} ر.ق</p>`,c.orderNumber??c.number)};return {...c,checklist:requirements(c)};}
 if(resource==='certificates'&&rid){const cert=await db.certificate.findFirst({where:{id:parse(id,rid),case:{schoolId:school}}});if(!cert)throw new NotFoundException();return action==='cover'?{html:cert.coverHtml}:{html:cert.html};}
 if(resource==='evidence'&&rid){const f=await db.evidence.findFirst({where:{id:parse(id,rid),case:{schoolId:school}}});if(!f)throw new NotFoundException();return {name:f.name,mime:f.mime,data:f.data?Buffer.from(f.data).toString('base64'):null};}
 const yearId=parse(id,query.year);
 const owned=await db.fiscalYear.findUnique({where:{id:yearId,schoolId:school}});if(!owned)throw new NotFoundException();
 if(resource==='cases'||resource==='dashboard'){
 const q=String(query.q??'').slice(0,200),state=query.state?String(query.state):undefined;
 const all=await db.case.findMany({where:{schoolId:school,yearId,...(state?{state}:{}),...(q?{OR:[{number:{contains:q,mode:'insensitive'}},{subject:{contains:q,mode:'insensitive'}},{orderNumber:{contains:q,mode:'insensitive'}},{evaluationNumber:{contains:q,mode:'insensitive'}},{supplier:{name:{contains:q,mode:'insensitive'}}},{erp:{reference:{contains:q,mode:'insensitive'}}},{certificates:{some:{number:{contains:q,mode:'insensitive'}}}},{deliveries:{some:{invoice:{contains:q,mode:'insensitive'}}}}]}:{})},include:{supplier:true,certificates:{select:{id:true,number:true,gross:true,fine:true,net:true,finalized:true}},erp:true},orderBy:{createdAt:'desc'},take:500});
 if(resource==='cases')return all;
 const budgets=await db.budget.findMany({where:{schoolId:school,yearId}}),imprests=await db.imprest.findMany({where:{schoolId:school,yearId}});
 const counts=await db.case.groupBy({by:['state'],where:{schoolId:school,yearId},_count:true});
 return {counts,budgets,imprests,cases:all.slice(0,10),certificates:await db.certificate.count({where:{case:{schoolId:school,yearId}}}),total:counts.reduce((n,c)=>n+c._count,0)};
 }
 if(resource==='imprests')return db.imprest.findMany({where:{schoolId:school,yearId},include:{expenses:true,settlements:true,movements:true}});
 if(resource==='audit'){scope(s,school,['AUDITOR','APPROVER','ADMIN']);return db.audit.findMany({where:{schoolId:school},orderBy:{createdAt:'desc'},take:300});}
 if(resource==='ledger')return db.ledger.findMany({where:{budget:{schoolId:school,yearId,...(query.budget?{id:parse(id,query.budget)}:{})}},include:{budget:true},orderBy:{createdAt:'desc'},take:2000});
 if(resource==='reports'){
 const from=parse(date,query.from),to=parse(date,query.to);if(from>to)fail('الفترة غير صحيحة');const accountant=query.accountant?parse(id,query.accountant):undefined;
 const [schoolRow,rows]=await db.$transaction([db.school.findUniqueOrThrow({where:{id:school}}),db.case.findMany({where:{schoolId:school,yearId,createdAt:{gte:new Date(from+'T00:00:00+03:00'),lt:new Date(new Date(to+'T00:00:00+03:00').getTime()+86400000)},...(accountant?{createdBy:accountant}:{})},include:{supplier:true,certificates:true,erp:true},orderBy:{createdAt:'asc'}})],{isolationLevel:'RepeatableRead'});
 const header={school:schoolRow.name,year:owned.label,accountant:s.user.name,accountantFilter:accountant??'كل المحاسبين المصرح بهم',from,to,dateBasis:'تاريخ إنشاء المعاملة',generatedAt:new Date().toISOString()};
 const reportData={header,rows,html:printDocument('تقرير المعاملات',schoolRow.name,s.user.name,`<p>العام ${esc(owned.label)} | ${from} — ${to} | الأساس: تاريخ إنشاء المعاملة</p><table><tr><th>الرقم</th><th>الموضوع</th><th>المحاسب</th><th>المورد</th><th>القيمة</th><th>الحالة</th><th>ERP</th></tr>${rows.map(r=>`<tr><td>${esc(r.number)}</td><td>${esc(r.subject)}</td><td>${esc(r.accountantName)}</td><td>${esc(r.supplier?.name)}</td><td>${num(r.total)}</td><td>${esc(r.state)}</td><td>${esc(r.erp?.reference)}</td></tr>`).join('')}</table><p>عدد المعاملات: ${rows.length} — إجمالي التكليفات: ${num(rows.filter(r=>r.orderNumber).reduce((a,r)=>a.plus(r.total),new D(0)))}</p>`,hash(JSON.stringify(header)).slice(0,12))};const run=await db.reportRun.create({data:{schoolId:school,yearId,actor:s.user.id,title:'تقرير المعاملات '+from+' — '+to,snapshot:safe({header,rows}),html:reportData.html,hash:hash(JSON.stringify(reportData))}});return {...reportData,id:run.id};
 }
 throw new NotFoundException();
}
export async function mutate(s:Identity,school:string,path:string[],body:any,key:string,method:string){
 const [resource,rid,action]=path;scope(s,school);
 const op=method+':'+path.join('/');
 return transact(s,school,op,body,key,async t=>{
 if(resource==='suppliers'){
 scope(s,school,['ACCOUNTANT','ADMIN']);
 if(method==='DELETE'){const supplier=await t.supplier.findUnique({where:{id:parse(id,rid),schoolId:school},include:{_count:{select:{quotes:true,cases:true}}}});if(!supplier)throw new NotFoundException();if(supplier._count.quotes||supplier._count.cases) return t.supplier.update({where:{id:supplier.id},data:{active:false,version:{increment:1}}});await t.supplier.delete({where:{id:supplier.id}});return {id:rid,deleted:true};}
 const schema=z.object({name:text,cr:text,iban:z.string().max(50).default(''),phone:z.string().max(40).default(''),email:z.string().max(150).default(''),active:z.boolean().default(true),version:z.number().int().optional()}).strict();
 const p=parse(schema,body);if(p.iban){p.iban=p.iban.replace(/\s/g,'').toUpperCase();if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(p.iban))fail('IBAN غير صالح');const digits=(p.iban.slice(4)+p.iban.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));if(BigInt(digits)%97n!==1n)fail('رقم تحقق IBAN غير صالح');}
 const {version,...data}=p;
 if(rid){const current=await t.supplier.findUnique({where:{id:parse(id,rid),schoolId:school}});if(!current)throw new NotFoundException();if(current.version!==version)throw new ConflictException('تم تعديل المورد؛ أعد تحميله');if(current.iban!==data.iban)scope(s,school,['APPROVER','ADMIN']);return t.supplier.update({where:{id:rid,schoolId:school,version},data:{...data,version:{increment:1}}});}
 return t.supplier.create({data:{...data,schoolId:school}});
 }
 if(resource==='supplier-import'){
 scope(s,school,['ACCOUNTANT','ADMIN']);const p=parse(z.object({rows:z.array(z.object({name:text,cr:text,phone:z.string().max(40).default(''),email:z.string().max(150).default('')})).min(1).max(1000)}).strict(),body);
 const codes=new Set<string>();for(const r of p.rows){if(codes.has(r.cr))fail('سجل تجاري مكرر داخل الملف');codes.add(r.cr);if(await t.supplier.findUnique({where:{schoolId_cr:{schoolId:school,cr:r.cr}}}))fail('مورد موجود بالفعل: '+r.cr);}
 await t.supplier.createMany({data:p.rows.map(r=>({...r,schoolId:school}))});return{count:p.rows.length};
 }
 if(resource==='school'){
 scope(s,school,['ADMIN']);const p=parse(z.object({name:text,principal:text,pettyCustodian:z.string().max(100),educationCustodian:z.string().max(100),bookCustodian:z.string().max(100)}).strict(),body);return t.school.update({where:{id:school},data:p});
 }
 if(resource==='users'){
 scope(s,school,['ADMIN']);const p=parse(z.object({username:z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),name:text,password:z.string().min(12).max(128),roles:z.array(z.enum(['ACCOUNTANT','REVIEWER','APPROVER','ERP','AUDITOR','ADMIN'])).min(1)}).strict(),body);
 const user=await t.user.create({data:{tenantId:s.user.tenantId,username:p.username,name:p.name,passwordHash:await passwordHash(p.password)}});await t.membership.create({data:{tenantId:s.user.tenantId,schoolId:school,userId:user.id,roles:p.roles}});return{id:user.id,name:user.name};
 }
 if(resource==='years'){
 scope(s,school,['ADMIN']);if(action==='close'){const y=await year(t,school,parse(id,rid));if(await t.case.count({where:{schoolId:school,yearId:y.id,state:{notIn:['REGISTERED','CANCELLED']}}})||await t.imprest.count({where:{schoolId:school,yearId:y.id,closed:false}}))fail('توجد معاملات أو عهد غير مغلقة');return t.fiscalYear.update({where:{id:y.id},data:{closed:true}});}
 const p=parse(z.object({label:text,start:date,end:date}).strict(),body);if(p.start>=p.end)fail('الفترة غير صحيحة');if(await t.fiscalYear.count({where:{schoolId:school,startDate:{lte:new Date(p.end)},endDate:{gte:new Date(p.start)}}}))fail('الفترة تتداخل مع عام قائم');return t.fiscalYear.create({data:{schoolId:school,label:p.label,startDate:new Date(p.start),endDate:new Date(p.end)}});
 }
 if(resource==='budgets'){
 scope(s,school,APPROVE);const p=parse(z.object({yearId:id,code:text,name:text,amount:money,reason:text}).strict(),body);await year(t,school,p.yearId);
 if(rid){const b=await t.budget.findUnique({where:{id:parse(id,rid),schoolId:school,yearId:p.yearId}});if(!b)throw new NotFoundException();if(new D(p.amount).lt(b.committed.plus(b.spent)))fail('الاعتماد أقل من المصروف والمرتبط');await audit(t,s,school,'BUDGET_CHANGE',b.id,{before:b.approved,after:p.amount,reason:p.reason});return t.budget.update({where:{id:b.id},data:{approved:p.amount,name:p.name}});}
 return t.budget.create({data:{schoolId:school,yearId:p.yearId,code:p.code,name:p.name,approved:p.amount}});
 }
 if(resource==='cases'&&!rid){
 scope(s,school,ACCOUNT);const p=parse(z.object({yearId:id,subject:text,origin:z.enum(['SCHOOL','MINISTRY']),ministryReference:z.string().max(150).optional(),items:z.array(z.object({name:text,unit:text,qty:quantity,budgetId:id})).min(1).max(100)}).strict(),body);const y=await year(t,school,p.yearId);inYear(y,today());
 if(p.origin==='MINISTRY'&&!p.ministryReference)fail('مرجع التكليف الوزاري مطلوب');
 if(p.ministryReference&&await t.case.count({where:{schoolId:school,yearId:p.yearId,ministryReference:p.ministryReference}}))fail('التكليف الوزاري مسجل');
 for(const item of p.items)if(!await t.budget.findUnique({where:{id:item.budgetId,schoolId:school,yearId:p.yearId}}))fail('بند موازنة غير مسموح');
 return t.case.create({data:{schoolId:school,yearId:p.yearId,number:await next(t,school,p.yearId,'TR'),subject:p.subject,origin:p.origin,ministryReference:p.ministryReference,createdBy:s.user.id,accountantName:s.user.name,principalName:scope(s,school).school.principal,items:{create:p.items}}});
 }
 if(resource==='cases'&&rid){
 const c=await getCase(t,school,parse(id,rid));
 if(action==='quotes'){
 scope(s,school,ACCOUNT);requireState(c,['DRAFT']);const p=parse(z.object({supplierId:id,reference:text,prices:z.array(z.object({itemId:id,price:money})).min(1),compliant:z.boolean(),note:z.string().max(1000)}).strict(),body);
 const supplier=await t.supplier.findUnique({where:{id:p.supplierId,schoolId:school,active:true}});if(!supplier)fail('المورد غير متاح');
 if(p.prices.length!==c.items.length||new Set(p.prices.map(x=>x.itemId)).size!==c.items.length)fail('يلزم سعر لكل بند دون تكرار');let total=new D(0);
 for(const line of p.prices){const item=c.items.find(i=>i.id===line.itemId);if(!item)fail('بند غير صحيح');if(new D(line.price).lte(0))fail('السعر موجب');total=total.plus(round(item.qty.mul(line.price)));}
 if(!p.compliant&&!p.note.trim())fail('سبب استبعاد العرض مطلوب');return t.quote.create({data:{schoolId:school,yearId:c.yearId,caseId:c.id,supplierId:p.supplierId,reference:p.reference,prices:p.prices,total,compliant:p.compliant,note:p.note}});
 }
 if(action==='direct-order'){
 scope(s,school,ACCOUNT);requireState(c,['DRAFT']);if(c.origin!=='MINISTRY')fail('ليس تكليفاً وزارياً');const p=parse(z.object({supplierId:id,reason:text,prices:z.array(z.object({itemId:id,price:money})).min(1)}).strict(),body);if(!await t.supplier.findUnique({where:{id:p.supplierId,schoolId:school,active:true}}))fail('مورد غير صالح');if(p.prices.length!==c.items.length||new Set(p.prices.map(l=>l.itemId)).size!==c.items.length)fail('يلزم تحديد سعر لكل بند');let total=new D(0);for(const l of p.prices){const i=c.items.find(i=>i.id===l.itemId);if(!i||new D(l.price).lte(0))fail('بند أو سعر غير صالح');const value=round(i.qty.mul(l.price));total=total.plus(value);await t.item.update({where:{id:i.id},data:{unitPrice:l.price,value}});}return t.case.update({where:{id:c.id},data:{supplierId:p.supplierId,total,awardReason:p.reason,state:'EVALUATED',version:{increment:1}}});
 }
 if(action==='evaluate'){
 scope(s,school,ACCOUNT);requireState(c,['DRAFT']);if(c.origin!=='SCHOOL')fail('استخدم مسار التكليف الوزاري');const p=parse(z.object({quoteId:id,reason:text}).strict(),body);const q=c.quotes.find(q=>q.id===p.quoteId&&q.compliant&&q.supplier.active);if(!q)fail('العرض المختار غير صالح');
 for(const line of q.prices as {itemId:string,price:string}[]) {const item=c.items.find(i=>i.id===line.itemId)!;await t.item.update({where:{id:item.id},data:{unitPrice:line.price,value:round(item.qty.mul(line.price))}});}
 return t.case.update({where:{id:c.id},data:{state:'EVALUATED',selectedQuoteId:q.id,supplierId:q.supplierId,total:q.total,awardReason:p.reason,evaluationNumber:await next(t,school,c.yearId,'EV'),version:{increment:1}}});
 }
 if(action==='approve'){
 scope(s,school,APPROVE);independent(s,c);requireState(c,['EVALUATED']);return t.case.update({where:{id:c.id},data:{state:'APPROVED',evaluationBy:s.user.id,evaluationHtml:c.origin==='SCHOOL'?printDocument('تقرير دراسة عروض الأسعار',c.school.name,c.accountantName,reportBody(c),c.evaluationNumber??c.number):null,version:{increment:1}}});
 }
 if(action==='return'){
 scope(s,school,REVIEW);requireState(c,['EVALUATED']);const p=parse(z.object({reason:text}).strict(),body);await audit(t,s,school,'RETURN_REASON',c.id,p);return t.case.update({where:{id:c.id},data:{state:'DRAFT',version:{increment:1}}});
 }
 if(action==='issue'){
 scope(s,school,ACCOUNT);requireState(c,['APPROVED']);const p=parse(z.object({trigger:date,days:z.number().int().min(1).max(365),policyConfirmed:z.literal(true)}).strict(),body);inYear(c.year,p.trigger);if(p.trigger>today())fail('تاريخ بدء مستقبلي غير مسموح');
 for(const item of [...c.items].sort((a,b)=>a.budgetId.localeCompare(b.budgetId)))await posting(t,item.budgetId,item.value,new D(0),'order:'+item.id,c.id,s.user.id);
 const orderNumber=c.origin==='MINISTRY'?c.ministryReference!:await next(t,school,c.yearId,'PO');const deadline=dueDate(p.trigger,p.days);const html=printDocument('كتاب التكليف',c.school.name,c.accountantName,`<p>${esc(c.subject)} — المورد ${esc(c.supplier?.name)} — العام ${esc(c.year.label)}</p><p>مدة التوريد: ${p.days} يوم تقويمي، من اليوم التالي ${p.trigger}. آخر موعد: ${deadline.toISOString().slice(0,10)}</p><table><tr><th>البند</th><th>الكمية</th><th>سعر الوحدة</th><th>القيمة</th></tr>${c.items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${num(i.unitPrice)}</td><td>${num(i.value)}</td></tr>`).join('')}</table><p>الإجمالي: ${num(c.total)} ر.ق. قاعدة الاختبار: غرامة 1% يومياً من قيمة الجزء المتأخر، بسقف 10% من التكليف.</p>`,orderNumber);return t.case.update({where:{id:c.id},data:{state:'ORDERED',issueDate:new Date(p.trigger),dueDate:deadline,orderNumber,orderHtml:html,supplierSnapshot:safe(c.supplier),issuedBy:s.user.id,version:{increment:1}}});
 }
 if(action==='extend'){
 scope(s,school,APPROVE);independent(s,c);requireState(c,['ORDERED','PARTIAL']);const p=parse(z.object({due:date,reason:text}).strict(),body);if(c.certificates.length)fail('يلزم تعديل مالي مستقل بعد إصدار شهادة؛ التمديد المباشر محظور');if(new Date(p.due)<=c.dueDate!)fail('التاريخ ليس تمديداً');for(const d of c.deliveries)for(const r of d.portions)await t.portion.update({where:{id:r.id},data:{lateDays:delay(new Date(p.due),d.date),rawFine:r.value.mul('0.01').mul(delay(new Date(p.due),d.date))}});await audit(t,s,school,'EXTENSION',c.id,{old:c.dueDate,new:p.due,reason:p.reason});return t.case.update({where:{id:c.id},data:{dueDate:new Date(p.due),version:{increment:1}}});
 }
 if(action==='deliver'){
 scope(s,school,ACCOUNT);requireState(c,['ORDERED','PARTIAL']);const p=parse(z.object({date:date,note:text,invoice:text,lines:z.array(z.object({itemId:id,received:quantity,accepted:z.string().regex(/^\d{1,9}(\.\d{1,3})?$/)})).min(1)}).strict(),body);if(p.date>today()||new Date(p.date)<c.issueDate!)fail('تاريخ توريد غير صالح');if(new Set(p.lines.map(l=>l.itemId)).size!==p.lines.length)fail('بند مكرر');
 const d=await t.delivery.create({data:{caseId:c.id,schoolId:school,yearId:c.yearId,date:new Date(p.date),note:p.note,invoice:p.invoice,createdBy:s.user.id}});
 for(const l of p.lines){const i=c.items.find(i=>i.id===l.itemId);if(!i)fail('بند غير صحيح');const acc=new D(l.accepted),received=new D(l.received),newQty=i.acceptedQty.plus(acc);if(acc.gt(received)||newQty.gt(i.qty))fail('الكمية المقبولة تتجاوز المستلم أو المتبقي');const value=round(i.value.mul(newQty).div(i.qty)).minus(i.acceptedValue),lateDays=delay(c.dueDate!,new Date(p.date));await t.portion.create({data:{caseId:c.id,deliveryId:d.id,itemId:i.id,received,accepted:acc,value,lateDays,rawFine:value.mul('0.01').mul(lateDays)}});await t.item.update({where:{id:i.id},data:{acceptedQty:newQty,acceptedValue:i.acceptedValue.plus(value)}});}
 const items=await t.item.findMany({where:{caseId:c.id}});await t.case.update({where:{id:c.id},data:{state:items.every(i=>i.acceptedQty.eq(i.qty))?'DELIVERED':'PARTIAL',version:{increment:1}}});return d;
 }
 if(action==='evidence'){
 scope(s,school,ACCOUNT);requireState(c,['DRAFT','EVALUATED','APPROVED','ORDERED','PARTIAL','DELIVERED','CERTIFIED']);const p=parse(z.object({code:z.number().int().min(1).max(14),name:text,mime:z.enum(['application/pdf','image/png','image/jpeg']),base64:z.string().max(7100000),certificateId:id.optional()}).strict(),body);if([13,14].includes(p.code)&&(!p.certificateId||!c.certificates.some(x=>x.id===p.certificateId)))fail('اختر الشهادة المرتبطة بالنسخة الموقعة');if(p.code<13&&p.certificateId)fail('ربط الشهادة مخصص للمستندات 13 و14');const data=Buffer.from(p.base64,'base64');if(data.length===0||data.length>5*1024*1024)fail('الملف فارغ أو يتجاوز 5 MB');const good=p.mime==='application/pdf'?data.subarray(0,5).toString()==='%PDF-':p.mime==='image/png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data[0]===255&&data[1]===216&&data[2]===255;if(!good)fail('محتوى الملف لا يطابق نوعه');let scan='DEMO_UNSCANNED';if(process.env.DEMO_MODE!=='true'){const dir=mkdtempSync(join(tmpdir(),'sa-scan-'));try{const path=join(dir,'upload');writeFileSync(path,data,{mode:0o600});const result=spawnSync(process.env.UPLOAD_SCANNER||'clamscan',['--no-summary',path],{timeout:30000});if(result.status!==0)fail('تعذر فحص الملف أو اكتشاف ملف غير آمن');scan='CLEAN';}finally{rmSync(dir,{recursive:true,force:true});}}
 return t.evidence.create({data:{caseId:c.id,code:p.code,certificateId:p.certificateId,name:p.name,mime:p.mime,data,hash:hash(data),uploadedBy:s.user.id,scanStatus:scan},select:{id:true,name:true,status:true,code:true}});
 }
 if(action==='verify'){
 scope(s,school,REVIEW);const p=parse(z.object({evidenceId:id,decision:z.enum(['VERIFIED','REJECTED']),reason:text}).strict(),body);const e=await t.evidence.findUnique({where:{id:p.evidenceId,caseId:c.id}});if(!e)throw new NotFoundException();if(e.uploadedBy===s.user.id)fail('المراجع يجب أن يختلف عن رافع المستند');if(c.state==='REGISTERED')fail('المعاملة مسجلة؛ يلزم تصحيح مستقل');if(p.decision==='VERIFIED'&&process.env.DEMO_MODE!=='true'&&e.scanStatus!=='CLEAN')fail('يلزم فحص الملف');return t.evidence.update({where:{id:e.id},data:{status:p.decision,verifiedBy:s.user.id,reason:p.reason}});
 }
 if(action==='not-applicable'){
 scope(s,school,APPROVE);independent(s,c);const p=parse(z.object({code:z.number().int().min(1).max(12),reason:text}).strict(),body);if(![11,12].includes(p.code)&&!(c.origin==='MINISTRY'&&[1,2,3,4].includes(p.code)))fail('لا يمكن إعفاء هذا المستند');return t.evidence.create({data:{caseId:c.id,code:p.code,name:labels[p.code],mime:'text/plain',hash:hash(p.reason),status:'NA',uploadedBy:s.user.id,verifiedBy:s.user.id,reason:p.reason,scanStatus:'NOT_APPLICABLE'}});
 }
 if(action==='certificate'){
 scope(s,school,APPROVE);independent(s,c);requireState(c,['PARTIAL','DELIVERED']);const p=parse(z.object({kind:z.enum(['PARTIAL','FINAL'])}).strict(),body);if(p.kind==='PARTIAL'&&c.state==='DELIVERED')fail('اختر الشهادة النهائية بعد اكتمال التوريد');if(p.kind==='FINAL'&&c.state!=='DELIVERED')fail('يلزم اكتمال التوريد للشهادة النهائية');if(requirements(c).some(r=>!r.complete))fail('مستندات ما قبل الشهادة غير مستوفاة');if(process.env.DEMO_MODE!=='true')fail('إصدار المستندات الرسمية متوقف لحين اعتماد القوالب والسياسات؛ اختبر في بيئة تجريبية منفصلة');
 const pending=await t.portion.findMany({where:{caseId:c.id,certificateId:null,accepted:{gt:0}},include:{item:true,delivery:true}});if(!pending.length)fail('لا توجد كميات جديدة للشهادة');const all=await t.portion.findMany({where:{caseId:c.id,accepted:{gt:0}}});const prior=c.certificates.reduce((a,x)=>a.plus(x.fine),new D(0)),calc=fine(c.total.toString(),all.map(r=>({value:r.value.toString(),lateDays:r.lateDays})),prior.toString()),gross=pending.reduce((a,r)=>a.plus(r.value),new D(0)),net=gross.minus(calc.current);if(net.lt(0))fail('الخصم أكبر من المستحق الحالي؛ يلزم مراجعة');
 const frozenSupplier=(c.supplierSnapshot??c.supplier) as any;const number=await next(t,school,c.yearId,'CC');const snapshot=safe({number,school:c.school.name,principal:c.principalName,accountant:c.accountantName,supplier:frozenSupplier,order:c.orderNumber,orderValue:c.total,year:c.year.label,kind:p.kind,policy:'USER_RULE_1_PERCENT_CALENDAR_DELIVERY_V1',due:c.dueDate,lines:pending,gross,fine:calc.current,cumulativeFine:calc.capped,net,evidence:c.evidence});
 const certificateBody=`<p>${esc(c.subject)} — التكليف ${esc(c.orderNumber)} — العام ${esc(c.year.label)}</p><p>المورد: ${esc(frozenSupplier?.name)} | IBAN: ${esc(frozenSupplier?.iban)} | النوع: ${p.kind==='FINAL'?'نهائية':'جزئية'}</p><table><tr><th>البند</th><th>الكمية</th><th>التوريد</th><th>التأخير</th><th>القيمة</th><th>الغرامة قبل السقف</th></tr>${pending.map(r=>`<tr><td>${esc(r.item.name)}</td><td>${r.accepted}</td><td>${r.delivery.date.toISOString().slice(0,10)}</td><td>${r.lateDays}</td><td>${num(r.value)}</td><td>${num(r.rawFine)}</td></tr>`).join('')}</table><p>الإجمالي: ${num(gross)} | الغرامة الحالية: ${num(calc.current)} | صافي المستحق: ${num(net)} ر.ق</p><p>الغرامة السابقة: ${num(prior)} | المتراكمة: ${num(calc.capped)} | سقف التكليف: ${num(c.total.mul('0.10'))}</p>`;
 const cert=await t.certificate.create({data:{caseId:c.id,number,kind:p.kind,gross,fine:calc.current,net,snapshot,html:printDocument('شهادة الإنجاز',c.school.name,c.accountantName,certificateBody,number),createdBy:c.createdBy,issuedBy:s.user.id}});
 for(const r of [...pending].sort((a,b)=>a.item.budgetId.localeCompare(b.item.budgetId))){await posting(t,r.item.budgetId,r.value.neg(),r.value,'certificate:'+r.id,cert.id,s.user.id);await t.item.update({where:{id:r.itemId},data:{certifiedQty:{increment:r.accepted}}});await t.portion.update({where:{id:r.id},data:{certificateId:cert.id}});}
 await t.case.update({where:{id:c.id},data:{state:p.kind==='FINAL'?'CERTIFIED':c.state,version:{increment:1}}});return cert;
 }
 if(action==='cover'){
 scope(s,school,ACCOUNT);const p=parse(z.object({certificateId:id}).strict(),body);const cert=c.certificates.find(x=>x.id===p.certificateId);if(!cert)throw new NotFoundException();if(cert.coverHtml)return cert;const sn=cert.snapshot as any;
 return t.certificate.update({where:{id:cert.id},data:{coverHtml:printDocument('كتاب تغطية شهادة الإنجاز',sn.school,sn.accountant,`<p>يرجى التكرم باتخاذ اللازم بشأن شهادة الإنجاز ${esc(cert.number)} للتكليف ${esc(sn.order)} والمورد ${esc(sn.supplier?.name)}.</p><p>إجمالي ${num(cert.gross)} ر.ق، غرامة ${num(cert.fine)} ر.ق، صافي ${num(cert.net)} ر.ق.</p><p>المرفقات: شهادة الإنجاز والمستندات المؤيدة حسب قائمة التحقق.</p>`,cert.number+'-COVER')}});
 }
 if(action==='complete'){
 scope(s,school,APPROVE);independent(s,c);requireState(c,['CERTIFIED']);if(!c.certificates.length||c.certificates.some(x=>!x.coverHtml)||requirements(c).some(x=>!x.complete))fail('الملف غير مستوفٍ');for(const cert of c.certificates)for(const code of [13,14])if(!c.evidence.some(e=>e.code===code&&e.certificateId===cert.id&&e.status==='VERIFIED'))fail('أرفق النسخ الموقعة لكل شهادة وتغطيتها وتحقق منها');await t.certificate.updateMany({where:{caseId:c.id},data:{finalized:true}});return t.case.update({where:{id:c.id},data:{state:'COMPLETE',version:{increment:1}}});
 }
 if(action==='erp'){
 scope(s,school,ERP);requireState(c,['COMPLETE']);const p=parse(z.object({reference:text,date:date,evidence:text}).strict(),body);if(p.date>today())fail('تاريخ مستقبلي');const erp=await t.erp.create({data:{caseId:c.id,schoolId:school,reference:p.reference,date:new Date(p.date),evidence:p.evidence,actor:s.user.id}});await t.case.update({where:{id:c.id},data:{state:'REGISTERED',version:{increment:1}}});return erp;
 }
 if(action==='cancel'){
 scope(s,school,APPROVE);independent(s,c);requireState(c,['DRAFT','EVALUATED','APPROVED','ORDERED']);const p=parse(z.object({reason:text}).strict(),body);if(c.deliveries.length||c.certificates.length)fail('الإلغاء بعد الاستلام يحتاج مستند تصحيح؛ لا إلغاء صامت');if(c.state==='ORDERED')for(const i of [...c.items].sort((a,b)=>a.budgetId.localeCompare(b.budgetId)))await posting(t,i.budgetId,i.value.neg(),new D(0),'cancel:'+i.id,c.id,s.user.id);await audit(t,s,school,'CANCEL_REASON',c.id,p);return t.case.update({where:{id:c.id},data:{state:'CANCELLED',version:{increment:1}}});
 }
 }
 if(resource==='imprests'){
 if(!rid){scope(s,school,APPROVE);const p=parse(z.object({yearId:id,name:text,custodian:text,type:z.enum(['PETTY','EDUCATION','BOOK','OTHER']),amount:money,reference:text}).strict(),body);await year(t,school,p.yearId);const row=await t.imprest.create({data:{schoolId:school,yearId:p.yearId,name:p.name,custodian:p.custodian,type:p.type,balance:p.amount}});await t.cashMovement.create({data:{imprestId:row.id,amount:p.amount,kind:'FUNDING',reference:p.reference,actor:s.user.id}});return row;}
 const a=await t.imprest.findUnique({where:{id:parse(id,rid),schoolId:school},include:{expenses:true,settlements:true}});if(!a)throw new NotFoundException();const y=await year(t,school,a.yearId);if(a.closed)fail('العهدة مغلقة');
 if(action==='expense'){scope(s,school,ACCOUNT);const p=parse(z.object({budgetId:id,description:text,invoice:text,date:date,amount:money,proof:text}).strict(),body);inYear(y,p.date);if(p.date>today()||new D(p.amount).lte(0)||new D(p.amount).gt(a.balance))fail('المبلغ أو التاريخ غير صالح');if(!await t.budget.findUnique({where:{id:p.budgetId,schoolId:school,yearId:a.yearId}}))fail('بند موازنة غير صالح');const e=await t.expense.create({data:{...p,date:new Date(p.date),imprestId:a.id,schoolId:school,yearId:a.yearId,createdBy:s.user.id}});await posting(t,p.budgetId,new D(0),new D(p.amount),'expense:'+e.id,e.id,s.user.id);await t.imprest.update({where:{id:a.id},data:{balance:{decrement:p.amount}}});await t.cashMovement.create({data:{imprestId:a.id,amount:new D(p.amount).neg(),kind:'EXPENSE',reference:p.invoice,actor:s.user.id}});return e;}
 if(action==='settle'){scope(s,school,APPROVE);const p=parse(z.object({type:z.enum(['REPLENISH','CLOSE','EDUCATION','BOOK']),reason:text}).strict(),body);const expenses=a.expenses.filter(e=>!e.settlementId);if(!expenses.length)fail('لا توجد مصروفات غير مسواة');if(expenses.some(e=>e.createdBy===s.user.id))fail('يلزم مراجع مستقل للمصروفات');const amount=expenses.reduce((v,e)=>v.plus(e.amount),new D(0));const st=await t.settlement.create({data:{imprestId:a.id,type:p.type,amount,actor:s.user.id,html:printDocument('كشف تسوية العهدة وكتاب التغطية',scope(s,school).school.name,s.user.name,`<p>${esc(a.name)} — المسؤول ${esc(a.custodian)} — ${esc(p.reason)}</p><table><tr><th>الفاتورة</th><th>الوصف</th><th>القيمة</th></tr>${expenses.map(e=>`<tr><td>${esc(e.invoice)}</td><td>${esc(e.description)}</td><td>${num(e.amount)}</td></tr>`).join('')}</table><p>إجمالي المصروفات: ${num(amount)} | الرصيد النقدي: ${num(a.balance)}</p><p>يرجى اعتماد تسوية المصروفات المبينة بالمرفقات واتخاذ إجراء ${esc(p.type)}.</p>`,a.id)}});await t.expense.updateMany({where:{id:{in:expenses.map(e=>e.id)},settlementId:null},data:{settlementId:st.id}});return st;}
 if(action==='replenish'){scope(s,school,APPROVE);const p=parse(z.object({settlementId:id,reference:text}).strict(),body);const st=a.settlements.find(x=>x.id===p.settlementId);if(!st||st.replenished||st.type!=='REPLENISH')fail('الاستعاضة غير متاحة');await t.settlement.update({where:{id:st.id},data:{replenished:true}});await t.cashMovement.create({data:{imprestId:a.id,amount:st.amount,kind:'REPLENISH',reference:p.reference,actor:s.user.id}});return t.imprest.update({where:{id:a.id},data:{balance:{increment:st.amount}}});}
 if(action==='erp'){scope(s,school,ERP);const p=parse(z.object({settlementId:id,reference:text}).strict(),body);const st=a.settlements.find(x=>x.id===p.settlementId);if(!st||st.erpRef)fail('التسوية غير متاحة');return t.settlement.update({where:{id:st.id},data:{erpRef:p.reference}});}
 if(action==='close'){scope(s,school,APPROVE);const p=parse(z.object({returnReference:text}).strict(),body);if(a.expenses.some(e=>!e.settlementId)||a.settlements.some(e=>!e.erpRef))fail('توجد مصروفات غير مسواة أو تسويات غير مسجلة');await t.cashMovement.create({data:{imprestId:a.id,amount:a.balance.neg(),kind:'RETURN',reference:p.returnReference,actor:s.user.id}});return t.imprest.update({where:{id:a.id},data:{balance:0,closed:true}});}
 }
 throw new NotFoundException('الإجراء غير موجود');
 });
}

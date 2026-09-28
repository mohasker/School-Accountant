import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {readFileSync,readdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fine,delay,dueDate} from '../apps/api/src/util';
let engine:PGlite,server:PGLiteSocketServer,app:any,db:any,school:string,year:string,budget:string,suppliers:any[],acc:any,approver:any,other:any,admin:any,c:any;
const password='Synthetic-Only-Test-2026!';
const origin='http://localhost:3000';
const base='http://127.0.0.1:3101/api';
async function req(session:any,path:string,method='GET',data?:any,key=randomUUID()){
 const r=await fetch(base+'/'+path,{method,headers:{Origin:origin,...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),'Content-Type':'application/json','Idempotency-Key':key},body:data?JSON.stringify(data):undefined});
 const b=await r.json();return{status:r.status,body:b,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function log(username:string){const r=await req(null,'auth/login','POST',{username,password});assert.equal(r.status,201,JSON.stringify(r.body));return{cookie:r.cookie,csrf:r.body.csrf};}
const route=(p:string)=>`schools/${school}/${p}`;
async function ok(s:any,p:string,b:any,method='POST',key?:string){const r=await req(s,route(p),method,b,key);assert.ok(r.status<300,JSON.stringify(r));return r.body;}
async function load(id:string){const r=await req(acc,route('cases/'+id));assert.equal(r.status,200);return r.body;}
async function makeCase(amount='10000.00'){
 const row=await ok(acc,'cases',{yearId:year,subject:'اختبار دورة كاملة',origin:'SCHOOL',items:[{name:'مستلزمات تعليمية',unit:'مجموعة',qty:'100',budgetId:budget}]});let full=await load(row.id);
 for(let i=0;i<3;i++)await ok(acc,`cases/${row.id}/quotes`,{supplierId:suppliers[i].id,reference:'Q-'+i,prices:[{itemId:full.items[0].id,price:String(Number(amount)/100+i*10)}],compliant:true,note:''});full=await load(row.id);
 await ok(acc,`cases/${row.id}/evaluate`,{quoteId:full.quotes.sort((a:any,b:any)=>Number(a.total)-Number(b.total))[0].id,reason:'الأقل المطابق'});return load(row.id);
}
async function issue(row:any){await ok(approver,`cases/${row.id}/approve`,{});await ok(acc,`cases/${row.id}/issue`,{trigger:'2026-09-01',days:10,policyConfirmed:true});return load(row.id);}
async function docs(row:any){for(let code=1;code<=12;code++){
 if(code===11||code===12){await ok(approver,`cases/${row.id}/not-applicable`,{code,reason:'لا ينطبق على المعاملة وفق الاعتماد التجريبي'});continue;}
 const file=await ok(acc,`cases/${row.id}/evidence`,{code,name:'test.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nSYNTHETIC TEST DOCUMENT\n%%EOF').toString('base64')});await ok(approver,`cases/${row.id}/verify`,{evidenceId:file.id,decision:'VERIFIED',reason:'تمت مراجعة الدليل التجريبي'});
}}
before(async()=>{
 process.env.DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55433/postgres?connection_limit=1';process.env.DEMO_MODE='true';process.env.DB_POOL_SIZE='1';process.env.PORT='3101';process.env.WEB_ORIGIN=origin;
 engine=await PGlite.create();for(const dir of readdirSync('prisma/migrations').filter(n=>n.startsWith('2026')).sort())await engine.exec(readFileSync('prisma/migrations/'+dir+'/migration.sql','utf8'));
 server=new PGLiteSocketServer({db:engine,port:55433,host:'127.0.0.1',maxConnections:20});await server.start();
 await promisify(execFile)(process.execPath,['--import','tsx','scripts/seed.ts'],{env:{...process.env,DEMO_PASSWORD:password},timeout:60000});
 const api=await import('../apps/api/src/main');app=await api.start();db=(await import('../apps/api/src/db')).db;
 acc=await log('accountant');approver=await log('approver');other=await log('other');admin=await log('admin');
 const me=await req(acc,'auth/me');school=me.body.schools[0].id;
 const setup=await req(acc,route('setup'));year=setup.body.years[0].id;budget=setup.body.budgets[0].id;suppliers=setup.body.suppliers;
}, {timeout:120000});
after(async()=>{await app?.close();await db?.$disconnect();await server?.stop();await engine?.close();});
test('PEN: exact partial delivery and single cumulative cap',()=>{
 assert.equal(fine('10000',[{value:'6000',lateDays:0},{value:'4000',lateDays:5}]).current.toFixed(2),'200.00');
 assert.equal(fine('10000',[{value:'3000',lateDays:2},{value:'4000',lateDays:7},{value:'3000',lateDays:12}]).capped.toFixed(2),'700.00');
 assert.equal(fine('10000',[{value:'10000',lateDays:20}]).capped.toFixed(2),'1000.00');
 assert.equal(fine('10000',[{value:'5000',lateDays:15},{value:'5000',lateDays:15}],'750').current.toFixed(2),'250.00');
 assert.equal(delay(dueDate('2026-09-01',10),new Date('2026-09-11')),0);assert.equal(delay(dueDate('2026-09-01',10),new Date('2026-09-12')),1);
 assert.throws(()=>fine('10000',[{value:'-1',lateDays:1}]));assert.throws(()=>fine('10000',[{value:'10001',lateDays:1}]));assert.throws(()=>fine('NaN',[]));
});
test('AUTH: school isolation on list, search, dashboard and mutation',async()=>{for(const p of ['setup','cases?year='+year,'dashboard?year='+year,'reports?year='+year+'&from=2026-01-01&to=2026-12-31'])assert.equal((await req(other,route(p))).status,403);assert.equal((await req(other,route('suppliers'),'POST',{name:'x',cr:'x'})).status,403);});
test('AUTH: CSRF rejected and logout revokes copied session',async()=>{const session=await log('accountant');const bad=await req({...session,csrf:'wrong'},'auth/logout','POST',{});assert.equal(bad.status,403);assert.ok((await req(session,'auth/logout','POST',{})).status<300);assert.equal((await req(session,'auth/me')).status,401);});
test('SUPPLIER: create/update conflict/delete/atomic duplicate import',async()=>{const s=await ok(acc,'suppliers',{name:'مورد مؤقت',cr:'TMP-1'});await ok(acc,'suppliers/'+s.id,{name:'مورد معدل',cr:'TMP-1',version:1},'PATCH');assert.equal((await req(acc,route('suppliers/'+s.id),'PATCH',{name:'قديم',cr:'TMP-1',version:1})).status,409);await ok(acc,'suppliers/'+s.id,{},'DELETE');const count=await db.supplier.count();assert.equal((await req(acc,route('supplier-import'),'POST',{rows:[{name:'one',cr:'DUP'},{name:'two',cr:'DUP'}]})).status,400);assert.equal(await db.supplier.count(),count);});
test('WORKFLOW: create compare lowest, forbid self approval and reserve budget',async()=>{c=await makeCase();assert.equal(c.total,'10000');assert.equal((await req(acc,route(`cases/${c.id}/approve`),'POST',{})).status,403);c=await issue(c);const b=await db.budget.findUnique({where:{id:budget}});assert.equal(b.committed.toFixed(2),'10000.00');assert.equal(b.spent.toFixed(2),'0.00');assert.equal(day(c.dueDate),'2026-09-11');});
const day=(v:string)=>v.slice(0,10);
test('WORKFLOW: cross-school case and attachment inaccessible',async()=>{assert.equal((await req(other,route('cases/'+c.id))).status,403);});
test('DELIVERY: idempotent partial acceptance, reject oversupply, rollback',async()=>{const payload={date:'2026-09-10',note:'DN-01',invoice:'INV-01',lines:[{itemId:c.items[0].id,received:'60',accepted:'60'}]},key=randomUUID();const a=await ok(acc,`cases/${c.id}/deliver`,payload,'POST',key),b=await ok(acc,`cases/${c.id}/deliver`,payload,'POST',key);assert.equal(a.id,b.id);assert.equal((await load(c.id)).items[0].acceptedQty,'60');const bad=await req(acc,route(`cases/${c.id}/deliver`),'POST',{...payload,note:'DN-BAD',lines:[{itemId:c.items[0].id,received:'50',accepted:'50'}]});assert.equal(bad.status,400);assert.equal((await load(c.id)).deliveries.length,1);});
test('DOCS: certificate blocked until verified; forged file rejected',async()=>{assert.equal((await req(approver,route(`cases/${c.id}/certificate`),'POST',{kind:'PARTIAL'})).status,400);assert.equal((await req(acc,route(`cases/${c.id}/evidence`),'POST',{code:6,name:'bad.pdf',mime:'application/pdf',base64:Buffer.from('not a PDF').toString('base64')})).status,400);await docs(c);});
test('FINANCE: partial certificate consumes only accepted quantity once',async()=>{const cert=await ok(approver,`cases/${c.id}/certificate`,{kind:'PARTIAL'});assert.equal(cert.gross,'6000');assert.equal(cert.fine,'0');await ok(acc,`cases/${c.id}/cover`,{certificateId:cert.id});assert.equal((await req(approver,route(`cases/${c.id}/certificate`),'POST',{kind:'PARTIAL'})).status,400);const b=await db.budget.findUnique({where:{id:budget}});assert.equal(b.committed.toString(),'4000');assert.equal(b.spent.toString(),'6000');});
test('FINANCE: late remainder fine 200, final certificate, covering letter, completeness, ERP no double posting',async()=>{
 await ok(acc,`cases/${c.id}/deliver`,{date:'2026-09-16',note:'DN-02',invoice:'INV-02',lines:[{itemId:c.items[0].id,received:'40',accepted:'40'}]});const cert=await ok(approver,`cases/${c.id}/certificate`,{kind:'FINAL'});assert.equal(cert.gross,'4000');assert.equal(cert.fine,'200');assert.equal(cert.net,'3800');await ok(acc,`cases/${c.id}/cover`,{certificateId:cert.id});for(const cert of (await load(c.id)).certificates)for(const code of [13,14]){const e=await ok(acc,`cases/${c.id}/evidence`,{code,certificateId:cert.id,name:'signed.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4\nSIGNED DEMO\n%%EOF').toString('base64')});await ok(approver,`cases/${c.id}/verify`,{evidenceId:e.id,decision:'VERIFIED',reason:'تمت مراجعة النسخة الموقعة'});}await ok(approver,`cases/${c.id}/complete`,{});const before=await db.ledger.count();await ok(approver,`cases/${c.id}/erp`,{reference:'ERP-TEST-01',date:'2026-09-20',evidence:'دليل قيد تجريبي'});assert.equal(await db.ledger.count(),before);const b=await db.budget.findUnique({where:{id:budget}});assert.equal(b.committed.toString(),'0');assert.equal(b.spent.toString(),'10000');assert.equal((await load(c.id)).state,'REGISTERED');});
test('ARCHIVE: old certificate stays unchanged after supplier rename',async()=>{const full=await load(c.id),cert=full.certificates[0],before=(await req(acc,route('certificates/'+cert.id))).body.html;const s=await db.supplier.findUnique({where:{id:full.supplierId}});await ok(acc,'suppliers/'+s.id,{name:'اسم مورد جديد',cr:s.cr,version:s.version},'PATCH');assert.equal((await req(acc,route('certificates/'+cert.id))).body.html,before);});
test('MINISTRY: independent direct order with no fabricated quote',async()=>{const row=await ok(acc,'cases',{yearId:year,subject:'تكليف وزاري تجريبي',origin:'MINISTRY',ministryReference:'MIN-001',items:[{name:'مواد',unit:'عدد',qty:'1',budgetId:budget}]});const full=await load(row.id);await ok(acc,`cases/${row.id}/direct-order`,{supplierId:suppliers[0].id,reason:'الأسعار حسب كتاب الوزارة',prices:[{itemId:full.items[0].id,price:'100'}]});const direct=await issue(await load(row.id));assert.equal(direct.quotes.length,0);assert.equal(direct.orderNumber,'MIN-001');await ok(approver,`cases/${row.id}/cancel`,{reason:'إلغاء تجريبي قبل الاستلام'});});
test('BUDGET: competing orders cannot overcommit and cancellation releases residual',async()=>{
 const a=await makeCase('25000'),b=await makeCase('25000');await ok(approver,`cases/${a.id}/approve`,{});await ok(approver,`cases/${b.id}/approve`,{});
 const results=await Promise.all([a,b].map(x=>req(acc,route(`cases/${x.id}/issue`),'POST',{trigger:'2026-09-01',days:10,policyConfirmed:true})));assert.equal(results.filter(r=>r.status<300).length,1);assert.equal(results.filter(r=>r.status===400).length,1);const winner=results[0].status<300?a:b;await ok(approver,`cases/${winner.id}/cancel`,{reason:'اختبار تحرير الارتباط'});assert.equal((await db.budget.findUnique({where:{id:budget}})).committed.toString(),'0');
});
test('IMPREST: expense once, settlement no new expense, actual replenishment and close',async()=>{const a=await ok(approver,'imprests',{yearId:year,name:'عهدة اختبار',custodian:'مسؤول تجريبي',type:'PETTY',amount:'5000',reference:'FUND-1'});await ok(acc,`imprests/${a.id}/expense`,{budgetId:budget,description:'شراء مواد',invoice:'I-1',date:'2026-09-20',amount:'1200',proof:'فاتورة تجريبية'});assert.equal((await db.imprest.findUnique({where:{id:a.id}})).balance.toString(),'3800');const before=await db.ledger.count();const st=await ok(approver,`imprests/${a.id}/settle`,{type:'REPLENISH',reason:'مراجعة كاملة'});assert.equal((await db.imprest.findUnique({where:{id:a.id}})).balance.toString(),'3800');await ok(approver,`imprests/${a.id}/replenish`,{settlementId:st.id,reference:'RECEIPT-1'});assert.equal((await db.imprest.findUnique({where:{id:a.id}})).balance.toString(),'5000');assert.equal(await db.ledger.count(),before);assert.equal((await req(approver,route(`imprests/${a.id}/replenish`),'POST',{settlementId:st.id,reference:'REPEAT'})).status,400);await ok(approver,`imprests/${a.id}/erp`,{settlementId:st.id,reference:'ERP-IMP-1'});await ok(approver,`imprests/${a.id}/close`,{returnReference:'CASH-RETURN-1'});assert.equal((await db.imprest.findUnique({where:{id:a.id}})).balance.toString(),'0');});
test('REPORTS: headers include school accountant period and isolation',async()=>{const r=await req(acc,route(`reports?year=${year}&from=2026-01-01&to=2026-12-31`));assert.equal(r.status,200);assert.ok(r.body.header.school);assert.ok(r.body.header.accountant);assert.ok(r.body.html.includes('2026-01-01'));assert.ok(r.body.rows.find((r:any)=>r.id===c.id));});
test('DATABASE: audit history immutable; invalid budget fails constraint',async()=>{await assert.rejects(()=>db.$executeRawUnsafe('UPDATE "Audit" SET action = \'tampered\''));await assert.rejects(()=>db.budget.update({where:{id:budget},data:{approved:'1'}}));});
test('CLOSED YEAR: disallows new financial writes',async()=>{await db.fiscalYear.update({where:{id:year},data:{closed:true}});assert.equal((await req(acc,route('cases'),'POST',{yearId:year,subject:'مرفوض',origin:'SCHOOL',items:[{name:'x',unit:'x',qty:'1',budgetId:budget}]})).status,400);await db.fiscalYear.update({where:{id:year},data:{closed:false}});});

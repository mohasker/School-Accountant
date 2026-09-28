import {db} from '../apps/api/src/db';
import * as argon2 from 'argon2';

async function main(){
 if(process.env.DEMO_MODE!=='true'||!process.env.DEMO_PASSWORD||process.env.DEMO_PASSWORD.length<12)throw new Error('Set DEMO_MODE=true and DEMO_PASSWORD with 12+ characters.');
 if(await db.tenant.count())throw new Error('Seed requires an empty database. It never overwrites data.');
 const t=await db.tenant.create({data:{name:'جهة تجريبية — بيانات اصطناعية'}});
 const school=await db.school.create({data:{tenantId:t.id,code:'DEMO-A',name:'مدرسة الريادة التجريبية',principal:'مدير المدرسة التجريبي',pettyCustodian:'مسؤول العهدة التجريبي'}});
 const other=await db.school.create({data:{tenantId:t.id,code:'DEMO-B',name:'مدرسة الأفق التجريبية',principal:'مدير المدرسة الثانية'}});
 const passwordHash=await argon2.hash(process.env.DEMO_PASSWORD,{type:argon2.argon2id});
 for(const [username,name,roles,schools] of [['accountant','المحاسب التجريبي',['ACCOUNTANT'],[school]],['approver','المراجع المعتمد',['APPROVER','REVIEWER','ERP'],[school]],['admin','مدير الإعدادات',['ADMIN'],[school,other]],['other','محاسب المدرسة الثانية',['ACCOUNTANT'],[other]]] as const){const user=await db.user.create({data:{tenantId:t.id,username,name,passwordHash}});for(const sc of schools)await db.membership.create({data:{tenantId:t.id,userId:user.id,schoolId:sc.id,roles:[...roles]}});}
 for(const sc of [school,other]){const y=await db.fiscalYear.create({data:{schoolId:sc.id,label:'2026',startDate:new Date('2026-01-01'),endDate:new Date('2026-12-31')}});for(const [code,name,amount]of [['DEMO-01','مستلزمات تعليمية — تجريبي','50000'],['DEMO-02','صيانة وتجهيزات — تجريبي','80000'],['DEMO-03','أنشطة وفعاليات — تجريبي','30000']])await db.budget.create({data:{schoolId:sc.id,yearId:y.id,code,name,approved:amount}});}
 for(const [name,cr]of [['المورد التجريبي الأول','DEMO-CR-001'],['المورد التجريبي الثاني','DEMO-CR-002'],['المورد التجريبي الثالث','DEMO-CR-003']])await db.supplier.create({data:{schoolId:school.id,name,cr}});
 console.log('Demo accounts: accountant, approver, admin, other. Password is the supplied DEMO_PASSWORD.');
}main().finally(()=>db.$disconnect());

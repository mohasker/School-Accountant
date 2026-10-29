# سيرفر التجربة العملية — رابط ثابت بدومين

نسخة التجربة (بيانات تجريبية + الحساب المشترك **زائر / 112233**) على سيرفر صغير يعمل 24 ساعة، برابط ثابت وHTTPS. التثبيت بأمر واحد.

> للتجربة فقط. البيانات الحقيقية لا توضع على سيرفر خارج الوزارة قبل موافقة إدارة تقنية المعلومات (انظر `hosting-advice-ar.md`).

## 1) السيرفر

أي سيرفر **Ubuntu 24.04** بذاكرة **4 جيجابايت** على الأقل (2 جيجابايت يعمل مع ذاكرة احتياطية تضيفها السكربت لكنه أبطأ).

| المزود | الخطة المقترحة | ملاحظات |
|---|---|---|
| **Hetzner Cloud** (الأرخص) | CX22 أو ما يعادلها: 2 معالج، 4GB | الدفع بالبطاقة، الفاتورة بالساعة، الإلغاء في أي وقت |
| DigitalOcean | Droplet 4GB | واجهة سهلة |
| Azure — Qatar Central | B2s | داخل قطر؛ أنسب لاحقاً للبيانات الحقيقية بعد الموافقة |

الخطوات (Hetzner مثالاً): إنشاء حساب ← **Add Server** ← Image: **Ubuntu 24.04** ← النوع ← اكتب كلمة مرور root أو مفتاح SSH ← **Create**. انسخ **عنوان IP** للسيرفر.

## 2) الدومين (اختياري)

- **بدون دومين**: السكربت يعطيك رابطاً مجانياً بـ HTTPS مثل `https://5-75-1-20.sslip.io` — يكفي لبدء التجربة فوراً.
- **بدومين**: اشترِ اسماً (مثل `moesas-qatar.com`) من Cloudflare أو Namecheap (حوالي 10–15 دولاراً سنوياً). في إعدادات DNS أضف سجلاً:
  - النوع **A**، الاسم `trial` (أو `@`)، القيمة **IP السيرفر**.
  - الرابط يصبح `https://trial.moesas-qatar.com`. في Cloudflare اجعل السحابة **رمادية (DNS only)** حتى تصدر الشهادة.

## 3) التثبيت — أمر واحد

ادخل على السيرفر: من Windows افتح PowerShell واكتب `ssh root@IP` (أو زر **Console** في لوحة المزود)، ثم الصق:

```bash
curl -fsSL https://raw.githubusercontent.com/mohasker/School-Accountant/claude/vibrant-bell-tj6ext/deploy/install-trial.sh | sudo bash
```

يسألك سؤالاً واحداً: الدومين (اتركه فارغاً للرابط المجاني). بعد 5–15 دقيقة يطبع:

```
✅ نسخة التجربة تعمل: https://trial.moesas-qatar.com
   الحساب المشترك للتعميم:  زائر  /  112233
   حسابات الإدارة (لك وحدك، لا تُعمَّم): admin / accountant / supervisor — كلمة المرور: ‹كلمة عشوائية›
```

احفظ كلمة مرور حسابات الإدارة (موجودة أيضاً في `/opt/moesas-trial/.env`).

**لو المستودع Private** (الموصى به): أنشئ رمز قراءة من GitHub ← Settings ← Developer settings ← **Fine-grained tokens** ← Repository: School-Accountant فقط ← Contents: **Read-only**، ثم:

```bash
export MADAR_TOKEN=الرمز
curl -fsSL -H "Authorization: token $MADAR_TOKEN" https://raw.githubusercontent.com/mohasker/School-Accountant/claude/vibrant-bell-tj6ext/deploy/install-trial.sh | sudo -E bash
```

الرمز لا يُحفظ على السيرفر؛ للتحديث لاحقاً أعد نفس الأمرين.

## 4) التشغيل اليومي

| المطلوب | الأمر على السيرفر |
|---|---|
| تحديث لآخر إصدار (البيانات تبقى) | إعادة نفس أمر التثبيت |
| إعادة التجربة من البداية | `cd /opt/moesas-trial && docker compose -f deploy/docker-compose.trial.yml --env-file .env down -v` ثم أمر التثبيت |
| متابعة السجل | `cd /opt/moesas-trial && docker compose -f deploy/docker-compose.trial.yml --env-file .env logs -f trial` |
| إيقاف السيرفر نهائياً | من لوحة المزود: Delete server (يتوقف الحساب المالي) |

- السيرفر يعيد تشغيل النظام تلقائياً بعد أي انقطاع أو إعادة تشغيل.
- بيانات التجربة في مخزن Docker على السيرفر وتبقى بين التحديثات؛ لا توجد نسخة احتياطية يومية لأنها بيانات تجريبية.
- كلمة المرور الخاطئة من مجرّب لا تقفل حساب «زائر» على الباقين؛ الحد يُحسب لكل جهاز (عنوان IP).

## ما الفرق عن النشر الرسمي؟

النشر الرسمي `deploy/install.sh`: قاعدة PostgreSQL منفصلة، فحص الملفات من الفيروسات، نسخة احتياطية كل ليلة، بلا بيانات تجريبية ولا حساب مشترك. نفس السيرفر يمكن تحويله لاحقاً للنشر الرسمي.

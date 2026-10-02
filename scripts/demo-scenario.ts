import { randomUUID } from 'node:crypto';
import { DEMO_PETTY } from './demo-data';

/**
 * Fills a freshly seeded trial with realistic purchase files and imprests through the API, so every
 * document is produced by the real workflow: completed files (quote report, assignment letter,
 * completion certificate and covering letter), one with a delay fine, files in progress, and a petty
 * cash imprest with the invoices of the approved statement, settled for replenishment.
 */
export async function runScenario(api: string, origin: string, password: string) {
  const login = async (username: string) => {
    const r = await fetch(api + '/auth/login', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw Error('login ' + username + ': ' + r.status);
    return { cookie: r.headers.get('set-cookie')!.split(';')[0], csrf: (await r.json()).csrf as string };
  };
  const s = await login('accountant');
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const r = await fetch(api + '/' + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: s.cookie,
        'X-CSRF-Token': s.csrf,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw Error(`${method} ${path}: ${data.message ?? r.status}`);
    return data;
  };

  const me = await call('auth/me');
  const first = me.schools.find((x: any) => x.name.startsWith('محمد بن عبد الوهاب')) ?? me.schools[0];
  const second = me.schools.find((x: any) => x.name.startsWith('الإمام الشافعي')) ?? me.schools[1];

  async function fill(schoolId: string, files: Scenario[], petty: boolean) {
    const root = (p: string) => `schools/${schoolId}/${p}`;
    const setup = await call(root('setup'));
    const year = setup.years[0].id;
    const line = (code: string) => setup.budgets.find((b: any) => b.code === code).id;
    for (const f of files) {
      const created = await call(root('cases'), 'POST', {
        yearId: year,
        subject: f.subject,
        origin: 'SCHOOL',
        items: f.items.map(([name, unit, qty, code]) => ({ name, unit, qty, budgetId: line(code) })),
      });
      const c = await call(root('cases/' + created.id));
      for (const [supplierName, prices, reference] of f.quotes)
        await call(root(`cases/${c.id}/quotes`), 'POST', {
          supplierName,
          reference,
          quoteDate: f.report,
          compliant: true,
          prices: c.items.map((i: any, n: number) => ({ itemId: i.id, price: prices[n] })),
        });
      if (!f.order) continue;
      await call(root(`cases/${c.id}/evaluate`), 'POST', { date: f.report });
      if (f.order === 'report') continue;
      await call(root(`cases/${c.id}/issue`), 'POST', { trigger: f.order[0], days: f.order[1], policyConfirmed: true });
      if (!f.done) continue;
      await call(root(`cases/${c.id}/finish`), 'POST', {
        completionDate: f.done[0],
        invoice: f.done[1],
        date: f.done[2] ?? f.done[0],
      });
    }
    if (!petty) return;
    const imprest = await call(root('imprests'), 'POST', {
      yearId: year,
      type: 'PETTY',
      name: 'العهدة النثرية 2026',
      custodian: setup.school.pettyCustodian,
      amount: '12000',
      reference: 'شيك رقم 100245',
    });
    // Invoices are entered once, on the settlement screen, together with the statement.
    await call(root(`imprests/${imprest.id}/settle`), 'POST', {
      type: 'REPLENISH',
      date: '2026-02-25',
      invoices: DEMO_PETTY.map(([vendor, invoice, date, description, code, amount, note]) => ({
        vendor,
        invoice,
        date,
        description,
        budgetId: line(code),
        amount,
        note,
      })),
    });
    const book = await call(root('imprests'), 'POST', {
      yearId: year,
      type: 'BOOK',
      name: 'عهدة معرض الكتاب 2026',
      custodian: setup.school.pettyCustodian,
      amount: '5000',
      reference: 'شيك رقم 100311',
    });
    await call(root(`imprests/${book.id}/settle`), 'POST', {
      type: 'CLOSE',
      date: '2026-05-20',
      returnReference: 'إيصال إعادة رصيد 2026/14',
      invoices: [
        {
          vendor: 'دار الثقافة للطباعة و الصحافة و النشر و التوزيع',
          invoice: 'BF-2026-118',
          date: '2026-05-12',
          description: 'كتب مكتبة المدرسة - معرض الدوحة للكتاب',
          budgetId: line('510201'),
          amount: '980',
          asset: true,
        },
      ],
    });
  }

  await fill(
    first.id,
    [
      {
        subject: 'توريد أقلام سبورة تفاعلية',
        items: [['قلم سبورة تفاعلية', 'عدد', '10', '510401']],
        quotes: [
          ['المؤيد للخدمات التجارية ذ. م. م.', ['250'], '21Q/ACSQ/ANK/MBAB/31174'],
          ['قطر لخدمات الكمبيوتر W.L.L.', ['275'], 'QCS-2026-311'],
          ['SMARTQAT TRADING', ['290'], 'SQ-7781'],
        ],
        report: '2026-03-01',
        order: ['2026-03-02', 10],
        done: ['2026-03-12', '22518'],
      },
      {
        subject: 'طباعة بنرات ولوحات إرشادية',
        items: [
          ['بنر مطبوع 3×2 م', 'عدد', '4', '520601'],
          ['لوحة إرشادية فوم', 'عدد', '6', '520601'],
        ],
        quotes: [['مطابع رينودا الحديثة', ['120', '70'], 'RN-4410']],
        report: '2026-04-05',
        order: ['2026-04-06', 5],
        done: ['2026-04-20', '32190'],
      },
      {
        subject: 'صيانة أجهزة العرض (بروجكتر) بالفصول',
        items: [['صيانة جهاز عرض شاملة قطع الغيار', 'جهاز', '12', '530301']],
        quotes: [
          ['قطر لخدمات الكمبيوتر W.L.L.', ['375'], 'QCS-2026-588'],
          ['JAVA COMPUTER TECHNOLOGY', ['410'], 'JCT/Q/902'],
          ['الغشام العالمية آر بي تك ذ. م. م.', ['430'], 'GH-1170'],
        ],
        report: '2026-09-01',
        order: ['2026-09-02', 15],
      },
      {
        subject: 'توريد أدوات رياضية لقسم التربية البدنية',
        items: [
          ['كرة قدم مقاس 5', 'عدد', '20', '540201'],
          ['كرة سلة', 'عدد', '15', '540201'],
        ],
        quotes: [
          ['إيكو سبورت', ['85', '95'], 'ES-3321'],
          ['الركن الرياضي', ['90', '92'], 'SC-118'],
          ['سوكر سبورت للتجارة', ['99', '105'], 'SOC-77'],
        ],
        report: '2026-09-15',
        order: 'report',
      },
      {
        subject: 'توريد قرطاسية ومستلزمات مكتبية',
        items: [['ورق تصوير A4 (كرتون)', 'كرتون', '40', '520501']],
        quotes: [
          ['الغرافة للقرطاسية و اللوازم المكتبية', ['68'], 'GH-2026-45'],
          ['برونز لتجارة الأدوات المكتبية', ['72'], 'BR-889'],
        ],
        report: '2026-09-20',
      },
    ],
    true,
  );
  if (second)
    await fill(
      second.id,
      [
        {
          subject: 'توريد هدايا تكريم الطلاب المتفوقين',
          items: [['درع تكريم', 'عدد', '30', '540201']],
          quotes: [
            ['مدينة الهدايا للتجارة', ['55'], 'GC-661'],
            ['الجابر للساعات', ['60'], 'JW-120'],
            ['سفن آرتس للتجارة و الخدمات - 7 Arts', ['62'], '7A-310'],
          ],
          report: '2026-05-03',
          order: ['2026-05-04', 10],
          done: ['2026-05-14', 'INV-5521'],
        },
      ],
      false,
    );
}

type Scenario = {
  subject: string;
  items: [string, string, string, string][];
  quotes: [string, string[], string][];
  report: string;
  order?: [string, number] | 'report';
  done?: [string, string, string?];
};

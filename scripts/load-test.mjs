// Load test: N testers sign in as «زائر» and browse the main screens through the web server, like real users.
// Usage: node scripts/load-test.mjs USERS SECONDS   (TARGET=https://trial.example.com to test a server)
const ORIGIN = (process.env.TARGET || 'http://localhost:3000').replace(/\/$/, ''),
  BASE = ORIGIN + '/api';
const [users, seconds] = [Number(process.argv[2] || 10), Number(process.argv[3] || 60)];
const stats = {};
let errors = 0,
  errSample = '';
const rec = (k, ms, ok, info) => {
  (stats[k] ??= []).push(ms);
  if (!ok) {
    errors++;
    errSample ||= k + ' ' + info;
  }
};
async function call(name, cookie, path, method = 'GET', body, csrf) {
  const t = performance.now();
  const r = await fetch(BASE + '/' + path, {
    method,
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  rec(name, performance.now() - t, r.status < 300, r.status + ' ' + text.slice(0, 80));
  return { r, text };
}
async function tester(i, until) {
  const { r, text } = await call('login', null, 'auth/login', 'POST', { username: 'زائر', password: '112233' });
  if (r.status >= 300) return;
  const cookie = r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
    csrf = JSON.parse(text).csrf;
  const me = JSON.parse((await call('me', cookie, 'auth/me')).text);
  while (performance.now() < until) {
    const s = me.schools[Math.floor(Math.random() * me.schools.length)].id;
    const setup = JSON.parse((await call('setup', cookie, `schools/${s}/setup`)).text);
    const y = setup.years[0].id;
    await call('dashboard', cookie, `schools/${s}/dashboard?year=${y}`);
    await call('cases', cookie, `schools/${s}/cases?year=${y}`);
    await call('imprests', cookie, `schools/${s}/imprests?year=${y}`);
    if (Math.random() < 0.2) await call('note(write)', cookie, 'admin/my-notes', 'POST', { text: 'load ' + i, color: 'yellow' }, csrf);
    await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000)); // a person reads the screen
  }
}
const until = performance.now() + seconds * 1000;
await Promise.all(Array.from({ length: users }, (_, i) => tester(i, until)));
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const total = Object.values(stats).reduce((n, a) => n + a.length, 0);
console.log(`users=${users} seconds=${seconds} requests=${total} (${(total / seconds).toFixed(1)}/s) errors=${errors} ${errSample}`);
for (const [k, a] of Object.entries(stats))
  console.log(
    `  ${k.padEnd(12)} n=${String(a.length).padStart(5)}  median=${q(a, 0.5).toFixed(0)}ms  p95=${q(a, 0.95).toFixed(0)}ms  max=${Math.max(...a).toFixed(0)}ms`,
  );

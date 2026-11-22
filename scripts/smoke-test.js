// Smoke-тест: поднимает каждый сайт на временном порту со свежей БД и прогоняет основные сценарии API.
// Запуск: npm test
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITES } from './sites.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_PORT = 4100;
let failures = 0;

const check = (cond, msg) => { if (!cond) { failures++; console.log(`    ✗ ${msg}`); } else console.log(`    ✓ ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(port, headers = {}) {
  return async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: res.status === 204 ? null : ct.includes('json') ? await res.json() : await res.text() };
  };
}

const TESTS = {
  '01-ember-roastery': async (r) => {
    const p = await r('GET', '/api/products'); check(p.data.length >= 10, 'menu loads');
    const o = await r('POST', '/api/orders', { customer: 'Test', email: 't@t.io', pickup_time: '10:00', items: [{ id: p.data[0].id, qty: 2 }] });
    check(o.status === 201 && o.data.total_cents === p.data[0].price_cents * 2, 'order total computed server-side');
    check((await r('GET', `/api/orders/${o.data.id}`)).data.items.length === 1, 'order retrievable');
    check((await r('POST', '/api/orders', { customer: 'x', email: 'bad', pickup_time: '10:00', items: [] })).status === 400, 'invalid order rejected');
    check((await r('POST', '/api/reviews', { author: 'Т', rating: 5, body: 'Чудесный кофе' })).status === 201, 'review created');
  },
  '02-brutal-notes': async (r) => {
    const c = await r('POST', '/api/notes', { title: 'Тест', body: 'x', color: 'pink', tags: ['qa', 'Работа'] });
    check(c.status === 201 && c.data.tags.includes('работа'), 'note created with Cyrillic tags');
    check((await r('GET', '/api/notes?q=ТЕСТ')).data.length === 1, 'case-insensitive Cyrillic search');
    check((await r('PUT', `/api/notes/${c.data.id}`, { title: 'Edited', tags: ['qa'] })).data.title === 'Edited', 'note updated');
    check((await r('PATCH', `/api/notes/${c.data.id}/pin`)).data.pinned === true, 'note pinned');
    check((await r('GET', '/api/notes?tag=qa')).data.length === 1, 'filter by tag');
    check((await r('DELETE', `/api/notes/${c.data.id}`)).status === 204, 'note deleted');
  },
  '03-orbit-voyages': async (r) => {
    const d = await r('GET', '/api/destinations'); check(d.data.length === 5, 'destinations load');
    const det = await r('GET', `/api/destinations/${d.data[0].slug}`);
    const launch = det.data.launches.find((l) => l.seats_total === 6);
    const b = await r('POST', '/api/bookings', { full_name: 'Ada L', email: 'a@l.io', seats: 6, cabin: 'zenith', launch_id: launch.id });
    check(b.status === 201 && b.data.code.startsWith('ORB-'), 'booking created');
    check((await r('POST', '/api/bookings', { full_name: 'Bob', email: 'b@l.io', seats: 1, cabin: 'explorer', launch_id: launch.id })).status === 409, 'overbooking prevented');
    check((await r('GET', `/api/bookings/${b.data.code}`)).data.seats === 6, 'booking lookup');
  },
  '04-verdant': async (r) => {
    check((await r('GET', '/api/plants?pet_safe=1')).data.every((p) => p.pet_safe), 'pet-safe filter');
    const m = await r('POST', '/api/match', { light: 'low', water: 'rarely', pets: 'yes', experience: '1' });
    check(m.data.length === 3 && m.data.every((p) => p.pet_safe), 'quiz returns pet-safe matches');
    check((await r('POST', '/api/wishlist/1')).data.saved === true, 'wishlist add');
    check((await r('GET', '/api/wishlist')).data.length === 1, 'wishlist persisted per visitor');
    check((await r('POST', '/api/subscribe', { email: 'p@p.io' })).status === 201, 'newsletter subscribe');
  },
  '05-pixel-arcade': async (r) => {
    const s = await r('POST', '/api/sessions', { game: 'snake' }); check(s.status === 201, 'session issued');
    check((await r('POST', '/api/scores', { token: s.data.token, score: 99999, initials: 'BAD' })).status === 422, 'implausible score rejected');
    const ok = await r('POST', '/api/scores', { token: s.data.token, score: 30, initials: 'qa1' });
    check(ok.status === 201 && ok.data.initials === 'QA1', 'score saved');
    check((await r('POST', '/api/scores', { token: s.data.token, score: 30, initials: 'QA1' })).status === 403, 'token cannot be reused');
    check((await r('GET', '/api/leaderboard/snake')).data.length > 0, 'leaderboard');
  },
  '06-atelier-noir': async (r) => {
    check((await r('GET', '/api/collections')).data.length === 2, 'collections load');
    const a = await r('GET', '/api/availability');
    const body = { day: a.data.days[0].day, slot: '11:00', service: a.data.services[0], name: 'Coco', email: 'c@c.fr' };
    check((await r('POST', '/api/appointments', body)).status === 201, 'appointment booked');
    check((await r('POST', '/api/appointments', body)).status === 409, 'double booking prevented');
    check((await r('POST', '/api/looks/1/like')).data.likes === 1, 'like a look');
  },
  '07-synthwave-fm': async (r) => {
    check((await r('GET', '/api/schedule')).data.shows.length === 6, 'schedule loads');
    const c = await r('POST', '/api/requests', { artist: 'QA Band', title: 'Test Track', requested_by: 'qa' });
    check(c.status === 201, 'request created');
    check((await r('POST', '/api/requests', { artist: 'qa band', title: 'test track' })).status === 409, 'duplicate request blocked');
    check((await r('POST', '/api/requests/1/vote')).data.voted === true, 'upvote');
    check((await r('POST', '/api/requests/1/vote')).data.voted === false, 'vote toggles off');
    check((await r('POST', '/api/requests/next')).status === 200, 'DJ next');
  },
  '08-glass-ledger': async (r) => {
    const cats = (await r('GET', '/api/categories')).data; check(cats.length === 8, 'categories load');
    const month = new Date().toISOString().slice(0, 7);
    const before = (await r('GET', `/api/summary?month=${month}`)).data;
    const t = await r('POST', '/api/transactions', { amount: '12.50', category_id: cats.find((c) => c.kind === 'expense').id, date: `${month}-01`, note: 'QA' });
    check(t.status === 201 && t.data.amount_cents === 1250, 'transaction created');
    const after = (await r('GET', `/api/summary?month=${month}`)).data;
    check(after.expenses - before.expenses === 1250, 'summary reflects transaction');
    check((await r('DELETE', `/api/transactions/${t.data.id}`)).status === 204, 'transaction deleted');
    check(String((await r('GET', '/api/export.csv')).data).includes('дата,категория'), 'CSV export');
  },
  '09-paper-kitchen': async (r) => {
    check((await r('GET', '/api/recipes')).data.length === 6, 'recipes load');
    check((await r('GET', '/api/recipes?q=РИКОТТ')).data.length === 1, 'search by ingredient (Cyrillic, any case)');
    const n = await r('POST', '/api/recipes', { title: 'Тост', summary: 'Просто тост.', minutes: 5, servings: 1, tag: 'быстро', ingredients: [{ qty: 1, unit: 'шт', item: 'хлеб' }], steps: ['Поджарить'] });
    check(n.status === 201, 'recipe submitted');
    check((await r('GET', `/api/recipes/${n.data.id}`)).data.ingredients.length === 1, 'recipe detail with ingredients');
    check((await r('POST', `/api/recipes/${n.data.id}/rate`, { stars: 4 })).data.rating === 4, 'rating');
    check((await r('POST', `/api/recipes/${n.data.id}/comments`, { body: 'Вкусно' })).status === 201, 'comment');
  },
  '10-terminal-jobs': async (r) => {
    check((await r('GET', '/api/jobs')).data.length === 8, 'jobs load');
    check((await r('GET', '/api/jobs?q=rust')).data.length === 1, 'search');
    check((await r('GET', '/api/jobs?q=москва')).data.length === 2, 'Cyrillic city search');
    check((await r('GET', '/api/jobs/1')).data.contact_email === undefined, 'employer email hidden');
    const p = await r('POST', '/api/jobs', { title: 'QA-инженер', company: 'Testco', remote: 'да', level: 'middle', stack: 'playwright, ts', description: 'Профессионально и часто ломаем всё подряд.', contact_email: 'qa@test.co' });
    check(p.status === 201, 'job posted');
    const a = { name: 'Грейс', email: 'g@h.io', message: 'Обожаю находить баги.' };
    check((await r('POST', `/api/jobs/${p.data.id}/apply`, a)).status === 201, 'application sent');
    check((await r('POST', `/api/jobs/${p.data.id}/apply`, a)).status === 409, 'duplicate application blocked');
  },
};

for (const [i, site] of SITES.entries()) {
  const port = BASE_PORT + i;
  const cwd = path.join(root, 'sites', site.dir);
  rmSync(path.join(cwd, 'data'), { recursive: true, force: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  console.log(`\n▶ ${site.name}`);
  try {
    let up = false;
    for (let k = 0; k < 40 && !up; k++) { try { await fetch(`http://127.0.0.1:${port}/`); up = true; } catch { await sleep(100); } }
    check(up, 'server starts');
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    check(html.includes('<!DOCTYPE html>'), 'index.html served');
    await TESTS[site.dir](client(port, { 'X-Visitor': 'smoke-test-visitor-0001' }));
  } catch (e) {
    failures++; console.log(`    ✗ crashed: ${e.message}`);
  } finally {
    child.kill();
    await sleep(150);
    rmSync(path.join(cwd, 'data'), { recursive: true, force: true }); // leave a clean slate: DB re-seeds on next real start
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed ✔');
process.exit(failures ? 1 : 0);

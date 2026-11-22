const $ = (s) => document.querySelector(s);
const out = $('#out'), input = $('#cmd'), screen = $('#screen'), ps1 = $('#ps1');
const PS1_HTML = ps1.innerHTML;

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `ошибка HTTP ${res.status}`);
  return data;
}

// ---------- Output helpers (all text goes through textContent — no HTML injection) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scroll = () => (screen.scrollTop = screen.scrollHeight);
function line(parts = '', cls = '') {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  (Array.isArray(parts) ? parts : [parts]).forEach((p) => {
    if (typeof p === 'string') d.append(p);
    else {
      const s = document.createElement('span');
      s.textContent = p.t; if (p.c) s.className = p.c;
      if (p.cmd) { s.classList.add('c-link'); s.onclick = () => run(p.cmd); }
      d.append(s);
    }
  });
  out.append(d); scroll();
  return d;
}
async function type(text, cls = '', speed = 8) {
  const d = line('', cls);
  for (let i = 0; i < text.length; i += 2) { d.textContent = text.slice(0, i + 2); scroll(); await sleep(speed); }
  return d;
}
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const salary = (j) => (j.salary_min || j.salary_max ? `${j.salary_min ?? '?'}–${j.salary_max ?? '?'}к ₽` : 'н/д');
const ago = (iso) => { const d = Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 86400000); return d <= 0 ? 'сегодня' : `${d} дн. назад`; };

// ---------- Interactive prompts (used by apply / post wizards) ----------
let pending = null;
function ask(question, { optional = false } = {}) {
  ps1.textContent = `${question}${optional ? ' (необязательно)' : ''} >`;
  ps1.className = 'c-amb';
  return new Promise((resolve, reject) => { pending = { resolve, reject, question }; });
}
function resetPrompt() { ps1.innerHTML = PS1_HTML; ps1.className = ''; pending = null; }

// ---------- Commands ----------
const COMMANDS = {
  help: { desc: 'показать эту справку', run: () => {
    line({ t: 'Доступные команды:', c: 'c-wh' });
    Object.entries(COMMANDS).forEach(([k, v]) => line([{ t: '  ' + pad(k, 10), c: 'c-cy' }, { t: v.desc, c: 'c-dim' }]));
    line([{ t: 'Флаги для ls: ', c: 'c-dim' }, '--remote  --level=junior|middle|senior|lead']);
    line({ t: 'Подсказки: ↑/↓ история · Tab автодополнение · Ctrl+C отмена · кликните по [id], чтобы открыть', c: 'c-dim' });
  } },
  ls: { desc: 'список вакансий  (ls --remote, ls --level=senior)', run: async (args) => {
    const p = new URLSearchParams();
    if (args.includes('--remote')) p.set('remote', '1');
    const lvl = args.find((a) => a.startsWith('--level='));
    if (lvl) p.set('level', lvl.split('=')[1]);
    printJobs(await api(`/api/jobs?${p}`));
  } },
  search: { desc: 'search <запрос> — по должности, компании, стеку или городу', run: async (args) => {
    if (!args.length) return line({ t: 'использование: search <запрос>', c: 'c-err' });
    printJobs(await api(`/api/jobs?q=${encodeURIComponent(args.join(' '))}`));
  } },
  cat: { desc: 'cat <id> — полное описание вакансии', run: async ([id]) => {
    if (!id) return line({ t: 'использование: cat <id>', c: 'c-err' });
    const j = await api(`/api/jobs/${encodeURIComponent(id)}`);
    line({ t: `┌─ #${j.id} ${'─'.repeat(50)}`, c: 'c-dim' });
    line([{ t: '│ ', c: 'c-dim' }, { t: j.title, c: 'c-wh' }, ' @ ', { t: j.company, c: 'c-amb' }]);
    line([{ t: '│ ', c: 'c-dim' }, `📍 ${j.location}${j.remote ? ' · можно удалённо' : ''} · ${j.level} · ${salary(j)} · опубликовано ${ago(j.created_at)}`]);
    line([{ t: '│ ', c: 'c-dim' }, { t: 'стек: ', c: 'c-dim' }, { t: j.stack.join(' · '), c: 'c-cy' }]);
    line({ t: '│', c: 'c-dim' });
    await type(`│ ${j.description}`, 'c-ok', 4);
    line({ t: '│', c: 'c-dim' });
    line([{ t: '│ ', c: 'c-dim' }, `откликов: ${j.applicants} → `, { t: `apply ${j.id}`, cmd: `apply ${j.id}` }]);
    line({ t: `└${'─'.repeat(56)}`, c: 'c-dim' });
  } },
  apply: { desc: 'apply <id> — откликнуться (пошагово)', run: async ([id]) => {
    if (!id) return line({ t: 'использование: apply <id>', c: 'c-err' });
    const j = await api(`/api/jobs/${encodeURIComponent(id)}`);
    line([{ t: `Отклик на вакансию `, c: 'c-dim' }, { t: `${j.title} @ ${j.company}`, c: 'c-wh' }, { t: ' (Ctrl+C — отмена)', c: 'c-dim' }]);
    const name = await ask('имя');
    const email = await ask('email');
    const github = await ask('ссылка на github', { optional: true });
    const message = await ask('почему вы? (одной строкой)');
    await progress('отправляем отклик');
    const r = await api(`/api/jobs/${j.id}/apply`, { method: 'POST', body: JSON.stringify({ name, email, github, message }) });
    line({ t: `✔ отклик #${r.id} отправлен в ${j.company}. удачи, ${name}! 🚀`, c: 'c-ok' });
    loadMini();
  } },
  post: { desc: 'post — опубликовать вакансию (пошагово)', run: async () => {
    line({ t: 'Публикуем новую вакансию. Ctrl+C — отмена.', c: 'c-dim' });
    const body = {};
    body.title = await ask('должность');
    body.company = await ask('компания');
    body.location = await ask('город');
    body.remote = await ask('удалёнка? (д/н)');
    body.level = await ask('уровень [junior|middle|senior|lead]');
    body.stack = await ask('стек (через запятую)');
    body.salary_min = await ask('зарплата от, тыс. ₽', { optional: true });
    body.salary_max = await ask('зарплата до, тыс. ₽', { optional: true });
    body.description = await ask('описание');
    body.contact_email = await ask('email для связи (не публикуется)');
    await progress('публикуем');
    const r = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    line([{ t: `✔ вакансия #${r.id} опубликована → `, c: 'c-ok' }, { t: `cat ${r.id}`, cmd: `cat ${r.id}` }]);
    loadMini();
  } },
  stats: { desc: 'статистика доски', run: async () => {
    const s = await api('/api/stats');
    line([{ t: 'вакансий        ', c: 'c-dim' }, { t: String(s.jobs), c: 'c-wh' }]);
    line([{ t: 'удалённых       ', c: 'c-dim' }, { t: `${s.remote} (${Math.round((s.remote / s.jobs) * 100)}%)`, c: 'c-wh' }]);
    line([{ t: 'откликов        ', c: 'c-dim' }, { t: String(s.applications), c: 'c-wh' }]);
    line([{ t: 'средняя з/п     ', c: 'c-dim' }, { t: `${s.avg_salary_k} тыс. ₽`, c: 'c-wh' }]);
    line({ t: 'популярный стек:', c: 'c-dim' });
    const max = s.top_stack[0]?.[1] || 1;
    s.top_stack.forEach(([t, n]) => line([{ t: '  ' + pad(t, 12), c: 'c-cy' }, { t: '█'.repeat(Math.round((n / max) * 24)), c: 'bar' }, ` ${n}`]));
  } },
  whoami: { desc: 'кто вы?', run: () => line('guest — любопытный разработчик в поиске нового приключения.') },
  matrix: { desc: 'выбрать красную таблетку', run: () => { matrixRain(); line({ t: 'Проснись, Нео…', c: 'c-ok' }); } },
  clear: { desc: 'очистить экран', run: () => out.replaceChildren() },
};

// Russian aliases for the main commands
const ALIASES = { 'помощь': 'help', 'вакансии': 'ls', 'поиск': 'search', 'открыть': 'cat', 'отклик': 'apply', 'разместить': 'post', 'статистика': 'stats', 'очистить': 'clear' };

function printJobs(jobs) {
  if (!jobs.length) return line({ t: 'ничего не найдено. попробуйте `ls` или другой запрос.', c: 'c-amb' });
  line({ t: `${pad('ID', 5)}${pad('ДОЛЖНОСТЬ', 32)}${pad('КОМПАНИЯ', 18)}${pad('ГДЕ', 19)}${pad('УРОВЕНЬ', 9)}ЗАРПЛАТА`, c: 'c-dim' });
  jobs.forEach((j) => line([
    { t: `[${j.id}]`, cmd: `cat ${j.id}` }, ' '.repeat(Math.max(1, 5 - `[${j.id}]`.length)),
    { t: pad(j.title, 32), c: 'c-wh' }, { t: pad(j.company, 18), c: 'c-amb' },
    pad(`${j.remote ? '🌍 ' : ''}${j.location}`, 18) + ' ', pad(j.level, 9), { t: salary(j), c: 'c-cy' },
  ]));
  line({ t: `вакансий: ${jobs.length}. введите \`cat <id>\` или кликните по [id].`, c: 'c-dim' });
}
async function progress(label) {
  const d = line('', 'c-dim');
  for (let i = 0; i <= 20; i++) { d.textContent = `${label} [${'#'.repeat(i)}${'.'.repeat(20 - i)}] ${i * 5}%`; await sleep(25); }
}

// ---------- Input handling ----------
const history = []; let hIdx = 0; let busy = false;
async function run(raw) {
  const cmdline = raw.trim();
  if (pending) {
    const { resolve, question } = pending;
    line([{ t: `${question} > `, c: 'c-amb' }, { t: cmdline, c: 'c-cmd' }]);
    resetPrompt(); resolve(cmdline);
    return;
  }
  if (busy) return;
  line([{ t: 'guest', c: 'c-cy' }, '@', { t: 'jobs', c: 'c-amb' }, ':~$ ', { t: cmdline, c: 'c-cmd' }]);
  if (!cmdline) return;
  history.push(cmdline); hIdx = history.length;
  const [name, ...args] = cmdline.split(/\s+/);
  const cmd = COMMANDS[ALIASES[name.toLowerCase()] || name.toLowerCase()];
  if (!cmd) return line({ t: `${name}: команда не найдена. введите \`help\`.`, c: 'c-err' });
  busy = true;
  try { await cmd.run(args); }
  catch (e) { if (e !== 'SIGINT') line({ t: `error: ${e.message}`, c: 'c-err' }); }
  finally { busy = false; resetPrompt(); input.focus(); scroll(); }
}

$('#promptForm').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; run(v); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && !pending) { e.preventDefault(); hIdx = Math.max(0, hIdx - 1); input.value = history[hIdx] || ''; }
  if (e.key === 'ArrowDown' && !pending) { e.preventDefault(); hIdx = Math.min(history.length, hIdx + 1); input.value = history[hIdx] || ''; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const matches = Object.keys(COMMANDS).filter((c) => c.startsWith(input.value));
    if (matches.length === 1) input.value = matches[0] + ' ';
    else if (matches.length > 1) line({ t: matches.join('   '), c: 'c-dim' });
  }
  if (e.key === 'c' && e.ctrlKey) {
    e.preventDefault();
    line({ t: '^C', c: 'c-err' });
    if (pending) { const { reject } = pending; resetPrompt(); reject('SIGINT'); }
    input.value = '';
  }
  if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); out.replaceChildren(); }
});
screen.addEventListener('click', () => { if (!getSelection().toString()) input.focus(); });
document.querySelectorAll('#quick button').forEach((b) => (b.onclick = () => run(b.dataset.cmd)));

// ---------- Side panel ----------
async function loadMini() {
  const jobs = (await api('/api/jobs')).slice(0, 6);
  $('#mini').replaceChildren(...jobs.map((j, i) => {
    const li = document.createElement('li');
    const b = document.createElement('b'); b.textContent = `[${j.id}] ${j.title}`;
    const s = document.createElement('small'); s.textContent = `${j.company} · ${j.remote ? 'удалённо' : j.location} · ${salary(j)}`;
    li.append(b, s); li.style.animationDelay = `${i * 60}ms`;
    li.onclick = () => run(`cat ${j.id}`);
    return li;
  }));
}
setInterval(() => ($('#clock').textContent = new Date().toLocaleTimeString('en-GB')), 1000);

// ---------- Matrix rain easter egg ----------
function matrixRain() {
  const c = $('#matrix'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight; c.classList.add('on');
  const cols = Math.floor(c.width / 16), drops = Array(cols).fill(0).map(() => Math.random() * -50);
  const chars = 'アイウエオカキクケコサシスセソ01JOBS<>/{}$#';
  const start = Date.now();
  (function f() {
    ctx.fillStyle = 'rgba(5,8,5,.12)'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#33ff66'; ctx.font = '15px JetBrains Mono';
    drops.forEach((y, i) => { ctx.fillText(chars[(Math.random() * chars.length) | 0], i * 16, y * 16); drops[i] = y * 16 > c.height && Math.random() > 0.97 ? 0 : y + 1; });
    if (Date.now() - start < 5000) requestAnimationFrame(f);
    else { c.classList.remove('on'); setTimeout(() => ctx.clearRect(0, 0, c.width, c.height), 700); }
  })();
}

// ---------- Boot sequence ----------
(async function boot() {
  busy = true;
  const logo = [
    ' _____                   _             _       _       _         ',
    '|_   _|__ _ __ _ __ ___ (_)_ __   __ _| |     | | ___ | |__  ___ ',
    "  | |/ _ \\ '__| '_ ` _ \\| | '_ \\ / _` | |  _  | |/ _ \\| '_ \\/ __|",
    '  | |  __/ |  | | | | | | | | | | (_| | | | |_| | (_) | |_) \\__ \\',
    '  |_|\\___|_|  |_| |_| |_|_|_| |_|\\__,_|_|  \\___/ \\___/|_.__/|___/',
  ];
  for (const l of ['[ OK ] монтируем /dev/jobs', '[ OK ] подключаемся к sqlite://jobs.db', '[ OK ] загружаем вакансии']) { line(l, 'c-dim'); await sleep(180); }
  logo.forEach((l) => line(l, 'ascii'));
  await type('Добро пожаловать в Terminal Jobs — вакансии для тех, кто живёт в терминале.', 'c-wh', 12);
  line([{ t: 'Введите ', c: 'c-dim' }, { t: 'help', cmd: 'help' }, { t: ', чтобы начать, или ', c: 'c-dim' }, { t: 'ls', cmd: 'ls' }, { t: ', чтобы увидеть все вакансии.', c: 'c-dim' }]);
  busy = false;
  input.focus();
  loadMini();
})();

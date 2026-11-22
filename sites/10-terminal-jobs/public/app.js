const $ = (s) => document.querySelector(s);
const out = $('#out'), input = $('#cmd'), screen = $('#screen'), ps1 = $('#ps1');
const PS1_HTML = ps1.innerHTML;

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
const salary = (j) => (j.salary_min || j.salary_max ? `€${j.salary_min ?? '?'}–${j.salary_max ?? '?'}k` : 'n/a');
const ago = (iso) => { const d = Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 86400000); return d <= 0 ? 'today' : `${d}d ago`; };

// ---------- Interactive prompts (used by apply / post wizards) ----------
let pending = null;
function ask(question, { optional = false } = {}) {
  ps1.textContent = `${question}${optional ? ' (optional)' : ''} >`;
  ps1.className = 'c-amb';
  return new Promise((resolve, reject) => { pending = { resolve, reject, question }; });
}
function resetPrompt() { ps1.innerHTML = PS1_HTML; ps1.className = ''; pending = null; }

// ---------- Commands ----------
const COMMANDS = {
  help: { desc: 'show this help', run: () => {
    line({ t: 'Available commands:', c: 'c-wh' });
    Object.entries(COMMANDS).forEach(([k, v]) => line([{ t: '  ' + pad(k, 10), c: 'c-cy' }, { t: v.desc, c: 'c-dim' }]));
    line([{ t: 'Flags for ls: ', c: 'c-dim' }, '--remote  --level=junior|middle|senior|lead']);
    line({ t: 'Tips: ↑/↓ history · Tab autocomplete · Ctrl+C cancel · click any [id] to open it', c: 'c-dim' });
  } },
  ls: { desc: 'list jobs  (ls --remote, ls --level=senior)', run: async (args) => {
    const p = new URLSearchParams();
    if (args.includes('--remote')) p.set('remote', '1');
    const lvl = args.find((a) => a.startsWith('--level='));
    if (lvl) p.set('level', lvl.split('=')[1]);
    printJobs(await api(`/api/jobs?${p}`));
  } },
  search: { desc: 'search <term> — by title, company, stack or city', run: async (args) => {
    if (!args.length) return line({ t: 'usage: search <term>', c: 'c-err' });
    printJobs(await api(`/api/jobs?q=${encodeURIComponent(args.join(' '))}`));
  } },
  cat: { desc: 'cat <id> — show the full job description', run: async ([id]) => {
    if (!id) return line({ t: 'usage: cat <id>', c: 'c-err' });
    const j = await api(`/api/jobs/${encodeURIComponent(id)}`);
    line({ t: `┌─ #${j.id} ${'─'.repeat(50)}`, c: 'c-dim' });
    line([{ t: '│ ', c: 'c-dim' }, { t: j.title, c: 'c-wh' }, ' @ ', { t: j.company, c: 'c-amb' }]);
    line([{ t: '│ ', c: 'c-dim' }, `📍 ${j.location}${j.remote ? ' · remote ok' : ''} · ${j.level} · ${salary(j)} · posted ${ago(j.created_at)}`]);
    line([{ t: '│ ', c: 'c-dim' }, { t: 'stack: ', c: 'c-dim' }, { t: j.stack.join(' · '), c: 'c-cy' }]);
    line({ t: '│', c: 'c-dim' });
    await type(`│ ${j.description}`, 'c-ok', 4);
    line({ t: '│', c: 'c-dim' });
    line([{ t: '│ ', c: 'c-dim' }, `${j.applicants} applicant(s) so far → `, { t: `apply ${j.id}`, cmd: `apply ${j.id}` }]);
    line({ t: `└${'─'.repeat(56)}`, c: 'c-dim' });
  } },
  apply: { desc: 'apply <id> — interactive application', run: async ([id]) => {
    if (!id) return line({ t: 'usage: apply <id>', c: 'c-err' });
    const j = await api(`/api/jobs/${encodeURIComponent(id)}`);
    line([{ t: `Applying to `, c: 'c-dim' }, { t: `${j.title} @ ${j.company}`, c: 'c-wh' }, { t: ' (Ctrl+C to abort)', c: 'c-dim' }]);
    const name = await ask('name');
    const email = await ask('email');
    const github = await ask('github url', { optional: true });
    const message = await ask('why you? (one line)');
    await progress('submitting application');
    const r = await api(`/api/jobs/${j.id}/apply`, { method: 'POST', body: JSON.stringify({ name, email, github, message }) });
    line({ t: `✔ application #${r.id} sent to ${j.company}. good luck, ${name}! 🚀`, c: 'c-ok' });
    loadMini();
  } },
  post: { desc: 'post — publish a new job (interactive)', run: async () => {
    line({ t: 'Posting a new job. Ctrl+C to abort.', c: 'c-dim' });
    const body = {};
    body.title = await ask('job title');
    body.company = await ask('company');
    body.location = await ask('location');
    body.remote = await ask('remote? (y/n)');
    body.level = await ask('level [junior|middle|senior|lead]');
    body.stack = await ask('stack (comma separated)');
    body.salary_min = await ask('salary min, k€', { optional: true });
    body.salary_max = await ask('salary max, k€', { optional: true });
    body.description = await ask('description');
    body.contact_email = await ask('contact email (kept private)');
    await progress('publishing');
    const r = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    line([{ t: `✔ job #${r.id} is live → `, c: 'c-ok' }, { t: `cat ${r.id}`, cmd: `cat ${r.id}` }]);
    loadMini();
  } },
  stats: { desc: 'board statistics', run: async () => {
    const s = await api('/api/stats');
    line([{ t: 'jobs         ', c: 'c-dim' }, { t: String(s.jobs), c: 'c-wh' }]);
    line([{ t: 'remote       ', c: 'c-dim' }, { t: `${s.remote} (${Math.round((s.remote / s.jobs) * 100)}%)`, c: 'c-wh' }]);
    line([{ t: 'applications ', c: 'c-dim' }, { t: String(s.applications), c: 'c-wh' }]);
    line([{ t: 'avg salary   ', c: 'c-dim' }, { t: `€${s.avg_salary_k}k`, c: 'c-wh' }]);
    line({ t: 'top stack:', c: 'c-dim' });
    const max = s.top_stack[0]?.[1] || 1;
    s.top_stack.forEach(([t, n]) => line([{ t: '  ' + pad(t, 12), c: 'c-cy' }, { t: '█'.repeat(Math.round((n / max) * 24)), c: 'bar' }, ` ${n}`]));
  } },
  whoami: { desc: 'who are you?', run: () => line('guest — a curious developer looking for the next adventure.') },
  matrix: { desc: 'take the red pill', run: () => { matrixRain(); line({ t: 'Wake up, Neo…', c: 'c-ok' }); } },
  clear: { desc: 'clear the screen', run: () => out.replaceChildren() },
};

function printJobs(jobs) {
  if (!jobs.length) return line({ t: 'no jobs found. try `ls` or another search.', c: 'c-amb' });
  line({ t: `${pad('ID', 5)}${pad('TITLE', 32)}${pad('COMPANY', 18)}${pad('WHERE', 16)}${pad('LEVEL', 8)}SALARY`, c: 'c-dim' });
  jobs.forEach((j) => line([
    { t: `[${j.id}]`, cmd: `cat ${j.id}` }, ' '.repeat(Math.max(1, 5 - `[${j.id}]`.length)),
    { t: pad(j.title, 32), c: 'c-wh' }, { t: pad(j.company, 18), c: 'c-amb' },
    pad(`${j.remote ? '🌍 ' : ''}${j.location}`, 16), pad(j.level, 8), { t: salary(j), c: 'c-cy' },
  ]));
  line({ t: `${jobs.length} job(s). type \`cat <id>\` or click an [id].`, c: 'c-dim' });
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
  const cmd = COMMANDS[name.toLowerCase()];
  if (!cmd) return line({ t: `${name}: command not found. type \`help\`.`, c: 'c-err' });
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
    const s = document.createElement('small'); s.textContent = `${j.company} · ${j.remote ? 'remote' : j.location} · ${salary(j)}`;
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
  for (const l of ['[ OK ] mounting /dev/jobs', '[ OK ] connecting to sqlite://jobs.db', '[ OK ] loading opportunities']) { line(l, 'c-dim'); await sleep(180); }
  logo.forEach((l) => line(l, 'ascii'));
  await type('Welcome to Terminal Jobs — dev jobs for people who live in the shell.', 'c-wh', 12);
  line([{ t: 'Type ', c: 'c-dim' }, { t: 'help', cmd: 'help' }, { t: ' to begin, or ', c: 'c-dim' }, { t: 'ls', cmd: 'ls' }, { t: ' to see all open roles.', c: 'c-dim' }]);
  busy = false;
  input.focus();
  loadMini();
})();

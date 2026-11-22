const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => n.append(k));
  return n;
};
async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

const cvs = $('#game'), ctx = cvs.getContext('2d');
const N = 24, CELL = cvs.width / N;
let current = 'snake', board = 'snake', session = null, loop = null, scoreVal = 0, running = false;
let lastSaved = null;

// ---------- Tiny 8-bit sound effects with WebAudio ----------
let actx;
function beep(freq = 440, dur = 0.08, type = 'square', vol = 0.06) {
  try {
    actx ||= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(actx.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur); o.stop(actx.currentTime + dur);
  } catch {}
}

const setScore = (v) => { scoreVal = v; $('#score').textContent = v; };

// ---------- Particles ----------
let particles = [];
function burst(x, y, color) {
  for (let i = 0; i < 14; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, life: 20, color });
}
function drawParticles() {
  particles = particles.filter((p) => p.life-- > 0);
  for (const p of particles) { p.x += p.vx; p.y += p.vy; ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x / 4) * 4, Math.round(p.y / 4) * 4, 4, 4); }
}
function grid() {
  ctx.fillStyle = '#050010'; ctx.fillRect(0, 0, cvs.width, cvs.height);
  ctx.strokeStyle = 'rgba(45,226,230,.06)';
  for (let i = 0; i <= N; i++) { ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, cvs.height); ctx.moveTo(0, i * CELL); ctx.lineTo(cvs.width, i * CELL); ctx.stroke(); }
}

// ---------- Game 1: Neon Snake ----------
const Snake = {
  title: 'НЕОНОВАЯ ЗМЕЙКА', help: 'СТРЕЛКИ / WASD — ДВИЖЕНИЕ',
  start() {
    this.body = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }];
    this.dir = { x: 1, y: 0 }; this.queue = []; this.speed = 120; this.place();
    this.tick();
  },
  place() {
    do { this.food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; }
    while (this.body.some((b) => b.x === this.food.x && b.y === this.food.y));
  },
  turn(d) {
    const map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [x, y] = map[d]; const last = this.queue.at(-1) || this.dir;
    if (x !== -last.x || y !== -last.y) this.queue.push({ x, y });
  },
  tick() {
    if (!running) return;
    if (this.queue.length) this.dir = this.queue.shift();
    const head = { x: this.body[0].x + this.dir.x, y: this.body[0].y + this.dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || this.body.some((b) => b.x === head.x && b.y === head.y)) return gameOver();
    this.body.unshift(head);
    if (head.x === this.food.x && head.y === this.food.y) {
      setScore(scoreVal + 10); beep(880, 0.06); beep(1320, 0.08);
      burst((head.x + 0.5) * CELL, (head.y + 0.5) * CELL, '#f9c80e');
      this.place(); this.speed = Math.max(55, this.speed - 3);
    } else this.body.pop();
    this.draw();
    loop = setTimeout(() => this.tick(), this.speed);
  },
  draw() {
    grid();
    const pulse = 4 + Math.sin(Date.now() / 120) * 3;
    ctx.shadowBlur = 18; ctx.shadowColor = '#f9c80e'; ctx.fillStyle = '#f9c80e';
    ctx.fillRect(this.food.x * CELL + pulse / 2, this.food.y * CELL + pulse / 2, CELL - pulse, CELL - pulse);
    this.body.forEach((b, i) => {
      ctx.shadowColor = i ? '#2de2e6' : '#ff3864'; ctx.fillStyle = i ? `hsl(${180 + i * 4}, 80%, ${60 - i}%)` : '#ff3864';
      ctx.fillRect(b.x * CELL + 1, b.y * CELL + 1, CELL - 2, CELL - 2);
    });
    ctx.shadowBlur = 0; drawParticles();
  },
};

// ---------- Game 2: Reflex Blaster (click the targets before they vanish) ----------
const Reflex = {
  title: 'РЕФЛЕКС-БЛАСТЕР', help: 'КЛИКАЙ ПО МИШЕНЯМ · 30 СЕКУНД',
  start() {
    this.targets = []; this.ends = Date.now() + 30000; this.spawnAt = 0; this.misses = 0;
    const step = () => {
      if (!running) return;
      const now = Date.now();
      if (now >= this.ends) return gameOver();
      if (now > this.spawnAt) {
        this.targets.push({ x: 40 + Math.random() * (cvs.width - 80), y: 40 + Math.random() * (cvs.height - 80), born: now, ttl: 1400 - Math.min(800, scoreVal / 3) });
        this.spawnAt = now + 450;
      }
      this.targets = this.targets.filter((t) => { if (now - t.born > t.ttl) { this.misses++; beep(110, 0.1, 'sawtooth'); return false; } return true; });
      grid();
      for (const t of this.targets) {
        const k = 1 - (now - t.born) / t.ttl, r = 10 + 22 * k;
        ctx.shadowBlur = 20; ctx.shadowColor = '#ff3864';
        ctx.strokeStyle = '#ff3864'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#f9c80e'; ctx.fillRect(t.x - 4, t.y - 4, 8, 8);
      }
      ctx.shadowBlur = 0; drawParticles();
      ctx.fillStyle = '#2de2e6'; ctx.font = '14px "Press Start 2P"';
      ctx.fillText(`${Math.ceil((this.ends - now) / 1000)}с`, 16, 28);
      loop = requestAnimationFrame(step);
    };
    step();
  },
  click(x, y) {
    const now = Date.now();
    const hit = this.targets.find((t) => Math.hypot(t.x - x, t.y - y) < 10 + 22 * (1 - (now - t.born) / t.ttl) + 6);
    if (!hit) return;
    this.targets = this.targets.filter((t) => t !== hit);
    const bonus = Math.round(100 * (1 - (now - hit.born) / hit.ttl));
    setScore(scoreVal + 20 + bonus); beep(660 + bonus * 4, 0.05);
    burst(hit.x, hit.y, '#2de2e6');
  },
};
const GAMES = { snake: Snake, reflex: Reflex };

// ---------- Flow ----------
async function startGame() {
  try { session = (await api('/api/sessions', { method: 'POST', body: JSON.stringify({ game: current }) })).token; } catch { session = null; }
  $('#overlay').hidden = true; $('#initialsForm').hidden = true;
  setScore(0); running = true; particles = [];
  beep(523, 0.08); setTimeout(() => beep(784, 0.12), 90);
  cvs.focus(); GAMES[current].start();
}
function gameOver() {
  running = false; clearTimeout(loop); cancelAnimationFrame(loop);
  beep(220, 0.2, 'sawtooth'); setTimeout(() => beep(110, 0.35, 'sawtooth'), 180);
  cvs.parentElement.classList.add('shake'); setTimeout(() => cvs.parentElement.classList.remove('shake'), 300);
  if (scoreVal > 0 && session) { $('#initialsForm').hidden = false; $('#initialsForm').initials.focus(); }
  else showOverlay('ИГРА ОКОНЧЕНА', `СЧЁТ ${scoreVal}`);
}
function showOverlay(title, text) {
  $('#ovTitle').textContent = title; $('#ovText').textContent = text;
  $('#startBtn').textContent = 'ЕЩЁ РАЗ'; $('#overlay').hidden = false;
}
$('#startBtn').onclick = startGame;
$('#skipBtn').onclick = () => { $('#initialsForm').hidden = true; showOverlay('ИГРА ОКОНЧЕНА', `СЧЁТ ${scoreVal}`); };
$('#initialsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/scores', { method: 'POST', body: JSON.stringify({ token: session, score: scoreVal, initials: e.target.initials.value }) });
    lastSaved = r; e.target.reset(); $('#initialsForm').hidden = true;
    showOverlay(`МЕСТО #${r.rank}`, `${r.initials} · ${r.score} ОЧК. СОХРАНЕНО`);
    switchBoard(current); loadStats();
  } catch (err) { showOverlay('ОШИБКА', err.message.toUpperCase()); $('#initialsForm').hidden = true; }
});

function selectGame(id) {
  if (running) return;
  current = id;
  document.querySelectorAll('.pad-btn').forEach((b) => b.classList.toggle('sel', b.dataset.game === id));
  $('#gameName').textContent = GAMES[id].title;
  $('#ovTitle').textContent = GAMES[id].title; $('#ovText').textContent = GAMES[id].help; $('#startBtn').textContent = 'СТАРТ';
  $('#overlay').hidden = false; $('#initialsForm').hidden = true;
  grid(); switchBoard(id);
}
document.querySelectorAll('.pad-btn').forEach((b) => (b.onclick = () => selectGame(b.dataset.game)));

addEventListener('keydown', (e) => {
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', ц: 'up', ы: 'down', ф: 'left', в: 'right' };
  if (document.activeElement?.name === 'initials') return;
  if (map[e.key] && running && current === 'snake') { e.preventDefault(); Snake.turn(map[e.key]); }
  if ((e.key === 'Enter' || e.key === ' ') && !running && !$('#overlay').hidden) { e.preventDefault(); startGame(); }
});
document.querySelectorAll('.dpad button').forEach((b) => (b.onclick = () => running && current === 'snake' && Snake.turn(b.dataset.dir)));
cvs.addEventListener('pointerdown', (e) => {
  if (!running || current !== 'reflex') return;
  const r = cvs.getBoundingClientRect();
  Reflex.click((e.clientX - r.left) * (cvs.width / r.width), (e.clientY - r.top) * (cvs.height / r.height));
});

// ---------- Leaderboard ----------
async function switchBoard(id) {
  board = id;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.board === id));
  const rows = await api(`/api/leaderboard/${id}`);
  $('#hi').textContent = rows[0]?.score ?? 0;
  $('#leaderboard').replaceChildren(...rows.map((r, i) => {
    const li = el('li', {}, el('span', { textContent: r.initials }), el('span', { textContent: String(r.score).padStart(6, '0') }));
    li.style.animationDelay = `${i * 60}ms`;
    if (lastSaved && lastSaved.initials === r.initials && lastSaved.score === r.score && i + 1 === lastSaved.rank) li.classList.add('me');
    return li;
  }));
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => switchBoard(t.dataset.board)));

async function loadStats() {
  const s = await api('/api/stats');
  $('#stats').replaceChildren(
    el('li', {}, 'ИГР ', el('b', { textContent: s.games_played })),
    el('li', {}, 'ИГРОКОВ ', el('b', { textContent: s.players })),
    el('li', {}, 'ОЧКОВ ', el('b', { textContent: s.total_points.toLocaleString('ru-RU') })));
}

grid(); switchBoard('snake'); loadStats();

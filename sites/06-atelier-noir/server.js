// Atelier Noir — дом высокой моды: коллекции, лукбук и запись на приватный приём с уникальными слотами.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3006;
const SLOTS = ['11:00', '13:00', '15:00', '17:00'];
const SERVICES = ['Приватный показ', 'Индивидуальная примерка', 'Свадебная консультация', 'Экскурсия по архиву'];

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'atelier.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season TEXT NOT NULL,
    title TEXT NOT NULL,
    manifesto TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS looks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    name TEXT NOT NULL,
    fabric TEXT NOT NULL,
    tone TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    slot TEXT NOT NULL,
    service TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (day, slot)
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM collections').get().n === 0) {
  const c = db.prepare('INSERT INTO collections (season, title, manifesto) VALUES (?, ?, ?)');
  const l = db.prepare('INSERT INTO looks (collection_id, number, name, fabric, tone) VALUES (?, ?, ?, ?, ?)');
  const data = [
    ['ОЗ 26', 'Тишина', 'Ода недосказанному. Скульптурная шерсть, отсутствие цвета и поэзия пустого пространства.', [
      ['Пальто «Монолит»', 'Двусторонний кашемир', '#111'], ['Платье-колонна', 'Шёлковый креп', '#2a2a2a'], ['Костюм «Тень»', 'Новая шерсть', '#1b1b1b'],
      ['Кейп «Затмение»', 'Дублированный неопрен', '#050505'], ['Трикотаж «Шёпот»', 'Мохер', '#3a3a3a']]],
    ['ВЛ 26', 'Часы слоновой кости', 'Утренний свет сквозь льняные шторы. Струящееся, полупрозрачное и тихо сияющее.', [
      ['Платье-рубашка «Рассвет»', 'Стираный лён', '#e9e4da'], ['Тренч «Вуаль»', 'Шёлковая органза', '#f2efe9'], ['Костюм «Кость»', 'Хлопковый габардин', '#d8d1c4'],
      ['Комбинация «Жемчуг»', 'Креп-сатин', '#efe8dc']]],
  ];
  data.forEach(([season, title, manifesto, looks]) => {
    const id = Number(c.run(season, title, manifesto).lastInsertRowid);
    looks.forEach(([name, fabric, tone], i) => l.run(id, i + 1, name, fabric, tone));
  });
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isoDay = (d) => d.toISOString().slice(0, 10);
function upcomingDays() {
  const out = [], d = new Date();
  while (out.length < 10) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0) out.push(isoDay(d)); // closed on Sundays
  }
  return out;
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/collections', (req, res) => {
  const cols = db.prepare('SELECT * FROM collections ORDER BY id').all();
  const looks = db.prepare('SELECT * FROM looks WHERE collection_id = ? ORDER BY number');
  res.json(cols.map((c) => ({ ...c, looks: looks.all(c.id) })));
});

app.post('/api/looks/:id/like', (req, res) => {
  const r = db.prepare('UPDATE looks SET likes = likes + 1 WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return fail(res, 'Образ не найден', 404);
  res.json(db.prepare('SELECT id, likes FROM looks WHERE id = ?').get(Number(req.params.id)));
});

app.get('/api/availability', (req, res) => {
  const days = upcomingDays();
  const taken = db.prepare(`SELECT day, slot FROM appointments WHERE day IN (${days.map(() => '?').join(',')})`).all(...days);
  const set = new Set(taken.map((t) => `${t.day} ${t.slot}`));
  res.json({ services: SERVICES, days: days.map((day) => ({ day, slots: SLOTS.map((slot) => ({ slot, free: !set.has(`${day} ${slot}`) })) })) });
});

app.post('/api/appointments', (req, res) => {
  const day = text(req.body.day, 10), slot = text(req.body.slot, 5), service = text(req.body.service, 40);
  const name = text(req.body.name, 80), email = text(req.body.email, 120), note = text(req.body.note, 400);
  if (!upcomingDays().includes(day) || !SLOTS.includes(slot)) return fail(res, 'Выберите свободные дату и время.');
  if (!SERVICES.includes(service)) return fail(res, 'Выберите услугу.');
  if (name.length < 2) return fail(res, 'Укажите, пожалуйста, имя.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'Укажите, пожалуйста, корректный email.');
  try {
    const id = Number(db.prepare('INSERT INTO appointments (day, slot, service, name, email, note) VALUES (?,?,?,?,?,?)').run(day, slot, service, name, email, note).lastInsertRowid);
    res.status(201).json({ id, day, slot, service, name });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return fail(res, 'Это время только что заняли. Пожалуйста, выберите другое.', 409);
    throw e;
  }
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Произошла ошибка.', 500); });
app.listen(PORT, () => console.log(`Atelier Noir → http://localhost:${PORT}`));

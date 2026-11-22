// Orbit Voyages — агентство космического туризма: направления, старты с лимитом мест, бронирования.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3003;

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'orbit.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS destinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    distance TEXT NOT NULL,
    duration_days INTEGER NOT NULL,
    price_k INTEGER NOT NULL,
    hue INTEGER NOT NULL,
    gravity TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS launches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    launch_date TEXT NOT NULL,
    vessel TEXT NOT NULL,
    seats_total INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    launch_id INTEGER NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 6),
    cabin TEXT NOT NULL CHECK (cabin IN ('explorer','pioneer','zenith')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM destinations').get().n === 0) {
  const ins = db.prepare('INSERT INTO destinations (slug, name, tagline, description, distance, duration_days, price_k, hue, gravity) VALUES (?,?,?,?,?,?,?,?,?)');
  const launch = db.prepare('INSERT INTO launches (destination_id, launch_date, vessel, seats_total) VALUES (?,?,?,?)');
  const dests = [
    ['luna', 'Лунная база «Селена»', 'Выходные на Луне', 'Прогулка по Морю Спокойствия, ночь под восходом Земли и гольф при одной шестой гравитации.', '384 400 км', 6, 450, 220, '0,17 g'],
    ['mars', 'Станция «Олимп»', 'Восхождение на высочайший вулкан', 'Восхождение на гору Олимп с гидом и ночёвки в герметичных стеклянных куполах над долинами Маринер.', '225 млн км', 210, 2900, 15, '0,38 g'],
    ['europa', 'Глубины Европы', 'Погружение подо льдом', 'Экспедиции на подводной лодке по замёрзшему океану самого загадочного спутника Юпитера.', '628 млн км', 640, 7800, 190, '0,13 g'],
    ['saturn', 'Кольца Сатурна', 'Сёрфинг по кольцам', 'Круиз в невесомости вдоль ледяных колец со смотровой палубой, обращённой к шестиугольному шторму.', '1,2 млрд км', 900, 12500, 40, '0 g'],
    ['leo', 'Орбитальный отель «Гало»', 'Шестнадцать рассветов в день', 'Классика: низкая околоземная орбита, люксы с панорамным куполом и ресторан в невесомости.', '420 км', 3, 120, 260, '0 g'],
  ];
  const vessels = ['«Аврора»', '«Кеплер»', '«Меридиан»', '«Альциона»'];
  dests.forEach((d, i) => {
    const id = Number(ins.run(...d).lastInsertRowid);
    for (let k = 0; k < 3; k++) {
      const dt = new Date(Date.UTC(2027, 1 + i * 2 + k * 3, 5 + k * 7));
      launch.run(id, dt.toISOString().slice(0, 10), vessels[(i + k) % vessels.length], [8, 12, 6][k]);
    }
  });
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const CABIN_MULT = { explorer: 1, pioneer: 1.6, zenith: 2.5 };
const seatsLeftSql = '(l.seats_total - COALESCE((SELECT SUM(seats) FROM bookings b WHERE b.launch_id = l.id), 0))';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/destinations', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, (SELECT MIN(launch_date) FROM launches WHERE destination_id = d.id) AS next_launch,
      (SELECT SUM(${seatsLeftSql}) FROM launches l WHERE l.destination_id = d.id) AS seats_left
    FROM destinations d ORDER BY d.price_k`).all();
  res.json(rows);
});

app.get('/api/destinations/:slug', (req, res) => {
  const d = db.prepare('SELECT * FROM destinations WHERE slug = ?').get(String(req.params.slug));
  if (!d) return fail(res, 'Направление не найдено', 404);
  d.launches = db.prepare(`SELECT l.id, l.launch_date, l.vessel, l.seats_total, ${seatsLeftSql} AS seats_left FROM launches l WHERE l.destination_id = ? ORDER BY l.launch_date`).all(d.id);
  res.json(d);
});

app.post('/api/bookings', (req, res) => {
  const fullName = text(req.body.full_name, 100);
  const email = text(req.body.email, 120);
  const seats = Math.trunc(Number(req.body.seats));
  const cabin = text(req.body.cabin, 10);
  const launchId = Number(req.body.launch_id);
  if (fullName.length < 2) return fail(res, 'Укажите имя участника экипажа.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'Нужен корректный email для брифингов миссии.');
  if (!(seats >= 1 && seats <= 6)) return fail(res, 'Можно забронировать от 1 до 6 мест.');
  if (!CABIN_MULT[cabin]) return fail(res, 'Неизвестный класс каюты.');

  db.exec('BEGIN IMMEDIATE');
  try {
    const l = db.prepare(`SELECT l.*, d.price_k, d.name AS destination, ${seatsLeftSql} AS seats_left FROM launches l JOIN destinations d ON d.id = l.destination_id WHERE l.id = ?`).get(launchId);
    if (!l) { db.exec('ROLLBACK'); return fail(res, 'Старт не найден.', 404); }
    if (l.seats_left < seats) { db.exec('ROLLBACK'); return fail(res, `На этот старт осталось мест: ${l.seats_left}.`, 409); }
    const code = 'ORB-' + randomBytes(3).toString('hex').toUpperCase();
    db.prepare('INSERT INTO bookings (code, launch_id, full_name, email, seats, cabin) VALUES (?,?,?,?,?,?)').run(code, launchId, fullName, email, seats, cabin);
    db.exec('COMMIT');
    res.status(201).json({ code, full_name: fullName, destination: l.destination, launch_date: l.launch_date, vessel: l.vessel, seats, cabin, total_k: Math.round(l.price_k * CABIN_MULT[cabin] * seats) });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

app.get('/api/bookings/:code', (req, res) => {
  const b = db.prepare(`SELECT b.code, b.full_name, b.seats, b.cabin, b.created_at, l.launch_date, l.vessel, d.name AS destination, d.price_k
    FROM bookings b JOIN launches l ON l.id = b.launch_id JOIN destinations d ON d.id = l.destination_id WHERE b.code = ?`).get(text(req.params.code, 12).toUpperCase());
  if (!b) return fail(res, 'Бронирование с таким кодом не найдено.', 404);
  b.total_k = Math.round(b.price_k * CABIN_MULT[b.cabin] * b.seats);
  delete b.price_k;
  res.json(b);
});

app.delete('/api/bookings/:code', (req, res) => {
  const r = db.prepare('DELETE FROM bookings WHERE code = ? AND email = ?').run(text(req.params.code, 12).toUpperCase(), text(req.body?.email, 120));
  if (!r.changes) return fail(res, 'Бронирование не найдено или email не совпадает.', 404);
  res.status(204).end();
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Ошибка центра управления полётами.', 500); });
app.listen(PORT, () => console.log(`Orbit Voyages → http://localhost:${PORT}`));

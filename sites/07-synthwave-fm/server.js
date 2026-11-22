// Synthwave FM — ретро-интернет-радио: расписание, «сейчас в эфире», заявки песен с голосованием.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3007;

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'synthwave.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    host TEXT NOT NULL,
    start_hour INTEGER NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
    end_hour INTEGER NOT NULL CHECK (end_hour BETWEEN 1 AND 24),
    vibe TEXT NOT NULL,
    color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    dedication TEXT,
    votes INTEGER NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS request_votes (
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    visitor TEXT NOT NULL,
    PRIMARY KEY (request_id, visitor)
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM shows').get().n === 0) {
  const s = db.prepare('INSERT INTO shows (title, host, start_hour, end_hour, vibe, color) VALUES (?,?,?,?,?,?)');
  [
    ['Полуночный драйв', 'DJ Вектор', 0, 4, 'Дарксинт · аутран · пустые трассы', '#ff2a6d'],
    ['Неоновый рассвет', 'Луна Лазер', 4, 8, 'Дримвейв · чиллсинт · первый кофе', '#05d9e8'],
    ['Хромовая дорога', 'Макс Овердрайв', 8, 12, 'Бодрый ретровейв для часа пик', '#f9c80e'],
    ['Аркадный обед', 'Пиксель Петя', 12, 16, 'Чиптюн · саундтреки игр · бипы', '#7b2cbf'],
    ['Бульвар заката', 'Вера Вельвет', 16, 20, 'Синтипоп · итало-диско · золотой час', '#ff7b00'],
    ['Лазерная сетка', 'Аналоговые близнецы', 20, 24, 'Киберпанк · тяжёлые синты · живые сеты', '#d1f7ff'],
  ].forEach((r) => s.run(...r));
  const r = db.prepare('INSERT INTO requests (artist, title, requested_by, dedication, votes) VALUES (?,?,?,?,?)');
  r.run('The Midnight', 'Sunset', 'neonkid', 'Всем, кто сегодня ночью едет домой', 14);
  r.run('FM-84', 'Running in the Night', 'outrun_olly', null, 11);
  r.run('Timecop1983', 'On the Run', 'vhs_vera', 'Моей коллекции VHS-кассет', 8);
  r.run('Gunship', 'Tech Noir', 'cyberkat', null, 6);
  r.run('Kavinsky', 'Nightcall', 'drive_fan', 'Настоящему герою', 5);
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const visitorId = (req) => { const v = text(req.get('X-Visitor'), 64); return /^[a-z0-9-]{8,64}$/i.test(v) ? v : null; };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/schedule', (req, res) => {
  const hour = new Date().getHours();
  const shows = db.prepare('SELECT * FROM shows ORDER BY start_hour').all();
  res.json({ hour, shows: shows.map((s) => ({ ...s, live: hour >= s.start_hour && hour < s.end_hour })) });
});

app.get('/api/now', (req, res) => {
  const hour = new Date().getHours();
  const show = db.prepare('SELECT * FROM shows WHERE ? >= start_hour AND ? < end_hour').get(hour, hour);
  const track = db.prepare('SELECT id, artist, title, requested_by, dedication FROM requests WHERE played = 0 ORDER BY votes DESC, id LIMIT 1').get() || null;
  const listeners = 1200 + Math.round(Math.sin(Date.now() / 600000) * 300 + Math.random() * 40);
  res.json({ show, track, listeners });
});

app.get('/api/requests', (req, res) => {
  const v = visitorId(req) || '';
  res.json(db.prepare(`SELECT r.id, r.artist, r.title, r.requested_by, r.dedication, r.votes, r.created_at,
      EXISTS(SELECT 1 FROM request_votes WHERE request_id = r.id AND visitor = ?) AS voted
    FROM requests r WHERE r.played = 0 ORDER BY r.votes DESC, r.id LIMIT 25`).all(v).map((r) => ({ ...r, voted: Boolean(r.voted) })));
});

app.post('/api/requests', (req, res) => {
  const artist = text(req.body.artist, 80), title = text(req.body.title, 100);
  const by = text(req.body.requested_by, 30) || 'аноним', dedication = text(req.body.dedication, 140) || null;
  if (!artist || !title) return fail(res, 'Укажите исполнителя и название трека.');
  const dup = db.prepare('SELECT id FROM requests WHERE played = 0 AND artist = ? COLLATE NOCASE AND title = ? COLLATE NOCASE').get(artist, title);
  if (dup) return fail(res, 'Этот трек уже в очереди — лучше проголосуйте за него!', 409);
  const id = Number(db.prepare('INSERT INTO requests (artist, title, requested_by, dedication, votes) VALUES (?,?,?,?,1)').run(artist, title, by, dedication).lastInsertRowid);
  const v = visitorId(req);
  if (v) db.prepare('INSERT OR IGNORE INTO request_votes (request_id, visitor) VALUES (?, ?)').run(id, v);
  res.status(201).json({ id });
});

app.post('/api/requests/:id/vote', (req, res) => {
  const v = visitorId(req);
  if (!v) return fail(res, 'Не передан идентификатор слушателя.');
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM requests WHERE id = ?').get(id)) return fail(res, 'Заявка не найдена', 404);
  db.exec('BEGIN');
  try {
    const had = db.prepare('SELECT 1 FROM request_votes WHERE request_id = ? AND visitor = ?').get(id, v);
    if (had) {
      db.prepare('DELETE FROM request_votes WHERE request_id = ? AND visitor = ?').run(id, v);
      db.prepare('UPDATE requests SET votes = votes - 1 WHERE id = ?').run(id);
    } else {
      db.prepare('INSERT INTO request_votes (request_id, visitor) VALUES (?, ?)').run(id, v);
      db.prepare('UPDATE requests SET votes = votes + 1 WHERE id = ?').run(id);
    }
    db.exec('COMMIT');
    res.json({ id, voted: !had, votes: db.prepare('SELECT votes FROM requests WHERE id = ?').get(id).votes });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

// "DJ booth": marks the top request as played, as a DJ would after spinning it.
app.post('/api/requests/next', (req, res) => {
  const top = db.prepare('SELECT id FROM requests WHERE played = 0 ORDER BY votes DESC, id LIMIT 1').get();
  if (!top) return fail(res, 'Очередь пуста', 404);
  db.prepare('UPDATE requests SET played = 1 WHERE id = ?').run(top.id);
  res.json({ played: top.id });
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Сигнал потерян. Попробуйте ещё раз.', 500); });
app.listen(PORT, () => console.log(`Synthwave FM → http://localhost:${PORT}`));

// Verdant — студия растений: каталог с фильтрами, квиз-подбор, избранное и рассылка.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3004;

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'verdant.db'));

// SQLite's built-in LIKE is case-insensitive only for ASCII. Override it so that
// search also ignores case for Cyrillic ("суп" finds "Суп").
const likeRe = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '[\\s\\S]') + '$', 'iu');
db.function('like', { deterministic: true }, (p, v) => (p == null || v == null ? null : likeRe(String(p)).test(String(v)) ? 1 : 0));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS plants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    latin TEXT NOT NULL,
    emoji TEXT NOT NULL,
    light TEXT NOT NULL CHECK (light IN ('low','medium','bright')),
    water TEXT NOT NULL CHECK (water IN ('rarely','weekly','often')),
    difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
    pet_safe INTEGER NOT NULL,
    size TEXT NOT NULL CHECK (size IN ('small','medium','large')),
    price_cents INTEGER NOT NULL,
    stock INTEGER NOT NULL,
    description TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wishlist (
    visitor TEXT NOT NULL,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (visitor, plant_id)
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM plants').get().n === 0) {
  const ins = db.prepare('INSERT INTO plants (name, latin, emoji, light, water, difficulty, pet_safe, size, price_cents, stock, description) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  [
    ['Сансевиерия', 'Dracaena trifasciata', '🪴', 'low', 'rarely', 1, 0, 'medium', 249000, 14, 'Практически неубиваемая. Прекрасно переносит забывчивость и очищает воздух, пока вы спите.'],
    ['Замиокулькас', 'Zamioculcas zamiifolia', '🌿', 'low', 'rarely', 1, 0, 'medium', 279000, 9, 'Глянцевые архитектурные листья, которые прощают пропущенные поливы неделями.'],
    ['Калатея Орбифолия', 'Goeppertia orbifolia', '🍃', 'medium', 'often', 3, 1, 'medium', 359000, 5, 'Листья с серебристыми полосами, которые на ночь складываются, будто ладони в молитве.'],
    ['Монстера деликатесная', 'Monstera deliciosa', '🌱', 'bright', 'weekly', 2, 0, 'large', 490000, 7, 'Знаменитый гигант с резными листьями. Дайте ей опору — и она полезет вверх.'],
    ['Нефролепис', 'Nephrolepis exaltata', '🌾', 'medium', 'often', 2, 1, 'medium', 219000, 11, 'Пушистые вайи, которые обожают влажные ванные комнаты и туманные утра.'],
    ['Хамедорея', 'Chamaedorea elegans', '🌴', 'low', 'weekly', 1, 1, 'large', 389000, 6, 'Мягкая викторианская классика, безопасная для любопытных кошек и собак.'],
    ['Фикус лировидный', 'Ficus lyrata', '🌳', 'bright', 'weekly', 3, 0, 'large', 690000, 3, 'Эффектные листья в форме скрипки. Капризная дива — но она того стоит.'],
    ['Пеперомия Хоуп', 'Peperomia tetraphylla', '☘️', 'medium', 'rarely', 1, 1, 'small', 149000, 20, 'Ампельные листья-монетки — идеально для полок и маленьких квартир.'],
    ['Крестовник Роули', 'Curio rowleyanus', '🫛', 'bright', 'rarely', 2, 0, 'small', 179000, 8, 'Каскадное суккулентное «ожерелье» для солнечного подоконника.'],
    ['Эпипремнум Марбл Квин', 'Epipremnum aureum', '🍀', 'low', 'weekly', 1, 0, 'small', 159000, 16, 'Лианы с кремовым мрамором: быстро растут и укореняются в стакане воды.'],
    ['Стрелиция Николая', 'Strelitzia nicolai', '🦜', 'bright', 'weekly', 2, 0, 'large', 790000, 4, 'Тропические листья-вёсла, которые превращают гостиную в курорт.'],
    ['Хлорофитум', 'Chlorophytum comosum', '🕸️', 'medium', 'weekly', 1, 1, 'small', 119000, 18, 'Жизнерадостные дугообразные листья и детки, которыми можно делиться с друзьями.'],
  ].forEach((p) => ins.run(...p));
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const visitorId = (req) => { const v = text(req.get('X-Visitor'), 64); return /^[a-z0-9-]{8,64}$/i.test(v) ? v : null; };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/plants', (req, res) => {
  const where = [], args = [];
  for (const key of ['light', 'water', 'size']) {
    if (req.query[key]) { where.push(`${key} = ?`); args.push(String(req.query[key])); }
  }
  if (req.query.pet_safe === '1') where.push('pet_safe = 1');
  if (req.query.easy === '1') where.push('difficulty = 1');
  const q = text(req.query.q, 60);
  if (q) { where.push('(name LIKE ? OR latin LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const sorts = { price_asc: 'price_cents ASC', price_desc: 'price_cents DESC', name: 'name ASC', easy: 'difficulty ASC, name' };
  const order = sorts[req.query.sort] || 'name ASC';
  const sql = `SELECT * FROM plants ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  res.json(db.prepare(sql).all(...args));
});

// Plant match: scores every plant against the quiz answers and returns the top 3.
app.post('/api/match', (req, res) => {
  const { light, water, pets, experience } = req.body || {};
  const plants = db.prepare('SELECT * FROM plants WHERE stock > 0').all();
  const waterRank = { rarely: 0, weekly: 1, often: 2 };
  const scored = plants.map((p) => {
    let score = 0;
    if (p.light === light) score += 3;
    else if (light === 'medium' && p.light !== 'bright') score += 1;
    score += 2 - Math.abs((waterRank[p.water] ?? 1) - (waterRank[water] ?? 1));
    if (pets === 'yes' && !p.pet_safe) score -= 10;
    const exp = Number(experience) || 1;
    score += p.difficulty <= exp ? 2 : -2 * (p.difficulty - exp);
    return { ...p, score };
  });
  scored.sort((a, b) => b.score - a.score || a.difficulty - b.difficulty);
  res.json(scored.slice(0, 3));
});

app.get('/api/wishlist', (req, res) => {
  const v = visitorId(req);
  if (!v) return res.json([]);
  res.json(db.prepare('SELECT p.* FROM wishlist w JOIN plants p ON p.id = w.plant_id WHERE w.visitor = ? ORDER BY w.added_at DESC').all(v));
});

app.post('/api/wishlist/:plantId', (req, res) => {
  const v = visitorId(req);
  if (!v) return fail(res, 'Не передан идентификатор посетителя.');
  const id = Number(req.params.plantId);
  if (!db.prepare('SELECT 1 FROM plants WHERE id = ?').get(id)) return fail(res, 'Растение не найдено', 404);
  const existing = db.prepare('SELECT 1 FROM wishlist WHERE visitor = ? AND plant_id = ?').get(v, id);
  if (existing) db.prepare('DELETE FROM wishlist WHERE visitor = ? AND plant_id = ?').run(v, id);
  else db.prepare('INSERT INTO wishlist (visitor, plant_id) VALUES (?, ?)').run(v, id);
  res.json({ plant_id: id, saved: !existing });
});

app.post('/api/subscribe', (req, res) => {
  const email = text(req.body.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 'Этот email выглядит немного увядшим. Проверьте его.');
  const r = db.prepare('INSERT INTO subscribers (email) VALUES (?) ON CONFLICT(email) DO NOTHING').run(email);
  const count = db.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n;
  res.status(r.changes ? 201 : 200).json({ subscribed: true, already: !r.changes, community: count });
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Нашему серверу не хватает солнца. Попробуйте ещё раз.', 500); });
app.listen(PORT, () => console.log(`Verdant Plant Studio → http://localhost:${PORT}`));

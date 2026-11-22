// Paper Kitchen — рукописная книга рецептов: ингредиенты и шаги, оценки, комментарии, рецепты от пользователей.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3009;
const TAGS = ['завтрак', 'ужин', 'десерт', 'вегетарианское', 'быстро', 'выпечка', 'суп'];

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'kitchen.db'));

// SQLite's built-in LIKE is case-insensitive only for ASCII. Override it so that
// search also ignores case for Cyrillic ("суп" finds "Суп").
const likeRe = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '[\\s\\S]') + '$', 'iu');
db.function('like', { deterministic: true }, (p, v) => (p == null || v == null ? null : likeRe(String(p)).test(String(v)) ? 1 : 0));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🍲',
    summary TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
    servings INTEGER NOT NULL CHECK (servings BETWEEN 1 AND 24),
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    qty REAL,
    unit TEXT NOT NULL DEFAULT '',
    item TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function insertRecipe(r) {
  db.exec('BEGIN');
  try {
    const id = Number(db.prepare('INSERT INTO recipes (title, author, emoji, summary, minutes, servings, tag) VALUES (?,?,?,?,?,?,?)')
      .run(r.title, r.author, r.emoji, r.summary, r.minutes, r.servings, r.tag).lastInsertRowid);
    const ing = db.prepare('INSERT INTO ingredients (recipe_id, qty, unit, item, position) VALUES (?,?,?,?,?)');
    r.ingredients.forEach(([qty, unit, item], i) => ing.run(id, qty, unit, item, i));
    const st = db.prepare('INSERT INTO steps (recipe_id, position, body) VALUES (?,?,?)');
    r.steps.forEach((s, i) => st.run(id, i, s));
    db.exec('COMMIT');
    return id;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

if (db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n === 0) {
  const seed = [
    { title: 'Бабушкины панкейки с рикоттой и лимоном', author: 'Бабушка Роза', emoji: '🥞', summary: 'Воздушные, как облако, панкейки с лимонной цедрой — классика воскресного утра.', minutes: 25, servings: 4, tag: 'завтрак',
      ingredients: [[250, 'г', 'рикотта'], [3, 'шт', 'яйца (желтки отдельно)'], [120, 'г', 'мука'], [1, 'ст. л.', 'сахар'], [1, 'шт', 'лимон, цедра'], [180, 'мл', 'молоко'], [1, 'ч. л.', 'разрыхлитель']],
      steps: ['Взбейте рикотту, желтки, молоко, сахар и цедру.', 'Вмешайте муку и разрыхлитель.', 'Взбейте белки до мягких пиков и аккуратно вмешайте в тесто.', 'Жарьте небольшими порциями на смазанной маслом сковороде по 2 минуты с каждой стороны.', 'Подавайте с мёдом и ягодами.'], stars: [5, 5, 4, 5] },
    { title: 'Полуночный рамен с мисо', author: 'Кэндзи Т.', emoji: '🍜', summary: 'Глубокий, насыщенный бульон, который готовится быстрее доставки.', minutes: 35, servings: 2, tag: 'ужин',
      ingredients: [[2, 'ст. л.', 'светлая паста мисо'], [1, 'л', 'куриный или овощной бульон'], [2, 'шт', 'гнезда лапши рамен'], [2, 'шт', 'яйца всмятку'], [1, 'ст. л.', 'масло чили'], [2, 'шт', 'зелёный лук'], [100, 'г', 'шпинат']],
      steps: ['Доведите бульон до лёгкого кипения.', 'Разведите мисо половником бульона и верните в кастрюлю.', 'Отдельно отварите лапшу 3 минуты.', 'Опустите шпинат в бульон, чтобы он слегка увял.', 'Соберите миски: сверху половинки яиц, лук и масло чили.'], stars: [5, 4, 5] },
    { title: 'Печенье с шоколадом на топлёном масле', author: 'Мия Б.', emoji: '🍪', summary: 'Хрустящие края, тягучая серединка и ореховый вкус топлёного масла в каждом кусочке.', minutes: 45, servings: 12, tag: 'выпечка',
      ingredients: [[170, 'г', 'сливочное масло'], [200, 'г', 'коричневый сахар'], [50, 'г', 'белый сахар'], [1, 'шт', 'яйцо + 1 желток'], [250, 'г', 'мука'], [0.5, 'ч. л.', 'сода'], [200, 'г', 'тёмный шоколад, рубленый'], [null, '', 'хлопья морской соли']],
      steps: ['Растопите масло до орехового аромата и остудите 10 минут.', 'Вмешайте оба сахара, затем яйцо и желток.', 'Добавьте муку и соду, затем шоколад.', 'Уберите тесто в холодильник на 30 минут.', 'Выпекайте при 180 °C 11 минут, посыпьте солью.'], stars: [5, 5, 5, 4, 5] },
    { title: 'Суп из запечённых томатов', author: 'Элла В.', emoji: '🍅', summary: 'Сладкий, дымный и шелковистый — идеален с горячим сэндвичем с сыром.', minutes: 50, servings: 4, tag: 'суп',
      ingredients: [[1, 'кг', 'спелые томаты'], [1, 'шт', 'красный лук'], [4, 'зуб.', 'чеснок'], [3, 'ст. л.', 'оливковое масло'], [500, 'мл', 'овощной бульон'], [1, 'пучок', 'базилик']],
      steps: ['Разрежьте томаты и лук пополам, запекайте с чесноком и маслом при 200 °C 35 минут.', 'Переложите всё в кастрюлю и добавьте бульон.', 'Пробейте блендером вместе с базиликом до гладкости.', 'Посолите и добавьте немного сливок.'], stars: [4, 4, 5] },
    { title: 'Лапша с чесночным маслом за 10 минут', author: 'Саша К.', emoji: '🧄', summary: 'Продукты из шкафа, максимум уюта, ноль усилий.', minutes: 10, servings: 2, tag: 'быстро',
      ingredients: [[200, 'г', 'спагетти'], [40, 'г', 'сливочное масло'], [4, 'зуб.', 'чеснок, слайсами'], [30, 'г', 'пармезан'], [null, '', 'чёрный перец'], [1, 'щепотка', 'хлопья чили']],
      steps: ['Отварите пасту в подсоленной воде.', 'На слабом огне обжарьте чеснок в масле до золотистого цвета.', 'Перемешайте пасту с чесночным маслом и ложкой воды от варки.', 'Добавьте пармезан, перец и чили.'], stars: [4, 5] },
    { title: 'Баскский чизкейк', author: 'Лусия Г.', emoji: '🍰', summary: 'Без основы, с карамельной корочкой и невероятно кремовый внутри.', minutes: 70, servings: 8, tag: 'десерт',
      ingredients: [[900, 'г', 'сливочный сыр'], [300, 'г', 'сахар'], [5, 'шт', 'яйца'], [480, 'мл', 'сливки 33%'], [30, 'г', 'мука'], [1, 'ч. л.', 'ваниль']],
      steps: ['Выстелите форму смятой пергаментной бумагой.', 'Взбейте сливочный сыр с сахаром до гладкости.', 'По одному добавьте яйца, затем сливки и ваниль.', 'Просейте муку и коротко перемешайте.', 'Выпекайте при 220 °C 55 минут до тёмной корочки; полностью остудите.'], stars: [5, 5, 5] },
  ];
  const rate = db.prepare('INSERT INTO ratings (recipe_id, stars) VALUES (?, ?)');
  const com = db.prepare('INSERT INTO comments (recipe_id, author, body) VALUES (?, ?, ?)');
  seed.forEach((r, i) => {
    const id = insertRecipe(r);
    r.stars.forEach((s) => rate.run(id, s));
    if (i === 0) com.run(id, 'Аня', 'Приготовила детям — исчезли за пять минут!');
    if (i === 2) { com.run(id, 'Лёва', 'Топлёное масло меняет всё.'); com.run(id, 'Полина', 'Держала тесто в холодильнике всю ночь — ещё вкуснее.'); }
  });
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const LIST_SQL = `SELECT r.*, ROUND(AVG(rt.stars), 1) AS rating, COUNT(rt.id) AS rating_count,
  (SELECT COUNT(*) FROM comments c WHERE c.recipe_id = r.id) AS comment_count
  FROM recipes r LEFT JOIN ratings rt ON rt.recipe_id = r.id`;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '30kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tags', (req, res) => res.json(TAGS));

app.get('/api/recipes', (req, res) => {
  const where = [], args = [];
  const q = text(req.query.q, 60), tag = text(req.query.tag, 20);
  if (q) { where.push('(r.title LIKE ? OR r.summary LIKE ? OR r.id IN (SELECT recipe_id FROM ingredients WHERE item LIKE ?))'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (tag) { where.push('r.tag = ?'); args.push(tag); }
  const order = req.query.sort === 'top' ? 'rating DESC NULLS LAST, rating_count DESC' : req.query.sort === 'quick' ? 'r.minutes ASC' : 'r.id DESC';
  res.json(db.prepare(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY r.id ORDER BY ${order}`).all(...args));
});

app.get('/api/recipes/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare(`${LIST_SQL} WHERE r.id = ? GROUP BY r.id`).get(id);
  if (!r) return fail(res, 'Рецепт не найден', 404);
  r.ingredients = db.prepare('SELECT qty, unit, item FROM ingredients WHERE recipe_id = ? ORDER BY position').all(id);
  r.steps = db.prepare('SELECT body FROM steps WHERE recipe_id = ? ORDER BY position').all(id).map((s) => s.body);
  r.comments = db.prepare('SELECT author, body, created_at FROM comments WHERE recipe_id = ? ORDER BY id DESC').all(id);
  res.json(r);
});

app.post('/api/recipes', (req, res) => {
  const b = req.body || {};
  const r = {
    title: text(b.title, 100), author: text(b.author, 50) || 'Анонимный повар', emoji: text(b.emoji, 8) || '🍲',
    summary: text(b.summary, 200), minutes: Math.trunc(Number(b.minutes)), servings: Math.trunc(Number(b.servings)), tag: text(b.tag, 20),
    ingredients: (Array.isArray(b.ingredients) ? b.ingredients : []).slice(0, 30)
      .map((i) => [i.qty === '' || i.qty == null || Number.isNaN(Number(i.qty)) ? null : Number(i.qty), text(i.unit, 12), text(i.item, 80)]).filter((i) => i[2]),
    steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 25).map((s) => text(s, 500)).filter(Boolean),
  };
  if (r.title.length < 3) return fail(res, 'Дайте рецепту название.');
  if (!r.summary) return fail(res, 'Добавьте короткое описание.');
  if (!(r.minutes >= 1 && r.minutes <= 1440) || !(r.servings >= 1 && r.servings <= 24)) return fail(res, 'Проверьте время и количество порций.');
  if (!TAGS.includes(r.tag)) return fail(res, 'Выберите категорию.');
  if (!r.ingredients.length || !r.steps.length) return fail(res, 'Добавьте хотя бы один ингредиент и один шаг.');
  res.status(201).json({ id: insertRecipe(r) });
});

app.post('/api/recipes/:id/rate', (req, res) => {
  const id = Number(req.params.id), stars = Math.trunc(Number(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) return fail(res, 'Оценка должна быть от 1 до 5.');
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) return fail(res, 'Рецепт не найден', 404);
  db.prepare('INSERT INTO ratings (recipe_id, stars) VALUES (?, ?)').run(id, stars);
  res.status(201).json(db.prepare('SELECT ROUND(AVG(stars), 1) AS rating, COUNT(*) AS rating_count FROM ratings WHERE recipe_id = ?').get(id));
});

app.post('/api/recipes/:id/comments', (req, res) => {
  const id = Number(req.params.id), author = text(req.body.author, 50) || 'Аноним', body = text(req.body.body, 600);
  if (body.length < 2) return fail(res, 'Напишите хоть пару слов.');
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) return fail(res, 'Рецепт не найден', 404);
  db.prepare('INSERT INTO comments (recipe_id, author, body) VALUES (?, ?, ?)').run(id, author, body);
  res.status(201).json({ ok: true });
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'На кухне что-то подгорело.', 500); });
app.listen(PORT, () => console.log(`Paper Kitchen → http://localhost:${PORT}`));

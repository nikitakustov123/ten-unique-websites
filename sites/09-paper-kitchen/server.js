// Paper Kitchen — handwritten-style recipe book: recipes with ingredients & steps, ratings, comments, user submissions.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3009;
const TAGS = ['breakfast', 'dinner', 'dessert', 'vegetarian', 'quick', 'baking', 'soup'];

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'kitchen.db'));
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
    { title: "Grandma's Lemon Ricotta Pancakes", author: 'Nonna Rosa', emoji: '🥞', summary: 'Cloud-soft pancakes with lemon zest — the Sunday morning classic.', minutes: 25, servings: 4, tag: 'breakfast',
      ingredients: [[250, 'g', 'ricotta'], [3, '', 'eggs, separated'], [120, 'g', 'flour'], [1, 'tbsp', 'sugar'], [1, '', 'lemon, zested'], [180, 'ml', 'milk'], [1, 'tsp', 'baking powder']],
      steps: ['Whisk ricotta, yolks, milk, sugar and lemon zest.', 'Fold in flour and baking powder.', 'Beat egg whites to soft peaks and fold gently into the batter.', 'Cook small ladlefuls in a buttered pan, 2 minutes per side.', 'Serve with honey and berries.'], stars: [5, 5, 4, 5] },
    { title: 'Midnight Miso Ramen', author: 'Kenji T.', emoji: '🍜', summary: 'A deeply savoury bowl that comes together faster than delivery.', minutes: 35, servings: 2, tag: 'dinner',
      ingredients: [[2, 'tbsp', 'white miso'], [1, 'l', 'chicken or veg stock'], [2, '', 'ramen nests'], [2, '', 'soft-boiled eggs'], [1, 'tbsp', 'chili oil'], [2, '', 'spring onions'], [100, 'g', 'spinach']],
      steps: ['Bring stock to a gentle simmer.', 'Whisk miso with a ladle of stock, then return to the pot.', 'Cook noodles separately for 3 minutes.', 'Wilt spinach in the broth.', 'Assemble bowls; top with halved eggs, onions and chili oil.'], stars: [5, 4, 5] },
    { title: 'Brown Butter Chocolate Chip Cookies', author: 'Mia B.', emoji: '🍪', summary: 'Crispy edges, chewy centres and nutty brown butter in every bite.', minutes: 45, servings: 12, tag: 'baking',
      ingredients: [[170, 'g', 'butter'], [200, 'g', 'brown sugar'], [50, 'g', 'white sugar'], [1, '', 'egg + 1 yolk'], [250, 'g', 'flour'], [0.5, 'tsp', 'baking soda'], [200, 'g', 'dark chocolate, chopped'], [null, '', 'flaky salt']],
      steps: ['Brown the butter until it smells like hazelnuts; cool 10 minutes.', 'Whisk in both sugars, then the egg and yolk.', 'Stir in flour and baking soda, then the chocolate.', 'Chill dough for 30 minutes.', 'Bake at 180°C for 11 minutes; sprinkle with flaky salt.'], stars: [5, 5, 5, 4, 5] },
    { title: 'Roasted Tomato Soup', author: 'Ellie W.', emoji: '🍅', summary: 'Sweet, smoky and silky — best with a grilled cheese on the side.', minutes: 50, servings: 4, tag: 'soup',
      ingredients: [[1, 'kg', 'ripe tomatoes'], [1, '', 'red onion'], [4, '', 'garlic cloves'], [3, 'tbsp', 'olive oil'], [500, 'ml', 'vegetable stock'], [1, 'handful', 'basil']],
      steps: ['Halve tomatoes and onion; roast with garlic and oil at 200°C for 35 minutes.', 'Tip everything into a pot with the stock.', 'Blend until smooth with the basil.', 'Season and finish with a swirl of cream.'], stars: [4, 4, 5] },
    { title: '10-Minute Garlic Butter Noodles', author: 'Sam K.', emoji: '🧄', summary: 'Pantry staples, maximum comfort, zero effort.', minutes: 10, servings: 2, tag: 'quick',
      ingredients: [[200, 'g', 'spaghetti'], [40, 'g', 'butter'], [4, '', 'garlic cloves, sliced'], [30, 'g', 'parmesan'], [null, '', 'black pepper'], [1, 'pinch', 'chili flakes']],
      steps: ['Boil pasta in salted water.', 'Gently sizzle garlic in butter until golden.', 'Toss pasta with garlic butter and a splash of pasta water.', 'Finish with parmesan, pepper and chili.'], stars: [4, 5] },
    { title: 'Burnt Basque Cheesecake', author: 'Lucía G.', emoji: '🍰', summary: 'Crustless, caramelised on top and impossibly creamy inside.', minutes: 70, servings: 8, tag: 'dessert',
      ingredients: [[900, 'g', 'cream cheese'], [300, 'g', 'sugar'], [5, '', 'eggs'], [480, 'ml', 'heavy cream'], [30, 'g', 'flour'], [1, 'tsp', 'vanilla']],
      steps: ['Line a tin with crumpled baking paper.', 'Beat cream cheese and sugar until smooth.', 'Add eggs one at a time, then cream and vanilla.', 'Sift in flour and mix briefly.', 'Bake at 220°C for 55 minutes until deeply browned; cool completely.'], stars: [5, 5, 5] },
  ];
  const rate = db.prepare('INSERT INTO ratings (recipe_id, stars) VALUES (?, ?)');
  const com = db.prepare('INSERT INTO comments (recipe_id, author, body) VALUES (?, ?, ?)');
  seed.forEach((r, i) => {
    const id = insertRecipe(r);
    r.stars.forEach((s) => rate.run(id, s));
    if (i === 0) com.run(id, 'Hannah', 'Made these for my kids — gone in five minutes!');
    if (i === 2) { com.run(id, 'Leo', 'The brown butter is a game changer.'); com.run(id, 'Priya', 'Chilled overnight, even better.'); }
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
  if (!r) return fail(res, 'Recipe not found', 404);
  r.ingredients = db.prepare('SELECT qty, unit, item FROM ingredients WHERE recipe_id = ? ORDER BY position').all(id);
  r.steps = db.prepare('SELECT body FROM steps WHERE recipe_id = ? ORDER BY position').all(id).map((s) => s.body);
  r.comments = db.prepare('SELECT author, body, created_at FROM comments WHERE recipe_id = ? ORDER BY id DESC').all(id);
  res.json(r);
});

app.post('/api/recipes', (req, res) => {
  const b = req.body || {};
  const r = {
    title: text(b.title, 100), author: text(b.author, 50) || 'Anonymous cook', emoji: text(b.emoji, 8) || '🍲',
    summary: text(b.summary, 200), minutes: Math.trunc(Number(b.minutes)), servings: Math.trunc(Number(b.servings)), tag: text(b.tag, 20),
    ingredients: (Array.isArray(b.ingredients) ? b.ingredients : []).slice(0, 30)
      .map((i) => [i.qty === '' || i.qty == null || Number.isNaN(Number(i.qty)) ? null : Number(i.qty), text(i.unit, 12), text(i.item, 80)]).filter((i) => i[2]),
    steps: (Array.isArray(b.steps) ? b.steps : []).slice(0, 25).map((s) => text(s, 500)).filter(Boolean),
  };
  if (r.title.length < 3) return fail(res, 'Give your recipe a name.');
  if (!r.summary) return fail(res, 'Add a short description.');
  if (!(r.minutes >= 1 && r.minutes <= 1440) || !(r.servings >= 1 && r.servings <= 24)) return fail(res, 'Check the time and servings.');
  if (!TAGS.includes(r.tag)) return fail(res, 'Pick a category.');
  if (!r.ingredients.length || !r.steps.length) return fail(res, 'Add at least one ingredient and one step.');
  res.status(201).json({ id: insertRecipe(r) });
});

app.post('/api/recipes/:id/rate', (req, res) => {
  const id = Number(req.params.id), stars = Math.trunc(Number(req.body.stars));
  if (!(stars >= 1 && stars <= 5)) return fail(res, 'Stars must be 1–5.');
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) return fail(res, 'Recipe not found', 404);
  db.prepare('INSERT INTO ratings (recipe_id, stars) VALUES (?, ?)').run(id, stars);
  res.status(201).json(db.prepare('SELECT ROUND(AVG(stars), 1) AS rating, COUNT(*) AS rating_count FROM ratings WHERE recipe_id = ?').get(id));
});

app.post('/api/recipes/:id/comments', (req, res) => {
  const id = Number(req.params.id), author = text(req.body.author, 50) || 'Anonymous', body = text(req.body.body, 600);
  if (body.length < 2) return fail(res, 'Write a little something.');
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) return fail(res, 'Recipe not found', 404);
  db.prepare('INSERT INTO comments (recipe_id, author, body) VALUES (?, ?, ?)').run(id, author, body);
  res.status(201).json({ ok: true });
});

app.use('/api', (req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Something burned in the kitchen.', 500); });
app.listen(PORT, () => console.log(`Paper Kitchen → http://localhost:${PORT}`));

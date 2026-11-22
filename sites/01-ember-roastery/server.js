// Ember & Oak — кофейня-обжарщик: меню, онлайн-заказы навынос и отзывы.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

// ---------- Database ----------
mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'roastery.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('espresso','filter','beans','bakery')),
    origin TEXT,
    notes TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    roast INTEGER NOT NULL DEFAULT 3 CHECK (roast BETWEEN 1 AND 5)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer TEXT NOT NULL,
    email TEXT NOT NULL,
    pickup_time TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'brewing',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 20),
    price_cents INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
  const ins = db.prepare(
    'INSERT INTO products (name, category, origin, notes, price_cents, roast) VALUES (?, ?, ?, ?, ?, ?)',
  );
  [
    ['Эспрессо «Уголёк»', 'espresso', 'Бразилия · Колумбия', 'Тёмный шоколад, патока, жареный фундук', 18000, 4],
    ['Бархатный флэт уайт', 'espresso', 'Фирменный бленд', 'Шелковистое молоко, карамель, какао-крупка', 29000, 4],
    ['Кортадо «Нуар»', 'espresso', 'Гватемала', 'Тростниковый сахар, слива, кедр', 26000, 3],
    ['Латте с копчёным кленом', 'espresso', 'Фирменный бленд', 'Кленовый сироп, дубовый дымок, сливки', 34000, 4],
    ['Эфиопия Гуджи, V60', 'filter', 'Гуджи, Эфиопия', 'Жасмин, бергамот, персик', 36000, 2],
    ['Кения AA, кемекс', 'filter', 'Ньери, Кения', 'Чёрная смородина, грейпфрут, томатный лист', 39000, 2],
    ['Колд брю 18 часов', 'filter', 'Перу', 'Какао, красное яблоко, долгое сладкое послевкусие', 31000, 3],
    ['Зерно «Дубовая бочка», 250 г', 'beans', 'Колумбия', 'Выдержка в бочке: виски, ваниль, инжир', 120000, 3],
    ['Зерно «Полночь», 1 кг', 'beans', 'Суматра', 'Землистый, кедр, тёмная вишня', 290000, 5],
    ['Зерно «Утренний свет», 250 г', 'beans', 'Руанда', 'Мёд, цедра лимона, чёрный чай', 99000, 1],
    ['Булочка с кардамоном', 'bakery', 'Печём каждое утро', 'По-шведски, с жемчужным сахаром', 22000, 1],
    ['Круассан на топлёном масле', 'bakery', 'Печём каждое утро', 'Слоёное тесто 72 часа', 24000, 1],
  ].forEach((p) => ins.run(...p));

  const rev = db.prepare('INSERT INTO reviews (author, rating, body) VALUES (?, ?, ?)');
  rev.run('Марта К.', 5, 'Гуджи на V60 на вкус как жасминовый сад. Лучший фильтр-кофе в городе.');
  rev.run('Даниил Р.', 5, 'Латте с копчёным кленом нужно запретить законом. Прихожу каждое утро.');
  rev.run('Инесса П.', 4, 'Уютно, отличное зерно домой. Булочки с кардамоном разбирают моментально!');
}

// ---------- Helpers ----------
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/products', (req, res) => {
  const { category } = req.query;
  const rows = category
    ? db.prepare('SELECT * FROM products WHERE category = ? ORDER BY price_cents').all(String(category))
    : db.prepare('SELECT * FROM products ORDER BY category, price_cents').all();
  res.json(rows);
});

app.post('/api/orders', (req, res) => {
  const customer = text(req.body.customer, 80);
  const email = text(req.body.email, 120);
  const pickup = text(req.body.pickup_time, 5);
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 30) : [];
  if (!customer) return fail(res, 'Пожалуйста, укажите имя.');
  if (!isEmail(email)) return fail(res, 'Укажите корректный email.');
  if (!/^\d{2}:\d{2}$/.test(pickup)) return fail(res, 'Выберите время, когда заберёте заказ.');
  if (!items.length) return fail(res, 'Корзина пуста.');

  const getProduct = db.prepare('SELECT id, price_cents FROM products WHERE id = ?');
  const lines = [];
  for (const it of items) {
    const p = getProduct.get(Number(it.id));
    const qty = Math.trunc(Number(it.qty));
    if (!p || !(qty >= 1 && qty <= 20)) return fail(res, 'В корзине есть некорректная позиция.');
    lines.push({ ...p, qty });
  }
  const total = lines.reduce((s, l) => s + l.price_cents * l.qty, 0);

  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO orders (customer, email, pickup_time, total_cents) VALUES (?, ?, ?, ?)')
      .run(customer, email, pickup, total);
    const orderId = Number(lastInsertRowid);
    const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, qty, price_cents) VALUES (?, ?, ?, ?)');
    lines.forEach((l) => insItem.run(orderId, l.id, l.qty, l.price_cents));
    db.exec('COMMIT');
    res.status(201).json({ id: orderId, total_cents: total, pickup_time: pickup });
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.prepare('SELECT id, customer, pickup_time, total_cents, status, created_at FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!order) return fail(res, 'Заказ не найден', 404);
  order.items = db
    .prepare('SELECT p.name, oi.qty, oi.price_cents FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?')
    .all(order.id);
  res.json(order);
});

app.get('/api/reviews', (req, res) => {
  const reviews = db.prepare('SELECT id, author, rating, body, created_at FROM reviews ORDER BY id DESC LIMIT 30').all();
  const stats = db.prepare('SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM reviews').get();
  res.json({ reviews, stats });
});

app.post('/api/reviews', (req, res) => {
  const author = text(req.body.author, 60);
  const body = text(req.body.body, 500);
  const rating = Math.trunc(Number(req.body.rating));
  if (!author || body.length < 5) return fail(res, 'Нужны имя и хотя бы пара слов отзыва.');
  if (!(rating >= 1 && rating <= 5)) return fail(res, 'Оценка должна быть от 1 до 5.');
  const { lastInsertRowid } = db.prepare('INSERT INTO reviews (author, rating, body) VALUES (?, ?, ?)').run(author, rating, body);
  res.status(201).json(db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(lastInsertRowid)));
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => {
  console.error(err);
  fail(res, 'Что-то пошло не так на нашей стороне.', 500);
});

app.listen(PORT, () => console.log(`Ember & Oak Roastery → http://localhost:${PORT}`));

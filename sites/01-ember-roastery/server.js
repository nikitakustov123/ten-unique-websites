// Ember & Oak Roastery — coffee shop with menu, online orders and reviews.
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
    ['Ember Espresso', 'espresso', 'Brazil · Colombia', 'Dark chocolate, molasses, toasted hazelnut', 350, 4],
    ['Velvet Flat White', 'espresso', 'House blend', 'Silky milk, caramel, cocoa nib', 450, 4],
    ['Cortado Noir', 'espresso', 'Guatemala', 'Brown sugar, plum, cedar', 420, 3],
    ['Smoked Maple Latte', 'espresso', 'House blend', 'Maple syrup, oak smoke, cream', 520, 4],
    ['Ethiopia Guji V60', 'filter', 'Guji, Ethiopia', 'Jasmine, bergamot, peach', 550, 2],
    ['Kenya AA Chemex', 'filter', 'Nyeri, Kenya', 'Blackcurrant, grapefruit, tomato leaf', 600, 2],
    ['Cold Brew 18h', 'filter', 'Peru', 'Cocoa, red apple, long sweet finish', 480, 3],
    ['Oak Barrel Beans 250g', 'beans', 'Colombia', 'Barrel-aged, whisky, vanilla, fig', 1800, 3],
    ['Midnight Roast 1kg', 'beans', 'Sumatra', 'Earthy, cedar, dark cherry', 3400, 5],
    ['Morning Light 250g', 'beans', 'Rwanda', 'Honey, lemon zest, black tea', 1600, 1],
    ['Cardamom Bun', 'bakery', 'Baked daily', 'Swedish-style, pearl sugar', 380, 1],
    ['Brown Butter Croissant', 'bakery', 'Baked daily', '72-hour laminated dough', 400, 1],
  ].forEach((p) => ins.run(...p));

  const rev = db.prepare('INSERT INTO reviews (author, rating, body) VALUES (?, ?, ?)');
  rev.run('Marta K.', 5, 'The Guji V60 tastes like a jasmine garden. Best filter coffee in town.');
  rev.run('Daniel R.', 5, 'Smoked Maple Latte should be illegal. I come back every morning.');
  rev.run('Ines P.', 4, 'Cosy space, great beans to take home. Cardamom buns sell out fast!');
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
  if (!customer) return fail(res, 'Please tell us your name.');
  if (!isEmail(email)) return fail(res, 'Please enter a valid email.');
  if (!/^\d{2}:\d{2}$/.test(pickup)) return fail(res, 'Choose a pickup time.');
  if (!items.length) return fail(res, 'Your cart is empty.');

  const getProduct = db.prepare('SELECT id, price_cents FROM products WHERE id = ?');
  const lines = [];
  for (const it of items) {
    const p = getProduct.get(Number(it.id));
    const qty = Math.trunc(Number(it.qty));
    if (!p || !(qty >= 1 && qty <= 20)) return fail(res, 'Invalid item in cart.');
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
  if (!order) return fail(res, 'Order not found', 404);
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
  if (!author || body.length < 5) return fail(res, 'Name and a short review are required.');
  if (!(rating >= 1 && rating <= 5)) return fail(res, 'Rating must be 1–5.');
  const { lastInsertRowid } = db.prepare('INSERT INTO reviews (author, rating, body) VALUES (?, ?, ?)').run(author, rating, body);
  res.status(201).json(db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(lastInsertRowid)));
});

app.use('/api', (req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => {
  console.error(err);
  fail(res, 'Something went wrong on our side.', 500);
});

app.listen(PORT, () => console.log(`Ember & Oak Roastery → http://localhost:${PORT}`));

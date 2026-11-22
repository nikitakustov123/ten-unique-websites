// Glass Ledger — personal finance tracker: transactions CRUD, categories with budgets, monthly analytics, CSV export.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3008;

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'ledger.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
    monthly_budget_cents INTEGER
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    note TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions (date);
`);

if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n === 0) {
  const c = db.prepare('INSERT INTO categories (name, icon, color, kind, monthly_budget_cents) VALUES (?,?,?,?,?)');
  const cats = [
    ['Salary', '💼', '#5eead4', 'income', null], ['Freelance', '🧑‍💻', '#a78bfa', 'income', null],
    ['Rent', '🏠', '#f472b6', 'expense', 140000], ['Groceries', '🛒', '#fbbf24', 'expense', 45000],
    ['Dining', '🍜', '#fb923c', 'expense', 25000], ['Transport', '🚇', '#60a5fa', 'expense', 12000],
    ['Fun', '🎮', '#c084fc', 'expense', 15000], ['Health', '💊', '#34d399', 'expense', 8000],
  ];
  const ids = Object.fromEntries(cats.map((x) => [x[0], Number(c.run(...x).lastInsertRowid)]));
  const t = db.prepare('INSERT INTO transactions (category_id, amount_cents, note, date) VALUES (?,?,?,?)');
  // Deterministic pseudo-random seed data for the last 6 months
  let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = new Date();
  for (let m = 5; m >= 0; m--) {
    const y = now.getFullYear(), mo = now.getMonth() - m;
    const day = (d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);
    const lastDay = m === 0 ? now.getDate() : 28;
    t.run(ids.Salary, 420000, 'Monthly salary', day(1));
    if (rnd() > 0.4) t.run(ids.Freelance, Math.round(50000 + rnd() * 90000), 'Client project', day(Math.min(lastDay, 15)));
    t.run(ids.Rent, 140000, 'Apartment rent', day(2));
    for (let i = 0; i < 8; i++) {
      const d = 1 + Math.floor(rnd() * lastDay);
      t.run(ids.Groceries, Math.round(3000 + rnd() * 6000), ['Farmers market', 'Supermarket', 'Corner shop'][i % 3], day(d));
      if (i % 2 === 0) t.run(ids.Dining, Math.round(1500 + rnd() * 5000), ['Ramen night', 'Brunch', 'Pizza', 'Sushi'][i % 4], day(d));
      if (i % 3 === 0) t.run(ids.Transport, Math.round(800 + rnd() * 3000), 'Metro & taxi', day(d));
    }
    t.run(ids.Fun, Math.round(3000 + rnd() * 12000), 'Concert tickets', day(Math.min(lastDay, 20)));
    if (rnd() > 0.5) t.run(ids.Health, Math.round(2000 + rnd() * 5000), 'Pharmacy', day(Math.min(lastDay, 10)));
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const validMonth = (m) => (/^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7));

function parseTx(body) {
  const amount = Math.round(Number(body.amount) * 100);
  const categoryId = Number(body.category_id);
  const date = text(body.date, 10);
  if (!(amount > 0 && amount < 1e11)) return { error: 'Amount must be a positive number.' };
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) return { error: 'Choose a category.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Invalid date.' };
  return { amount, categoryId, date, note: text(body.note, 140) };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY kind DESC, name').all()));

app.patch('/api/categories/:id/budget', (req, res) => {
  const cents = req.body.budget === null || req.body.budget === '' ? null : Math.round(Number(req.body.budget) * 100);
  if (cents !== null && !(cents >= 0)) return fail(res, 'Budget must be a positive number.');
  const r = db.prepare("UPDATE categories SET monthly_budget_cents = ? WHERE id = ? AND kind = 'expense'").run(cents, Number(req.params.id));
  if (!r.changes) return fail(res, 'Expense category not found', 404);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id)));
});

app.get('/api/transactions', (req, res) => {
  const month = validMonth(String(req.query.month || ''));
  res.json(db.prepare(`SELECT t.*, c.name AS category, c.icon, c.color, c.kind FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE substr(t.date, 1, 7) = ? ORDER BY t.date DESC, t.id DESC`).all(month));
});

app.post('/api/transactions', (req, res) => {
  const tx = parseTx(req.body);
  if (tx.error) return fail(res, tx.error);
  const id = Number(db.prepare('INSERT INTO transactions (category_id, amount_cents, note, date) VALUES (?,?,?,?)').run(tx.categoryId, tx.amount, tx.note, tx.date).lastInsertRowid);
  res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(id));
});

app.put('/api/transactions/:id', (req, res) => {
  const tx = parseTx(req.body);
  if (tx.error) return fail(res, tx.error);
  const r = db.prepare('UPDATE transactions SET category_id = ?, amount_cents = ?, note = ?, date = ? WHERE id = ?').run(tx.categoryId, tx.amount, tx.note, tx.date, Number(req.params.id));
  if (!r.changes) return fail(res, 'Transaction not found', 404);
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/transactions/:id', (req, res) => {
  const r = db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return fail(res, 'Transaction not found', 404);
  res.status(204).end();
});

app.get('/api/summary', (req, res) => {
  const month = validMonth(String(req.query.month || ''));
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN c.kind = 'income' THEN amount_cents END), 0) AS income,
      COALESCE(SUM(CASE WHEN c.kind = 'expense' THEN amount_cents END), 0) AS expenses
    FROM transactions t JOIN categories c ON c.id = t.category_id WHERE substr(t.date, 1, 7) = ?`).get(month);
  const byCategory = db.prepare(`SELECT c.id, c.name, c.icon, c.color, c.monthly_budget_cents AS budget, COALESCE(SUM(t.amount_cents), 0) AS spent
    FROM categories c LEFT JOIN transactions t ON t.category_id = c.id AND substr(t.date, 1, 7) = ?
    WHERE c.kind = 'expense' GROUP BY c.id ORDER BY spent DESC`).all(month);
  const trend = db.prepare(`SELECT substr(t.date, 1, 7) AS month,
      SUM(CASE WHEN c.kind = 'income' THEN amount_cents ELSE 0 END) AS income,
      SUM(CASE WHEN c.kind = 'expense' THEN amount_cents ELSE 0 END) AS expenses
    FROM transactions t JOIN categories c ON c.id = t.category_id
    GROUP BY 1 ORDER BY 1 DESC LIMIT 6`).all().reverse();
  const allTime = db.prepare(`SELECT COALESCE(SUM(CASE WHEN c.kind='income' THEN amount_cents ELSE -amount_cents END), 0) AS balance
    FROM transactions t JOIN categories c ON c.id = t.category_id`).get().balance;
  res.json({ month, ...totals, net: totals.income - totals.expenses, balance: allTime, byCategory, trend });
});

app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare('SELECT t.date, c.name AS category, c.kind, t.amount_cents, t.note FROM transactions t JOIN categories c ON c.id = t.category_id ORDER BY t.date').all();
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = ['date,category,type,amount,note', ...rows.map((r) => [r.date, esc(r.category), r.kind, (r.amount_cents / 100).toFixed(2), esc(r.note)].join(','))].join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="glass-ledger.csv"').send(csv);
});

app.use('/api', (req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Unexpected error.', 500); });
app.listen(PORT, () => console.log(`Glass Ledger → http://localhost:${PORT}`));

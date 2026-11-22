// Glass Ledger — личные финансы: операции, категории с бюджетами, аналитика по месяцам, экспорт в CSV.
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
  const K = 30; // demo data was designed in dollars; scale to realistic ruble amounts
  const c = db.prepare('INSERT INTO categories (name, icon, color, kind, monthly_budget_cents) VALUES (?,?,?,?,?)');
  const cats = [
    ['Зарплата', '💼', '#5eead4', 'income', null], ['Фриланс', '🧑‍💻', '#a78bfa', 'income', null],
    ['Аренда', '🏠', '#f472b6', 'expense', K * 140000], ['Продукты', '🛒', '#fbbf24', 'expense', K * 45000],
    ['Кафе', '🍜', '#fb923c', 'expense', K * 25000], ['Транспорт', '🚇', '#60a5fa', 'expense', K * 12000],
    ['Досуг', '🎮', '#c084fc', 'expense', K * 15000], ['Здоровье', '💊', '#34d399', 'expense', K * 8000],
  ];
  const ids = Object.fromEntries(cats.map((x) => [x[0], Number(c.run(...x).lastInsertRowid)]));
  const money = (v) => Math.round(v * K); // seed amounts are scaled to rubles
  const t = db.prepare('INSERT INTO transactions (category_id, amount_cents, note, date) VALUES (?,?,?,?)');
  // Deterministic pseudo-random seed data for the last 6 months
  let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = new Date();
  for (let m = 5; m >= 0; m--) {
    const y = now.getFullYear(), mo = now.getMonth() - m;
    const day = (d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);
    const lastDay = m === 0 ? now.getDate() : 28;
    t.run(ids['Зарплата'], money(420000), 'Зарплата за месяц', day(1));
    if (rnd() > 0.4) t.run(ids['Фриланс'], money(50000 + rnd() * 90000), 'Проект для клиента', day(Math.min(lastDay, 15)));
    t.run(ids['Аренда'], money(140000), 'Аренда квартиры', day(2));
    for (let i = 0; i < 8; i++) {
      const d = 1 + Math.floor(rnd() * lastDay);
      t.run(ids['Продукты'], money(3000 + rnd() * 6000), ['Фермерский рынок', 'Супермаркет', 'Магазин у дома'][i % 3], day(d));
      if (i % 2 === 0) t.run(ids['Кафе'], money(1500 + rnd() * 5000), ['Вечер рамена', 'Бранч', 'Пицца', 'Суши'][i % 4], day(d));
      if (i % 3 === 0) t.run(ids['Транспорт'], money(800 + rnd() * 3000), 'Метро и такси', day(d));
    }
    t.run(ids['Досуг'], money(3000 + rnd() * 12000), 'Билеты на концерт', day(Math.min(lastDay, 20)));
    if (rnd() > 0.5) t.run(ids['Здоровье'], money(2000 + rnd() * 5000), 'Аптека', day(Math.min(lastDay, 10)));
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const validMonth = (m) => (/^\d{4}-\d{2}$/.test(m) ? m : new Date().toISOString().slice(0, 7));

function parseTx(body) {
  const amount = Math.round(Number(body.amount) * 100);
  const categoryId = Number(body.category_id);
  const date = text(body.date, 10);
  if (!(amount > 0 && amount < 1e11)) return { error: 'Сумма должна быть положительным числом.' };
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) return { error: 'Выберите категорию.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Некорректная дата.' };
  return { amount, categoryId, date, note: text(body.note, 140) };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY kind DESC, name').all()));

app.patch('/api/categories/:id/budget', (req, res) => {
  const cents = req.body.budget === null || req.body.budget === '' ? null : Math.round(Number(req.body.budget) * 100);
  if (cents !== null && !(cents >= 0)) return fail(res, 'Бюджет должен быть положительным числом.');
  const r = db.prepare("UPDATE categories SET monthly_budget_cents = ? WHERE id = ? AND kind = 'expense'").run(cents, Number(req.params.id));
  if (!r.changes) return fail(res, 'Категория расходов не найдена', 404);
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
  if (!r.changes) return fail(res, 'Операция не найдена', 404);
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/transactions/:id', (req, res) => {
  const r = db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return fail(res, 'Операция не найдена', 404);
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
  const kind = { income: 'доход', expense: 'расход' };
  const csv = '\ufeff' + ['дата,категория,тип,сумма,комментарий', ...rows.map((r) => [r.date, esc(r.category), kind[r.kind], (r.amount_cents / 100).toFixed(2), esc(r.note)].join(','))].join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="glass-ledger.csv"').send(csv);
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Непредвиденная ошибка.', 500); });
app.listen(PORT, () => console.log(`Glass Ledger → http://localhost:${PORT}`));

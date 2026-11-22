// Terminal Jobs — доска вакансий для разработчиков в виде терминала: список, поиск, отклики, публикация.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3010;
const LEVELS = ['junior', 'middle', 'senior', 'lead'];

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'jobs.db'));

// SQLite's built-in LIKE is case-insensitive only for ASCII. Override it so that
// search also ignores case for Cyrillic ("суп" finds "Суп").
const likeRe = (p) => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '[\\s\\S]*').replace(/_/g, '[\\s\\S]') + '$', 'iu');
db.function('like', { deterministic: true }, (p, v) => (p == null || v == null ? null : likeRe(String(p)).test(String(v)) ? 1 : 0));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    remote INTEGER NOT NULL DEFAULT 0,
    level TEXT NOT NULL,
    salary_min INTEGER,
    salary_max INTEGER,
    stack TEXT NOT NULL,
    description TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    github TEXT,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (job_id, email)
  );
`);

if (db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n === 0) {
  const ins = db.prepare('INSERT INTO jobs (title, company, location, remote, level, salary_min, salary_max, stack, description, contact_email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, datetime(\'now\', ?))');
  [
    ['Senior Rust-разработчик', 'Ferrous Labs', 'Москва', 1, 'senior', 400, 550, 'rust,tokio,postgres', 'Пишем стриминговую базу данных с низкой задержкой. Вы будете отвечать за движок хранения и планировщик запросов.', 'hiring@ferrous.dev', '-1 days'],
    ['Фронтенд-разработчик (React)', 'Pixelcraft', 'Санкт-Петербург', 1, 'middle', 220, 300, 'react,typescript,css', 'Создаём интерфейсы для дизайн-инструмента, которым пользуются 2 млн авторов. Любители анимаций — к нам.', 'jobs@pixelcraft.io', '-2 days'],
    ['Platform / SRE-инженер', 'Cloudnine', 'Казань', 0, 'senior', 350, 450, 'kubernetes,go,terraform', 'Следим, чтобы 4 000 нод работали без сбоев. Дежурства по графику, без поиска виноватых и с хорошей оплатой.', 'sre@cloudnine.ru', '-3 days'],
    ['Junior Python-разработчик', 'DataSprout', 'Удалённо (РФ)', 1, 'junior', 90, 130, 'python,django,sql', 'Дружная команда, делаем API для климатических данных. Наставник и бюджет на обучение.', 'careers@datasprout.ru', '-4 days'],
    ['ML-инженер', 'Neuronet', 'Новосибирск', 0, 'senior', 420, 600, 'python,pytorch,cuda', 'Обучаем и выводим в прод модели компьютерного зрения для медицинской диагностики.', 'ml@neuronet.ai', '-5 days'],
    ['Техлид — платежи', 'Ledgerly', 'Удалённо', 1, 'lead', 550, 700, 'java,kotlin,kafka', 'Руководим командой из 7 человек: строим платёжную инфраструктуру реального времени в 30 странах.', 'lead@ledgerly.com', '-6 days'],
    ['Full-stack Node.js-разработчик', 'Tinybird Studio', 'Екатеринбург', 1, 'middle', 200, 280, 'node,express,sqlite,vue', 'Небольшая продуктовая студия, большая зона ответственности. Каждую неделю выпускаем фичи от и до.', 'hey@tinybird.studio', '-8 days'],
    ['iOS-разработчик (Swift)', 'Moonwalk', 'Москва', 0, 'middle', 250, 330, 'swift,swiftui,combine', 'Делаем фитнес-приложение, которым уже пользуются ваши друзья. Сильная дизайн-культура.', 'ios@moonwalk.ru', '-10 days'],
  ].forEach((j) => ins.run(...j));
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const shape = (j) => ({ ...j, remote: Boolean(j.remote), stack: j.stack.split(',').filter(Boolean) });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/jobs', (req, res) => {
  const where = [], args = [];
  const q = text(req.query.q, 60);
  if (q) { where.push('(title LIKE ? OR company LIKE ? OR stack LIKE ? OR location LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  if (req.query.remote === '1') where.push('remote = 1');
  if (LEVELS.includes(req.query.level)) { where.push('level = ?'); args.push(req.query.level); }
  const rows = db.prepare(`SELECT j.id, j.title, j.company, j.location, j.remote, j.level, j.salary_min, j.salary_max, j.stack, j.created_at,
    (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicants
    FROM jobs j ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.created_at DESC, j.id DESC`).all(...args);
  res.json(rows.map(shape));
});

app.get('/api/jobs/:id', (req, res) => {
  const j = db.prepare('SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicants FROM jobs j WHERE j.id = ?').get(Number(req.params.id));
  if (!j) return fail(res, `вакансия ${req.params.id}: не найдена`, 404);
  delete j.contact_email; // never expose employer email publicly
  res.json(shape(j));
});

app.post('/api/jobs', (req, res) => {
  const b = req.body || {};
  const job = {
    title: text(b.title, 100), company: text(b.company, 80), location: text(b.location, 80) || 'Удалённо',
    remote: /^(y|yes|true|1|д|да)$/i.test(String(b.remote).trim()) ? 1 : 0, level: text(b.level, 10).toLowerCase(),
    salary_min: Number(b.salary_min) || null, salary_max: Number(b.salary_max) || null,
    stack: text(b.stack, 120).toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 8).join(','),
    description: text(b.description, 1500), contact_email: text(b.contact_email, 120),
  };
  if (job.title.length < 3 || job.company.length < 2) return fail(res, 'нужны должность и компания');
  if (!LEVELS.includes(job.level)) return fail(res, `уровень должен быть одним из: ${LEVELS.join(', ')}`);
  if (!job.stack) return fail(res, 'укажите стек (например, "go, postgres")');
  if (job.description.length < 20) return fail(res, 'описание — минимум 20 символов');
  if (!isEmail(job.contact_email)) return fail(res, 'некорректный email для связи');
  if (job.salary_min && job.salary_max && job.salary_min > job.salary_max) return fail(res, 'зарплата «от» больше, чем «до»');
  const id = Number(db.prepare('INSERT INTO jobs (title, company, location, remote, level, salary_min, salary_max, stack, description, contact_email) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(job.title, job.company, job.location, job.remote, job.level, job.salary_min, job.salary_max, job.stack, job.description, job.contact_email).lastInsertRowid);
  res.status(201).json({ id });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const jobId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) return fail(res, `вакансия ${jobId}: не найдена`, 404);
  const name = text(req.body.name, 80), email = text(req.body.email, 120), github = text(req.body.github, 120), message = text(req.body.message, 2000);
  if (name.length < 2) return fail(res, 'укажите имя');
  if (!isEmail(email)) return fail(res, 'некорректный email');
  if (message.length < 10) return fail(res, 'сообщение — минимум 10 символов');
  try {
    const id = Number(db.prepare('INSERT INTO applications (job_id, name, email, github, message) VALUES (?,?,?,?,?)').run(jobId, name, email, github || null, message).lastInsertRowid);
    res.status(201).json({ id, job_id: jobId });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return fail(res, 'вы уже откликались на эту вакансию с этим email', 409);
    throw e;
  }
});

app.get('/api/stats', (req, res) => {
  const s = db.prepare(`SELECT COUNT(*) AS jobs, SUM(remote) AS remote, (SELECT COUNT(*) FROM applications) AS applications,
    ROUND(AVG((COALESCE(salary_min, salary_max) + COALESCE(salary_max, salary_min)) / 2.0)) AS avg_salary_k FROM jobs`).get();
  const stacks = {};
  db.prepare('SELECT stack FROM jobs').all().forEach((r) => r.stack.split(',').forEach((t) => (stacks[t] = (stacks[t] || 0) + 1)));
  s.top_stack = Object.entries(stacks).sort((a, b) => b[1] - a[1]).slice(0, 8);
  res.json(s);
});

app.use('/api', (req, res) => fail(res, 'Не найдено', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'ошибка сегментации (образ памяти сброшен)', 500); });
app.listen(PORT, () => console.log(`Terminal Jobs → http://localhost:${PORT}`));

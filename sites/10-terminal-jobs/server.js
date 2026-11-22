// Terminal Jobs — developer job board with a terminal UI: listings, search, applications, job posting.
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
    ['Senior Rust Engineer', 'Ferrous Labs', 'Berlin', 1, 'senior', 120, 160, 'rust,tokio,postgres', 'Build a low-latency streaming database. You will own the storage engine and query planner.', 'hiring@ferrous.dev', '-1 days'],
    ['Frontend Developer (React)', 'Pixelcraft', 'Lisbon', 1, 'middle', 60, 85, 'react,typescript,css', 'Craft delightful interfaces for a design-tool used by 2M creators. Animation nerds welcome.', 'jobs@pixelcraft.io', '-2 days'],
    ['Platform / SRE Engineer', 'Cloudnine', 'Amsterdam', 0, 'senior', 100, 135, 'kubernetes,go,terraform', 'Keep 4,000 nodes humming. On-call is shared, blameless and well paid.', 'sre@cloudnine.nl', '-3 days'],
    ['Junior Python Developer', 'DataSprout', 'Remote (EU)', 1, 'junior', 40, 55, 'python,django,sql', 'Join a friendly team building climate-data APIs. Mentorship and learning budget included.', 'careers@datasprout.eu', '-4 days'],
    ['ML Engineer', 'Neuronet', 'London', 0, 'senior', 130, 180, 'python,pytorch,cuda', 'Train and ship vision models to production for medical imaging.', 'ml@neuronet.ai', '-5 days'],
    ['Tech Lead — Payments', 'Ledgerly', 'Remote', 1, 'lead', 150, 190, 'java,kotlin,kafka', 'Lead a team of 7 building real-time payment rails across 30 countries.', 'lead@ledgerly.com', '-6 days'],
    ['Full-Stack Node.js Developer', 'Tinybird Studio', 'Warsaw', 1, 'middle', 55, 80, 'node,express,sqlite,vue', 'Small product studio, big ownership. Ship features end-to-end every week.', 'hey@tinybird.studio', '-8 days'],
    ['iOS Engineer (Swift)', 'Moonwalk', 'Stockholm', 0, 'middle', 70, 95, 'swift,swiftui,combine', 'Build the fitness app your friends already use. Strong design culture.', 'ios@moonwalk.se', '-10 days'],
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
  const q = text(req.query.q, 60).toLowerCase();
  if (q) { where.push('(lower(title) LIKE ? OR lower(company) LIKE ? OR lower(stack) LIKE ? OR lower(location) LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  if (req.query.remote === '1') where.push('remote = 1');
  if (LEVELS.includes(req.query.level)) { where.push('level = ?'); args.push(req.query.level); }
  const rows = db.prepare(`SELECT j.id, j.title, j.company, j.location, j.remote, j.level, j.salary_min, j.salary_max, j.stack, j.created_at,
    (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicants
    FROM jobs j ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.created_at DESC, j.id DESC`).all(...args);
  res.json(rows.map(shape));
});

app.get('/api/jobs/:id', (req, res) => {
  const j = db.prepare('SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicants FROM jobs j WHERE j.id = ?').get(Number(req.params.id));
  if (!j) return fail(res, `job ${req.params.id}: no such job`, 404);
  delete j.contact_email; // never expose employer email publicly
  res.json(shape(j));
});

app.post('/api/jobs', (req, res) => {
  const b = req.body || {};
  const job = {
    title: text(b.title, 100), company: text(b.company, 80), location: text(b.location, 80) || 'Remote',
    remote: /^(y|yes|true|1)$/i.test(String(b.remote)) ? 1 : 0, level: text(b.level, 10).toLowerCase(),
    salary_min: Number(b.salary_min) || null, salary_max: Number(b.salary_max) || null,
    stack: text(b.stack, 120).toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 8).join(','),
    description: text(b.description, 1500), contact_email: text(b.contact_email, 120),
  };
  if (job.title.length < 3 || job.company.length < 2) return fail(res, 'title and company are required');
  if (!LEVELS.includes(job.level)) return fail(res, `level must be one of: ${LEVELS.join(', ')}`);
  if (!job.stack) return fail(res, 'stack is required (e.g. "go, postgres")');
  if (job.description.length < 20) return fail(res, 'description must be at least 20 characters');
  if (!isEmail(job.contact_email)) return fail(res, 'contact_email is invalid');
  if (job.salary_min && job.salary_max && job.salary_min > job.salary_max) return fail(res, 'salary_min > salary_max');
  const id = Number(db.prepare('INSERT INTO jobs (title, company, location, remote, level, salary_min, salary_max, stack, description, contact_email) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(job.title, job.company, job.location, job.remote, job.level, job.salary_min, job.salary_max, job.stack, job.description, job.contact_email).lastInsertRowid);
  res.status(201).json({ id });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const jobId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(jobId)) return fail(res, `job ${jobId}: no such job`, 404);
  const name = text(req.body.name, 80), email = text(req.body.email, 120), github = text(req.body.github, 120), message = text(req.body.message, 2000);
  if (name.length < 2) return fail(res, 'name is required');
  if (!isEmail(email)) return fail(res, 'email is invalid');
  if (message.length < 10) return fail(res, 'message must be at least 10 characters');
  try {
    const id = Number(db.prepare('INSERT INTO applications (job_id, name, email, github, message) VALUES (?,?,?,?,?)').run(jobId, name, email, github || null, message).lastInsertRowid);
    res.status(201).json({ id, job_id: jobId });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return fail(res, 'you have already applied to this job with that email', 409);
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

app.use('/api', (req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'segmentation fault (core dumped)', 500); });
app.listen(PORT, () => console.log(`Terminal Jobs → http://localhost:${PORT}`));

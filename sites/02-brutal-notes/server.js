// BRUTAL/NOTES — neo-brutalist note board with tags, pinning, search and full CRUD.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3002;
const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange', 'white'];

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'notes.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'yellow',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  );
`);

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });

function setTags(noteId, tags) {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const upsert = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
  const find = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)');
  for (const raw of tags) {
    const name = text(raw, 24).toLowerCase().replace(/[^a-z0-9\-]/g, '');
    if (!name) continue;
    upsert.run(name);
    link.run(noteId, find.get(name).id);
  }
  db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)');
}

function getNote(id) {
  const n = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!n) return null;
  n.tags = db.prepare('SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name').all(id).map((r) => r.name);
  n.pinned = Boolean(n.pinned);
  return n;
}

function parseNote(body) {
  const title = text(body.title, 120);
  const content = text(body.body, 4000);
  const color = COLORS.includes(body.color) ? body.color : 'yellow';
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 8) : [];
  return { title, content, color, tags, pinned: body.pinned ? 1 : 0 };
}

if (db.prepare('SELECT COUNT(*) AS n FROM notes').get().n === 0) {
  const ins = db.prepare('INSERT INTO notes (title, body, color, pinned) VALUES (?, ?, ?, ?)');
  [
    ['READ ME FIRST', 'This board is LOUD on purpose. Click a note to edit it. Pin the important stuff.', 'yellow', 1, ['welcome']],
    ['Ship the landing page', 'Hero copy → done\nPricing table → todo\nFooter links → todo', 'pink', 1, ['work', 'urgent']],
    ['Groceries', 'eggs, oat milk, chili crisp, lemons, MORE coffee', 'green', 0, ['life']],
    ['Idea: brutalist calendar', 'Every day is a giant black box. Events are stickers. No mercy.', 'blue', 0, ['ideas']],
    ['Books to read', '1. The Design of Everyday Things\n2. Shape Up\n3. Thinking in Systems', 'orange', 0, ['life', 'ideas']],
    ['Reminder', 'Drink water. Stretch. Close 37 tabs.', 'white', 0, ['life']],
  ].forEach(([t, b, c, p, tags]) => setTags(Number(ins.run(t, b, c, p).lastInsertRowid), tags));
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/notes', (req, res) => {
  const q = text(req.query.q, 100);
  const tag = text(req.query.tag, 24);
  let sql = 'SELECT DISTINCT n.id FROM notes n LEFT JOIN note_tags nt ON nt.note_id = n.id LEFT JOIN tags t ON t.id = nt.tag_id WHERE 1=1';
  const args = [];
  if (q) { sql += ' AND (n.title LIKE ? OR n.body LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  if (tag) { sql += ' AND n.id IN (SELECT note_id FROM note_tags JOIN tags ON tags.id = note_tags.tag_id WHERE tags.name = ?)'; args.push(tag); }
  sql += ' ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC';
  res.json(db.prepare(sql).all(...args).map((r) => getNote(r.id)));
});

app.get('/api/tags', (req, res) => {
  res.json(db.prepare('SELECT t.name, COUNT(nt.note_id) AS count FROM tags t JOIN note_tags nt ON nt.tag_id = t.id GROUP BY t.id ORDER BY count DESC, t.name').all());
});

app.get('/api/stats', (req, res) => {
  res.json(db.prepare('SELECT COUNT(*) AS total, SUM(pinned) AS pinned, (SELECT COUNT(*) FROM tags) AS tags FROM notes').get());
});

app.post('/api/notes', (req, res) => {
  const n = parseNote(req.body);
  if (!n.title) return fail(res, 'A note needs a TITLE.');
  const id = Number(db.prepare('INSERT INTO notes (title, body, color, pinned) VALUES (?, ?, ?, ?)').run(n.title, n.content, n.color, n.pinned).lastInsertRowid);
  setTags(id, n.tags);
  res.status(201).json(getNote(id));
});

app.put('/api/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getNote(id)) return fail(res, 'Note not found', 404);
  const n = parseNote(req.body);
  if (!n.title) return fail(res, 'A note needs a TITLE.');
  db.prepare("UPDATE notes SET title = ?, body = ?, color = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?").run(n.title, n.content, n.color, n.pinned, id);
  setTags(id, n.tags);
  res.json(getNote(id));
});

app.patch('/api/notes/:id/pin', (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('UPDATE notes SET pinned = 1 - pinned WHERE id = ?').run(id);
  if (!r.changes) return fail(res, 'Note not found', 404);
  res.json(getNote(id));
});

app.delete('/api/notes/:id', (req, res) => {
  const r = db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return fail(res, 'Note not found', 404);
  db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)');
  res.status(204).end();
});

app.use('/api', (req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'Server exploded. Try again.', 500); });

app.listen(PORT, () => console.log(`BRUTAL/NOTES → http://localhost:${PORT}`));

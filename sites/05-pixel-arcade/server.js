// Pixel Arcade — retro arcade with playable games and a server-validated high-score table.
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3005;
const GAMES = {
  snake: { title: 'NEON SNAKE', maxPerSecond: 20 },
  reflex: { title: 'REFLEX BLASTER', maxPerSecond: 300 },
};

mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'arcade.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    game TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    initials TEXT NOT NULL,
    score INTEGER NOT NULL,
    duration_s INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scores_game ON scores (game, score DESC);
`);

if (db.prepare('SELECT COUNT(*) AS n FROM scores').get().n === 0) {
  const ins = db.prepare('INSERT INTO scores (game, initials, score, duration_s) VALUES (?, ?, ?, ?)');
  [['AAA', 420], ['ZAP', 360], ['BIT', 300], ['MEG', 240], ['JOY', 180], ['CPU', 120], ['K8T', 60]].forEach(([i, s]) => ins.run('snake', i, s, s / 2));
  [['ACE', 2400], ['FLX', 2100], ['NOX', 1650], ['RAD', 1200], ['GG!', 900]].forEach(([i, s]) => ins.run('reflex', i, s, 30));
}

const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/games', (req, res) => {
  res.json(Object.entries(GAMES).map(([id, g]) => ({
    id, title: g.title,
    plays: db.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?').get(id).n,
    top: db.prepare('SELECT initials, score FROM scores WHERE game = ? ORDER BY score DESC LIMIT 1').get(id) || null,
  })));
});

app.get('/api/leaderboard/:game', (req, res) => {
  const game = String(req.params.game);
  if (!GAMES[game]) return fail(res, 'Unknown game', 404);
  res.json(db.prepare('SELECT initials, score, created_at FROM scores WHERE game = ? ORDER BY score DESC, id ASC LIMIT 10').all(game));
});

// A game session token is issued when a round starts. Scores are only accepted with a valid,
// unused token and must be plausible for the elapsed time — a simple guard against fake submits.
app.post('/api/sessions', (req, res) => {
  const game = String(req.body?.game || '');
  if (!GAMES[game]) return fail(res, 'Unknown game');
  db.prepare('DELETE FROM sessions WHERE started_at < ?').run(Date.now() - 2 * 3600_000);
  const token = randomUUID();
  db.prepare('INSERT INTO sessions (token, game, started_at) VALUES (?, ?, ?)').run(token, game, Date.now());
  res.status(201).json({ token });
});

app.post('/api/scores', (req, res) => {
  const { token, score } = req.body || {};
  const initials = String(req.body?.initials || '').toUpperCase().replace(/[^A-Z0-9!?]/g, '').slice(0, 3);
  if (initials.length !== 3) return fail(res, 'Enter exactly 3 characters.');
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token));
  if (!s || s.used) return fail(res, 'Invalid or used game session.', 403);
  const points = Math.trunc(Number(score));
  const elapsed = Math.max(1, Math.round((Date.now() - s.started_at) / 1000));
  if (!(points >= 0) || points > elapsed * GAMES[s.game].maxPerSecond + 50) return fail(res, 'That score looks suspicious… 👾', 422);
  db.prepare('UPDATE sessions SET used = 1 WHERE token = ?').run(s.token);
  const id = Number(db.prepare('INSERT INTO scores (game, initials, score, duration_s) VALUES (?, ?, ?, ?)').run(s.game, initials, points, elapsed).lastInsertRowid);
  const rank = db.prepare('SELECT COUNT(*) + 1 AS r FROM scores WHERE game = ? AND (score > ? OR (score = ? AND id < ?))').get(s.game, points, points, id).r;
  res.status(201).json({ rank, score: points, initials });
});

app.get('/api/stats', (req, res) => {
  res.json(db.prepare('SELECT COUNT(*) AS games_played, COALESCE(SUM(score), 0) AS total_points, COUNT(DISTINCT initials) AS players, COALESCE(SUM(duration_s), 0) AS seconds FROM scores').get());
});

app.use('/api', (req, res) => fail(res, 'Not found', 404));
app.use((err, req, res, _next) => { console.error(err); fail(res, 'GAME OVER (server error)', 500); });
app.listen(PORT, () => console.log(`Pixel Arcade → http://localhost:${PORT}`));

// Starts all 10 sites at once, each on its own port, with prefixed logs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITES } from './sites.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const colors = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94];
const children = [];

SITES.forEach((site, i) => {
  const cwd = path.join(root, 'sites', site.dir);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd,
    env: { ...process.env, PORT: String(site.port) },
  });
  const tag = `\x1b[${colors[i]}m[${site.dir}]\x1b[0m`;
  const pipe = (stream) =>
    stream.on('data', (buf) =>
      buf.toString().split('\n').filter(Boolean).forEach((line) => console.log(`${tag} ${line}`)),
    );
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => console.log(`${tag} exited with code ${code}`));
  children.push(child);
});

console.log('\nAll sites are starting:\n');
SITES.forEach((s) => console.log(`  ${s.name.padEnd(24)} → http://localhost:${s.port}`));
console.log('\nPress Ctrl+C to stop everything.\n');

const shutdown = () => {
  children.forEach((c) => c.kill('SIGTERM'));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

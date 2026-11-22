// Deletes every site's SQLite database so it is re-created and re-seeded on next start.
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITES } from './sites.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const site of SITES) {
  const dataDir = path.join(root, 'sites', site.dir, 'data');
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    console.log(`reset: ${site.dir}`);
  }
}
console.log('Done. Databases will be re-seeded on next start.');

import { rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages', 'examples'];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'dist') {
        rmSync(full, { recursive: true, force: true });
      } else {
        walk(full);
      }
    } else if (entry.endsWith('.tsbuildinfo')) {
      rmSync(full, { force: true });
    }
  }
}

for (const root of roots) {
  walk(root);
}

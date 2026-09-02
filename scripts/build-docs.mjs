import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const vitepress = resolve('node_modules/vitepress/bin/vitepress.js');

function build(args, env = {}) {
  const result = spawnSync(process.execPath, [vitepress, 'build', 'docs', ...args], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

build([]);
if (!version.includes('-')) {
  build(['--outDir', 'docs/.vitepress/dist/v1'], { DOCS_BASE: '/v1/' });
}

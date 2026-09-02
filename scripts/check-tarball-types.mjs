import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

for (const file of readdirSync('artifacts').filter((name) => name.endsWith('.tgz'))) {
  execFileSync(process.execPath, ['node_modules/@arethetypeswrong/cli/dist/index.js', `artifacts/${file}`, '--profile', 'esm-only'], { stdio: 'inherit' });
}

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const packages = ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login'];
for (const name of packages) {
  const file = `u-net-${name}-${version}.tgz`;
  if (!existsSync(`artifacts/${file}`)) throw new Error(`missing_release_artifact:${file}`);
  execFileSync(process.execPath, ['node_modules/@arethetypeswrong/cli/dist/index.js', `artifacts/${file}`, '--profile', 'esm-only'], { stdio: 'inherit' });
}

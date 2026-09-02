import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const local = process.argv.includes('--local');
const packages = ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login'];
for (const name of packages) {
  const config = `packages/${name}/api-extractor.json`;
  if (!existsSync(config)) throw new Error(`Missing ${config}`);
  execFileSync(process.execPath, ['node_modules/@microsoft/api-extractor/bin/api-extractor', 'run', '--config', config, ...(local ? ['--local'] : [])], { stdio: 'inherit' });
}

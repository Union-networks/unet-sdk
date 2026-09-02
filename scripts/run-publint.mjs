import { execFileSync } from 'node:child_process';

for (const name of ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login']) {
  execFileSync(process.execPath, ['node_modules/publint/src/cli.js', `packages/${name}`], { stdio: 'inherit' });
}

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const miniapp = process.argv.includes('--miniapp');
const packages = miniapp
  ? ['contracts', 'client', 'server', 'web-login']
  : ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login'];
const artifacts = packages.map((name) => {
  const path = resolve(`artifacts/u-net-${name}-${version}.tgz`).replaceAll('\\', '/');
  return { name: `@u-net/${name}`, path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
});
const filename = `artifacts/${version}${miniapp ? '-miniapp' : ''}-manifest.json`;
writeFileSync(filename, `${JSON.stringify({ version, status: 'packed-unpublished', artifacts }, null, 2)}\n`);
console.log(`Wrote ${version} manifest for ${miniapp ? 'the four miniapp candidate' : 'all eight'} packed artifacts.`);

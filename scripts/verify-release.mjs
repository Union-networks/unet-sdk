import { readFileSync } from 'node:fs';

const packageDirs = ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login'];
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const packages = packageDirs.map((directory) => ({
  directory,
  manifest: JSON.parse(readFileSync(`packages/${directory}/package.json`, 'utf8')),
}));

for (const { directory, manifest } of packages) {
  if (manifest.version !== root.version) throw new Error(`version_mismatch:${directory}`);
  if (manifest.name !== `@u-net/${directory}`) throw new Error(`package_name_mismatch:${directory}`);
  if (manifest.type !== 'module' || manifest.exports?.['.']?.require !== null) throw new Error(`esm_contract_invalid:${directory}`);
  if (manifest.engines?.node !== '>=20') throw new Error(`node_support_invalid:${directory}`);
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@u-net/') && range !== 'workspace:^') throw new Error(`workspace_range_invalid:${directory}:${name}`);
  }
}

const tag = process.env.GITHUB_REF_NAME;
if (tag?.startsWith('sdk-v') && tag.slice(5) !== root.version) throw new Error('release_tag_version_mismatch');

const browserPackages = new Set(['@u-net/client', '@u-net/contracts', '@u-net/react', '@u-net/verification', '@u-net/web-login']);
const byName = new Map(packages.map(({ manifest }) => [manifest.name, manifest]));
const visited = new Set();
function inspectBrowserDependency(name) {
  if (visited.has(name)) return;
  visited.add(name);
  if (name === '@u-net/issuer' || name === '@aztec/bb.js') throw new Error(`browser_dependency_forbidden:${name}`);
  const manifest = byName.get(name);
  if (!manifest) return;
  for (const dependency of Object.keys(manifest.dependencies ?? {})) inspectBrowserDependency(dependency);
}
for (const name of browserPackages) inspectBrowserDependency(name);

console.log(`Release metadata is consistent for ${root.version}.`);

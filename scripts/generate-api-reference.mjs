import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const packages = [
  ['@union-networks/client', 'packages/client/src/index.ts'],
  ['@union-networks/web-login', 'packages/web-login/src/index.ts'],
  ['@union-networks/verification', 'packages/verification/src/index.ts'],
  ['@union-networks/react', 'packages/react/src/index.tsx'],
  ['@union-networks/server', 'packages/server/src/index.ts'],
  ['@union-networks/contracts', 'packages/contracts/src/index.ts'],
];

const exportedNames = (source) => {
  const names = new Set();
  for (const match of source.matchAll(/export (?:async function|function|class|interface|type|const) ([A-Za-z0-9_]+)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export \{([^}]+)\}/g)) {
    for (const part of match[1].split(',')) names.add(part.trim().split(' as ')[1] ?? part.trim().split(' as ')[0]);
  }
  return Array.from(names).filter(Boolean).sort();
};

let markdown = '# API Reference\n\nGenerated from package entrypoints. Run `pnpm docs:api` after changing public exports.\n\n';
for (const [name, file] of packages) {
  const source = readFileSync(file, 'utf8');
  markdown += `## ${name}\n\n`;
  const names = exportedNames(source);
  if (!names.length) markdown += 'Type-only contract package.\n\n';
  else markdown += names.map((item) => `- \`${item}\``).join('\n') + '\n\n';
}
mkdirSync('docs', { recursive: true });
writeFileSync('docs/api.md', markdown);

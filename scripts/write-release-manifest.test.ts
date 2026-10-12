import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./write-release-manifest.mjs', import.meta.url));
const packages = ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login'];
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'unet-candidate-manifest-'));
  mkdirSync(join(directory, 'artifacts'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version: '2.0.0-rc.4' }));
  for (const name of packages) writeFileSync(join(directory, `artifacts/u-net-${name}-2.0.0-rc.4.tgz`), name);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('packed artifact manifests', () => {
  it.each([false, true])('records exact hashes without claiming publication (miniapp subset: %s)', (miniapp) => {
    execFileSync(process.execPath, [script, ...(miniapp ? ['--miniapp'] : [])], { cwd: directory });
    const path = join(directory, `artifacts/2.0.0-rc.4${miniapp ? '-miniapp' : ''}-manifest.json`);
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    expect(manifest.version).toBe('2.0.0-rc.4');
    expect(manifest.status).toBe('packed-unpublished');
    expect(manifest.artifacts.map((item: { name: string }) => item.name)).toEqual(
      (miniapp ? ['contracts', 'client', 'server', 'web-login'] : packages).map((name) => `@u-net/${name}`),
    );
    for (const artifact of manifest.artifacts) {
      expect(artifact.sha256).toBe(createHash('sha256').update(readFileSync(artifact.path)).digest('hex'));
      expect(artifact.path).toContain('2.0.0-rc.4.tgz');
    }
  });
});

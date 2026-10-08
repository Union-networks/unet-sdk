import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./verify-release.mjs', import.meta.url));
const packages = ['client', 'contracts', 'issuer', 'react', 'server', 'setup', 'verification', 'web-login'];
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'unet-release-check-'));
  mkdirSync(join(directory, '.changeset/pre'), { recursive: true });
  writeFileSync(join(directory, '.changeset/README.md'), '# Changesets\n');
  writeFileSync(join(directory, '.changeset/pre/archived.md'), 'Applied change\n');
  writeFileSync(join(directory, '.changeset/pre.json'), JSON.stringify({ mode: 'pre', tag: 'rc' }));
  for (const name of packages) {
    mkdirSync(join(directory, `packages/${name}`), { recursive: true });
    copyFileSync(fileURLToPath(new URL(`../packages/${name}/package.json`, import.meta.url)), join(directory, `packages/${name}/package.json`));
  }
  setVersion('2.0.0-rc.3');
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function setVersion(version: string) {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }));
  for (const name of packages) {
    // Use the real manifests while making the fixture independent of the current RC number.
    const manifest = JSON.parse(readFileSync(join(directory, `packages/${name}/package.json`), 'utf8'));
    manifest.version = version;
    writeFileSync(join(directory, `packages/${name}/package.json`), JSON.stringify(manifest));
  }
}

function check(tag = '') {
  try {
    return execFileSync(process.execPath, [script], { cwd: directory, env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    throw new Error((error as { stderr: string }).stderr);
  }
}

describe('tagged release metadata', () => {
  it('allows local preparation with pending changesets', () => {
    writeFileSync(join(directory, '.changeset/pending.md'), 'Pending change\n');
    expect(check()).toContain('2.0.0-rc.3');
  });

  it('accepts an applied RC and ignores archived changesets', () => {
    expect(check('sdk-v2.0.0-rc.3')).toContain('2.0.0-rc.3');
  });

  it('rejects a mismatched tag', () => {
    expect(() => check('sdk-v2.0.0-rc.2')).toThrow('release_tag_version_mismatch');
  });

  it('rejects unapplied changesets on a release tag', () => {
    writeFileSync(join(directory, '.changeset/pending.md'), 'Pending change\n');
    expect(() => check('sdk-v2.0.0-rc.3')).toThrow('release_pending_changesets');
  });

  it.each([{ mode: 'exit', tag: 'rc' }, { mode: 'pre', tag: 'beta' }])('requires active rc Changesets mode: %j', (pre) => {
    writeFileSync(join(directory, '.changeset/pre.json'), JSON.stringify(pre));
    expect(() => check('sdk-v2.0.0-rc.3')).toThrow('release_prerelease_mode_invalid');
  });

  it('rejects missing RC mode', () => {
    rmSync(join(directory, '.changeset/pre.json'));
    expect(() => check('sdk-v2.0.0-rc.3')).toThrow('release_prerelease_mode_invalid');
  });

  it('rejects prereleases that the workflow would route to latest', () => {
    setVersion('2.0.0-beta.1');
    expect(() => check('sdk-v2.0.0-beta.1')).toThrow('release_version_unsupported');
  });

  it('rejects stable promotion while Changesets is in prerelease mode', () => {
    setVersion('2.0.0');
    expect(() => check('sdk-v2.0.0')).toThrow('release_stable_in_prerelease_mode');
  });

  it('retains the existing stable path after prerelease mode is removed', () => {
    setVersion('2.0.0');
    rmSync(join(directory, '.changeset/pre.json'));
    expect(check('sdk-v2.0.0')).toContain('2.0.0');
  });
});

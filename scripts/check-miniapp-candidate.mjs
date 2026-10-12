import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve('.');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
assert.match(version, /^2\.0\.0-rc\.\d+$/);
const manifestPath = `artifacts/${version}-miniapp-manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.version, version);
assert.equal(manifest.status, 'packed-unpublished');
assert.deepEqual(manifest.artifacts.map(({ name }) => name), ['@u-net/contracts', '@u-net/client', '@u-net/server', '@u-net/web-login']);
const consumer = mkdtempSync(resolve(`artifacts/${version}-miniapp-consumer-`));
const externals = new Map();
for (const artifact of manifest.artifacts) {
  assert.equal(createHash('sha256').update(readFileSync(artifact.path)).digest('hex'), artifact.sha256);
  const entries = execFileSync('tar', ['-tzf', artifact.path], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.ok(entries.every((entry) => /^package\/(?:dist\/|package\.json$|README\.md$|CHANGELOG\.md$|LICENSE$)/.test(entry)));
  const target = join(consumer, 'node_modules', artifact.name);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', artifact.path, '-C', target, '--strip-components', '1']);
  const packed = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  assert.equal(packed.name, artifact.name);
  assert.equal(packed.version, version);
  assert.equal(packed.exports['.'].require, null);
  for (const [dependency, range] of Object.entries(packed.dependencies ?? {})) {
    if (dependency.startsWith('@u-net/')) {
      assert.equal(range, `^${version}`);
      assert.ok(manifest.artifacts.some(({ name }) => name === dependency), `missing_candidate_dependency:${dependency}`);
    } else externals.set(dependency, resolve(`packages/${artifact.name.split('/')[1]}/package.json`));
  }
}

// Reuse installed external libraries, but resolve every canonical package from the exact tarball extraction.
for (const [name, source] of externals) {
  const require = createRequire(source);
  let directory = dirname(require.resolve(name));
  while (!existsSync(join(directory, 'package.json')) || JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(directory);
    assert.notEqual(parent, directory, `dependency_root_missing:${name}`);
    directory = parent;
  }
  assert.ok(realpathSync(directory).startsWith(`${realpathSync(root)}\\`) || realpathSync(directory).startsWith(`${realpathSync(root)}/`));
  const target = join(consumer, 'node_modules', name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(directory, target, { recursive: true, dereference: true });
}

const modules = new Map();
for (const { name } of manifest.artifacts) {
  const directory = join(consumer, 'node_modules', name);
  const packed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  modules.set(name, await import(pathToFileURL(resolve(directory, packed.exports['.'].import)).href));
}
const { runMiniappLogin, createDirectProviderLogin, exchangeDirectProviderLogin } = modules.get('@u-net/web-login');
const { createUnetServiceManifest } = modules.get('@u-net/server');
assert.equal(typeof runMiniappLogin, 'function');
const origin = 'https://shop.example';
const challenge = {
  protocolVersion: 2, requestRef: 'smoke_ref', serviceId: 'shop', origin, challenge: 'public_challenge',
  challengeUrl: `${origin}/challenge`, approvalUrl: `${origin}/approve`, expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
};
const account = { scopedUserId: 'smoke_scoped', displayName: 'Account' };
const launchToken = 'a'.repeat(64);
const completion = [];
const calls = [];
const options = {
  origin,
  createChallenge: async (signal) => {
    assert.equal(signal.aborted, false);
    return createDirectProviderLogin(origin, { signal, fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true, challenge }));
    } });
  },
  approve: async (value) => ({
    requestRef: value.requestRef, approved: true, scopedUserId: account.scopedUserId,
    launchReadiness: { version: 1, launchToken, expiresAtMs: Date.now() + 30_000 },
  }),
  exchange: async (value, signal) => {
    await exchangeDirectProviderLogin(origin, value.requestRef, { signal, fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true }));
    } });
    return account;
  },
  initialize: async (value) => ({ ...value, displayName: 'Initialized' }),
  complete: async (payload) => { completion.push(payload); return { completed: true }; },
};
assert.deepEqual(await runMiniappLogin(options), { ...account, displayName: 'Initialized' });
assert.deepEqual(completion, [{ requestRef: challenge.requestRef, launchToken, state: 'ready', stage: 'initial_status', outcome: 'success' }]);
assert.ok(calls.every(({ init }) => init.credentials === 'same-origin' && init.cache === 'no-store' && init.redirect === 'error'));
assert.deepEqual(JSON.parse(calls[1].init.body), { requestRef: challenge.requestRef });
completion.length = 0;
await assert.rejects(runMiniappLogin({ ...options, initialize: async () => ({ scopedUserId: 'wrong' }) }), /miniapp_login_account_mismatch/);
assert.deepEqual(completion, [{ requestRef: challenge.requestRef, launchToken, state: 'failed', stage: 'initial_status', outcome: 'unavailable' }]);
completion.length = 0;
await assert.rejects(runMiniappLogin({ ...options, complete: async (payload) => { completion.push(payload); return { success: true }; } }), /miniapp_login_complete_unconfirmed/);
assert.equal(completion.length, 1);
await assert.rejects(runMiniappLogin({ ...options, approve: async () => ({ requestRef: challenge.requestRef, approved: true, scopedUserId: account.scopedUserId, launchReadiness: { version: 1, launchToken: 'invalid', expiresAtMs: Date.now() + 30_000 } }) }), /miniapp_login_approval_invalid/);
await assert.rejects(runMiniappLogin({ ...options, approve: async () => ({ requestRef: challenge.requestRef, approved: true, scopedUserId: account.scopedUserId, launchReadiness: { version: 1, launchToken, expiresAtMs: Date.now() + 60_000 } }) }), /miniapp_login_approval_invalid/);
assert.equal(createUnetServiceManifest({ serviceId: 'shop', origin }).miniapp, undefined);
assert.deepEqual(createUnetServiceManifest({ serviceId: 'shop', origin, miniappLaunchReadiness: true }).miniapp, { launchReadinessVersion: 1 });

writeFileSync(`artifacts/${version}-miniapp-consumer-receipt.json`, `${JSON.stringify({
  version, status: 'passed', runtime: process.version, consumer,
  limitation: 'Exact canonical tarballs extracted; external dependencies reused from installed SDK, not a fresh package-manager install or registry provenance verification.',
  checks: ['sha256', 'file-inventory', 'rc-version-alignment', 'published-compatible-internal-ranges', 'dependency-closure', 'four-esm-imports', 'browser-cookie-exchange', 'helper-ready', 'ready-acknowledgement-required', 'readiness-64hex-token', 'readiness-expiry-cap', 'authoritative-account-mismatch', 'manifest-opt-in'],
  artifacts: manifest.artifacts,
}, null, 2)}\n`);
console.log('Exact miniapp candidate tarballs, dependency ranges, hashes and packed smoke passed.');

#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createProviderSetup, type ProviderSetupManifest } from './index.js';

const args = process.argv.slice(2);
if (args[0] !== 'configure') throw new Error('usage: unet-setup configure --manifest <file> --out <env-file> --public-out <registration-file> [--issuer-id <id>] [--database-url <url>] [--session-secret <secret>]');
const option = (name: string): string => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`setup_option_required:${name}`);
  return args[index + 1]!;
};
const manifestPath = option('--manifest');
const envPath = option('--out');
const publicPath = option('--public-out');
const optional = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ProviderSetupManifest;
const result = await createProviderSetup({
  ...manifest,
  publicIssuerId: optional('--issuer-id') ?? manifest.publicIssuerId,
  databaseUrl: optional('--database-url'),
  sessionSecret: optional('--session-secret'),
});
await writeFile(envPath, result.env, { encoding: 'utf8', mode: 0o600 });
await writeFile(publicPath, `${JSON.stringify(result.publicRegistration, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
console.log(JSON.stringify({ success: true, envPath, publicPath, serviceId: manifest.serviceId }));

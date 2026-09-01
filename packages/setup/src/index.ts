import { createECDH, createHash, createPrivateKey, createPublicKey, randomBytes, sign } from 'node:crypto';
import { generateAttestationIssuerEnv, generateDomainAdminSignerEnv } from '@union-networks/issuer';

export const PROVIDER_SETUP_SCHEMA_VERSION = 1 as const;

export type ProviderSetupCapability = 'direct_login' | 'public_issuer' | 'domain_admin' | 'official_messaging' | 'operational_metrics';

export interface ProviderSetupManifest {
  schemaVersion: typeof PROVIDER_SETUP_SCHEMA_VERSION;
  serviceId: string;
  origin: string;
  controlPlaneUrl: string;
  claim?: { claimId: string; challenge: string; claimToken?: string };
  ledger: {
    chainId: number;
    attestationLedgerAddress: string;
    issuerRegistryAddress: string;
    readUrl: string;
    relayerUrls: string[];
  };
  capabilities: ProviderSetupCapability[];
  publicIssuerId?: string;
  messagingAutomationKey?: string;
  providerMetricsKey?: string;
}

export interface PublicIssuerRegistration {
  issuerId: string;
  keyId: string;
  publicKeyPem: string;
  credentialKeyId: string;
  credentialPublicKeyPem: string;
  credentialPublicKeyHash: string;
  ledgerKeyId: string;
  ledgerAddress: string;
  proofOfPossession: string;
  credentialProofOfPossession: string;
  ledgerPublicKeyPem: string;
  ledgerProofOfPossession: string;
}

export interface PublicDomainAdminRegistration {
  issuerId: string;
  keyId: string;
  publicKeyPem: string;
  credentialKeyId: string;
  credentialPublicKeyPem: string;
  credentialPublicKeyHash: string;
  ledgerKeyId: string;
  ledgerAddress: string;
  callbackUrl: string;
  proofOfPossession: string;
  credentialProofOfPossession: string;
  ledgerPublicKeyPem: string;
  ledgerProofOfPossession: string;
}

export interface ProviderPublicRegistrationBundle {
  schemaVersion: 1;
  serviceId: string;
  origin: string;
  generatedAt: string;
  publicIssuer?: PublicIssuerRegistration;
  domainAdmin?: PublicDomainAdminRegistration;
}

export interface ProviderSetupOutput {
  env: string;
  publicRegistration: ProviderPublicRegistrationBundle;
}

const clean = (value: string, field: string): string => {
  const result = value.trim();
  if (!result || /[\r\n\0]/.test(result)) throw new Error(`provider_setup_${field}_invalid`);
  return result;
};

const parseOrigin = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value.replace(/\/+$/, '')) throw new Error('provider_setup_origin_invalid');
  return url.origin;
};

export function validateProviderSetupManifest(value: ProviderSetupManifest): ProviderSetupManifest {
  if (!value || value.schemaVersion !== 1) throw new Error('provider_setup_schema_unsupported');
  const serviceId = clean(value.serviceId, 'service_id');
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(serviceId)) throw new Error('provider_setup_service_id_invalid');
  const origin = parseOrigin(value.origin);
  const controlPlaneUrl = parseOrigin(value.controlPlaneUrl);
  if (!Number.isSafeInteger(value.ledger?.chainId) || value.ledger.chainId <= 0) throw new Error('provider_setup_chain_id_invalid');
  for (const address of [value.ledger.attestationLedgerAddress, value.ledger.issuerRegistryAddress]) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error('provider_setup_contract_address_invalid');
  }
  const readUrl = parseOrigin(value.ledger.readUrl);
  const relayerUrls = value.ledger.relayerUrls.map(parseOrigin);
  if (!relayerUrls.length) throw new Error('provider_setup_relayer_required');
  if (value.claim && (!value.claim.claimId || !value.claim.challenge)) throw new Error('provider_setup_claim_incomplete');
  return { ...value, serviceId, origin, controlPlaneUrl, ledger: { ...value.ledger, readUrl, relayerUrls } };
}

export function dotenvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@,+\-=]+$/.test(value)) return value;
  return JSON.stringify(value.replace(/\r\n/g, '\n'));
}

export function serializeDotenv(entries: Array<[string, string | undefined]>, heading?: string): string {
  const lines = heading ? [`# ${heading}`] : [];
  for (const [name, value] of entries) {
    if (value === undefined || value === '') continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('provider_setup_env_name_invalid');
    lines.push(`${name}=${dotenvValue(value)}`);
  }
  return lines.join('\n');
}

const parseEnvBlock = (block: string): Record<string, string> => Object.fromEntries(block.split(/\r?\n/).filter(Boolean).map((line) => {
  const separator = line.indexOf('=');
  const name = line.slice(0, separator);
  const raw = line.slice(separator + 1);
  let value = raw;
  if (raw.startsWith('"')) value = JSON.parse(raw) as string;
  return [name, value];
}));

const possessionPayload = (fields: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))));
const possession = (fields: Record<string, string>, privateKeyPem: string, algorithm: null | 'sha256' = null): string => sign(algorithm, Buffer.from(possessionPayload(fields)), createPrivateKey(privateKeyPem)).toString('base64url');
const ledgerKeyPair = (privateKeyHex: string) => {
  const secret = Buffer.from(privateKeyHex.replace(/^0x/, ''), 'hex');
  if (secret.length !== 32) throw new Error('provider_setup_ledger_private_key_invalid');
  const ecdh = createECDH('secp256k1');
  ecdh.setPrivateKey(secret);
  const publicKey = ecdh.getPublicKey(undefined, 'uncompressed');
  const prefix = Buffer.from('308184020100301006072a8648ce3d020106052b8104000a046d306b0201010420', 'hex');
  const suffix = Buffer.from('a144034200', 'hex');
  const privateKey = createPrivateKey({ key: Buffer.concat([prefix, secret, suffix, publicKey]), format: 'der', type: 'pkcs8' });
  return { privateKey, publicKeyPem: createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString() };
};

export async function createProviderSetup(input: ProviderSetupManifest & { databaseUrl?: string; sessionSecret?: string }): Promise<ProviderSetupOutput> {
  const manifest = validateProviderSetupManifest(input);
  const sections: string[] = [];
  const base: Array<[string, string | undefined]> = [
    ['UNET_PROVIDER_SERVICE_ID', manifest.serviceId],
    ['UNET_PROVIDER_ORIGIN', manifest.origin],
    ['UNET_PROVIDER_DATABASE_URL', input.databaseUrl],
    ['UNET_PROVIDER_SESSION_SECRET', input.sessionSecret ?? (manifest.capabilities.includes('direct_login') ? randomBytes(32).toString('base64url') : undefined)],
    ['UNET_PROVIDER_CLAIM_ID', manifest.claim?.claimId],
    ['UNET_PROVIDER_CLAIM_CHALLENGE', manifest.claim?.challenge],
    ['UNET_PROVIDER_CLAIM_TOKEN', manifest.claim?.claimToken],
    ['UNET_CONTROL_PLANE_URL', manifest.controlPlaneUrl],
  ];
  sections.push(serializeDotenv(base, 'U-net provider'));
  sections.push(serializeDotenv([
    ['LEDGER_V2_CHAIN_ID', String(manifest.ledger.chainId)],
    ['LEDGER_V2_CONTRACT_ADDRESS', manifest.ledger.attestationLedgerAddress],
    ['LEDGER_V2_ISSUER_REGISTRY_ADDRESS', manifest.ledger.issuerRegistryAddress],
    ['LEDGER_V2_READ_URL', manifest.ledger.readUrl],
    ['LEDGER_V2_RELAYER_URLS', manifest.ledger.relayerUrls.join(',')],
  ], 'U-net Ledger V2'));

  const publicRegistration: ProviderPublicRegistrationBundle = { schemaVersion: 1, serviceId: manifest.serviceId, origin: manifest.origin, generatedAt: new Date().toISOString() };
  if (manifest.capabilities.includes('public_issuer')) {
    const issuerId = manifest.publicIssuerId ?? `issuer:${manifest.serviceId}`;
    const generated = await generateAttestationIssuerEnv({ serviceId: manifest.serviceId, issuerId });
    const parsed = parseEnvBlock(generated.env);
    const ledger = ledgerKeyPair(parsed.UNET_ISSUER_LEDGER_PRIVATE_KEY!);
    const credentialFields = { issuerId, credentialKeyId: generated.credentialKeyId, credentialPublicKeyHash: generated.credentialPublicKeyHash };
    const ledgerFields = { issuerId, ledgerKeyId: generated.ledgerKeyId, ledgerAddress: generated.ledgerAddress };
    sections.push(`# Public attestation issuer\n${generated.env}`);
    publicRegistration.publicIssuer = {
      issuerId, keyId: generated.keyId, publicKeyPem: generated.publicKeyPem,
      credentialKeyId: generated.credentialKeyId, credentialPublicKeyPem: generated.credentialPublicKeyPem,
      credentialPublicKeyHash: generated.credentialPublicKeyHash, ledgerKeyId: generated.ledgerKeyId,
      ledgerAddress: generated.ledgerAddress,
      proofOfPossession: possession({ issuerId, keyId: generated.keyId, ledgerAddress: generated.ledgerAddress, credentialPublicKeyHash: generated.credentialPublicKeyHash }, parsed.UNET_ISSUER_PRIVATE_KEY_PEM!),
      credentialProofOfPossession: possession(credentialFields, parsed.UNET_ISSUER_CREDENTIAL_PRIVATE_KEY_PEM!, 'sha256'),
      ledgerPublicKeyPem: ledger.publicKeyPem,
      ledgerProofOfPossession: sign('sha256', Buffer.from(possessionPayload(ledgerFields)), ledger.privateKey).toString('base64url'),
    };
  }
  if (manifest.capabilities.includes('domain_admin')) {
    const generated = await generateDomainAdminSignerEnv({ serviceId: manifest.serviceId });
    const parsed = parseEnvBlock(generated.env);
    const ledger = ledgerKeyPair(parsed.UNET_DOMAIN_ADMIN_LEDGER_PRIVATE_KEY!);
    const issuerId = `domain:${manifest.serviceId}`;
    const credentialFields = { issuerId, credentialKeyId: generated.credentialKeyId, credentialPublicKeyHash: generated.credentialPublicKeyHash };
    const ledgerFields = { issuerId, ledgerKeyId: generated.ledgerKeyId, ledgerAddress: generated.ledgerAddress };
    sections.push(`# Domain Owner and Admin issuer\n${generated.env}`);
    publicRegistration.domainAdmin = {
      issuerId, keyId: generated.keyId, publicKeyPem: generated.publicKeyPem,
      credentialKeyId: generated.credentialKeyId, credentialPublicKeyHash: generated.credentialPublicKeyHash,
      credentialPublicKeyPem: generated.credentialPublicKeyPem,
      ledgerKeyId: generated.ledgerKeyId, ledgerAddress: generated.ledgerAddress,
      callbackUrl: `${manifest.origin}/api/unet/domain-admin/issue`,
      proofOfPossession: possession({ issuerId, keyId: generated.keyId, ledgerAddress: generated.ledgerAddress, credentialPublicKeyHash: generated.credentialPublicKeyHash }, parsed.UNET_DOMAIN_ADMIN_PRIVATE_KEY_PEM!),
      credentialProofOfPossession: possession(credentialFields, parsed.UNET_DOMAIN_ADMIN_CREDENTIAL_PRIVATE_KEY_PEM!, 'sha256'),
      ledgerPublicKeyPem: ledger.publicKeyPem,
      ledgerProofOfPossession: sign('sha256', Buffer.from(possessionPayload(ledgerFields)), ledger.privateKey).toString('base64url'),
    };
  }
  if (manifest.messagingAutomationKey) sections.push(serializeDotenv([['UNET_MESSAGING_AUTOMATION_KEY', manifest.messagingAutomationKey]], 'Official messaging'));
  if (manifest.providerMetricsKey) sections.push(serializeDotenv([['UNET_PROVIDER_METRICS_KEY', manifest.providerMetricsKey]], 'Provider analytics'));
  return { env: `${sections.filter(Boolean).join('\n\n')}\n`, publicRegistration };
}

export interface CanonicalProviderEnvironment {
  serviceId: string;
  origin: string;
  databaseUrl?: string;
  sessionSecret?: string;
  claimId?: string;
  claimChallenge?: string;
  claimToken?: string;
  controlPlaneUrl: string;
  ledger?: {
    chainId: number;
    attestationLedgerAddress: string;
    issuerRegistryAddress: string;
    readUrl: string;
    relayerUrls: string[];
  };
  messagingAutomationKey?: string;
  providerMetricsKey?: string;
}

export const PROVIDER_ENVIRONMENT_SCHEMA_VERSION = 1 as const;
export const PROVIDER_ENVIRONMENT_VARIABLES = [
  { name: 'UNET_PROVIDER_SERVICE_ID', group: 'base', required: true, sensitivity: 'public' },
  { name: 'UNET_PROVIDER_ORIGIN', group: 'base', required: true, sensitivity: 'public' },
  { name: 'UNET_PROVIDER_DATABASE_URL', group: 'login', required: true, sensitivity: 'secret' },
  { name: 'UNET_PROVIDER_SESSION_SECRET', group: 'login', required: true, sensitivity: 'secret' },
  { name: 'UNET_PROVIDER_CLAIM_ID', group: 'claim', required: true, sensitivity: 'public' },
  { name: 'UNET_PROVIDER_CLAIM_CHALLENGE', group: 'claim', required: true, sensitivity: 'public' },
  { name: 'UNET_PROVIDER_CLAIM_TOKEN', group: 'claim', required: true, sensitivity: 'secret' },
  { name: 'UNET_CONTROL_PLANE_URL', group: 'base', required: true, sensitivity: 'public' },
  { name: 'LEDGER_V2_CHAIN_ID', group: 'ledger', required: false, sensitivity: 'public' },
  { name: 'LEDGER_V2_CONTRACT_ADDRESS', group: 'ledger', required: false, sensitivity: 'public' },
  { name: 'LEDGER_V2_ISSUER_REGISTRY_ADDRESS', group: 'ledger', required: false, sensitivity: 'public' },
  { name: 'LEDGER_V2_READ_URL', group: 'ledger', required: false, sensitivity: 'public' },
  { name: 'LEDGER_V2_RELAYER_URLS', group: 'ledger', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_ID', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_KEY_ID', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_PRIVATE_KEY_PEM', group: 'issuer', required: false, sensitivity: 'secret' },
  { name: 'UNET_ISSUER_PUBLIC_KEY_PEM', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_CREDENTIAL_KEY_ID', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_CREDENTIAL_PRIVATE_KEY_PEM', group: 'issuer', required: false, sensitivity: 'secret' },
  { name: 'UNET_ISSUER_CREDENTIAL_PUBLIC_KEY_PEM', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_CREDENTIAL_PUBLIC_KEY_HASH', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_LEDGER_KEY_ID', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_LEDGER_PRIVATE_KEY', group: 'issuer', required: false, sensitivity: 'secret' },
  { name: 'UNET_ISSUER_LEDGER_ADDRESS', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_ISSUER_LEDGER_KEY_EPOCH', group: 'issuer', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_ISSUER_ID', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_KEY_ID', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_PRIVATE_KEY_PEM', group: 'domain_admin', required: false, sensitivity: 'secret' },
  { name: 'UNET_DOMAIN_ADMIN_PUBLIC_KEY_PEM', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_CREDENTIAL_KEY_ID', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_CREDENTIAL_PRIVATE_KEY_PEM', group: 'domain_admin', required: false, sensitivity: 'secret' },
  { name: 'UNET_DOMAIN_ADMIN_CREDENTIAL_PUBLIC_KEY_PEM', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_CREDENTIAL_PUBLIC_KEY_HASH', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_LEDGER_KEY_ID', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_LEDGER_PRIVATE_KEY', group: 'domain_admin', required: false, sensitivity: 'secret' },
  { name: 'UNET_DOMAIN_ADMIN_LEDGER_ADDRESS', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_DOMAIN_ADMIN_LEDGER_KEY_EPOCH', group: 'domain_admin', required: false, sensitivity: 'public' },
  { name: 'UNET_MESSAGING_AUTOMATION_KEY', group: 'messaging', required: false, sensitivity: 'secret' },
  { name: 'UNET_PROVIDER_METRICS_KEY', group: 'analytics', required: false, sensitivity: 'secret' },
] as const;

const warned = new Set<string>();
const legacy = (env: Record<string, string | undefined>, canonical: string, aliases: string[]): string | undefined => {
  if (env[canonical]?.trim()) return env[canonical]!.trim();
  for (const alias of aliases) {
    if (!env[alias]?.trim()) continue;
    if (!warned.has(alias)) {
      warned.add(alias);
      process.emitWarning(`${alias} is deprecated; use ${canonical}`, { code: 'UNET_ENV_ALIAS_DEPRECATED' });
    }
    return env[alias]!.trim();
  }
  return undefined;
};

export function readCanonicalProviderEnvironment(env: Record<string, string | undefined> = process.env): CanonicalProviderEnvironment {
  const serviceId = legacy(env, 'UNET_PROVIDER_SERVICE_ID', ['NEXT_PUBLIC_UNET_SERVICE_ID']);
  const origin = legacy(env, 'UNET_PROVIDER_ORIGIN', ['NEXT_PUBLIC_SITE_ORIGIN', 'NEXT_PUBLIC_UNET_ORIGIN']);
  if (!serviceId || !origin) throw new Error('unet_provider_identity_environment_required');
  const normalizedOrigin = new URL(origin).origin;
  if (normalizedOrigin !== origin.replace(/\/+$/, '') || !normalizedOrigin.startsWith('https://')) throw new Error('unet_provider_origin_invalid');
  const chainId = Number(env.LEDGER_V2_CHAIN_ID ?? 0);
  const attestationLedgerAddress = env.LEDGER_V2_CONTRACT_ADDRESS?.trim();
  const issuerRegistryAddress = env.LEDGER_V2_ISSUER_REGISTRY_ADDRESS?.trim();
  const readUrl = env.LEDGER_V2_READ_URL?.trim();
  const relayerUrls = (env.LEDGER_V2_RELAYER_URLS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const hasLedger = Boolean(chainId || attestationLedgerAddress || issuerRegistryAddress || readUrl || relayerUrls.length);
  if (hasLedger && (!Number.isSafeInteger(chainId) || chainId <= 0 || !attestationLedgerAddress || !issuerRegistryAddress || !readUrl || !relayerUrls.length)) throw new Error('unet_provider_ledger_environment_incomplete');
  return {
    serviceId,
    origin: normalizedOrigin,
    databaseUrl: env.UNET_PROVIDER_DATABASE_URL?.trim(),
    sessionSecret: env.UNET_PROVIDER_SESSION_SECRET?.trim(),
    claimId: env.UNET_PROVIDER_CLAIM_ID?.trim(),
    claimChallenge: env.UNET_PROVIDER_CLAIM_CHALLENGE?.trim(),
    claimToken: env.UNET_PROVIDER_CLAIM_TOKEN?.trim(),
    controlPlaneUrl: legacy(env, 'UNET_CONTROL_PLANE_URL', ['NEXT_PUBLIC_UNET_ISSUER_BASE', 'NEXT_PUBLIC_UNET_ISSUER_BASE_URL']) ?? 'https://issuer.egress.live',
    ...(hasLedger ? { ledger: { chainId, attestationLedgerAddress: attestationLedgerAddress!, issuerRegistryAddress: issuerRegistryAddress!, readUrl: readUrl!, relayerUrls } } : {}),
    messagingAutomationKey: legacy(env, 'UNET_MESSAGING_AUTOMATION_KEY', ['UNET_OFFICIAL_MESSAGING_AUTOMATION_KEY']),
    providerMetricsKey: env.UNET_PROVIDER_METRICS_KEY?.trim(),
  };
}

export function requireProviderClaimEnvironment(env: Record<string, string | undefined> = process.env) {
  const provider = readCanonicalProviderEnvironment(env);
  if (!provider.claimId || !provider.claimChallenge || !provider.claimToken) throw new Error('unet_provider_claim_environment_incomplete');
  return { serviceId: provider.serviceId, origin: provider.origin, claimId: provider.claimId, challenge: provider.claimChallenge, claimToken: provider.claimToken };
}

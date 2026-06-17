import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export interface WebLoginAssertionClaims { iss?: string; aud?: string; serviceId?: string; scopedUserId?: string; sessionId?: string; issuedAtIso?: string; expiresAtIso?: string; iat?: number; exp?: number; }
export interface VerifyLoginAssertionOptions { secret: string; serviceId?: string; now?: Date; }

export interface UnetProviderClaimOptions {
  serviceId: string;
  origin: string;
  claimId: string;
  challenge: string;
  claimToken: string;
}

export interface UnetProviderClaimResponse {
  serviceId: string;
  origin: string;
  claimId: string;
  challenge: string;
  proof: string;
}

export interface UnetMiniappManifestOptions {
  serviceId: string;
  name: string;
  provider: string;
  description?: string;
  category?: string;
  icon?: string;
  origin: string;
  launchUrl: string;
  permissions?: string[];
  notificationCategories?: string[];
  domainClaim?: UnetProviderClaimOptions;
}

export interface UnetMiniappManifest {
  serviceId: string;
  name: string;
  provider: string;
  description: string;
  category: string;
  icon?: string;
  launchUrl: string;
  permissions: string[];
  notificationCategories: string[];
  domainClaim?: UnetProviderClaimResponse;
}

const base64UrlToBuffer = (value: string): Buffer => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const normalizeOrigin = (origin: string): string => new URL(origin).origin;

export function verifyLoginAssertion(assertionJws: string, options: VerifyLoginAssertionOptions): WebLoginAssertionClaims {
  const [header, payload, signature] = assertionJws.split('.');
  if (!header || !payload || !signature) throw new Error('invalid_login_assertion_format');
  const expected = createHmac('sha256', options.secret).update(`${header}.${payload}`).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) throw new Error('invalid_login_assertion_signature');
  const claims = JSON.parse(base64UrlToBuffer(payload).toString('utf8')) as WebLoginAssertionClaims;
  if (options.serviceId && claims.serviceId !== options.serviceId) throw new Error('invalid_login_assertion_audience');
  const now = options.now ?? new Date();
  const expiresAt = typeof claims.expiresAtIso === 'string' ? Date.parse(claims.expiresAtIso) : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) throw new Error('login_assertion_expired');
  if (!claims.scopedUserId || !claims.sessionId) throw new Error('invalid_login_assertion_claims');
  return claims;
}

export function createUnetProviderClaim(options: UnetProviderClaimOptions): UnetProviderClaimResponse {
  const origin = normalizeOrigin(options.origin);
  const tokenHash = createHash('sha256').update(options.claimToken).digest('hex');
  const message = `${options.claimId}.${options.serviceId}.${origin}.${options.challenge}`;
  const proof = createHmac('sha256', tokenHash).update(message).digest('base64url');
  return {
    serviceId: options.serviceId,
    origin,
    claimId: options.claimId,
    challenge: options.challenge,
    proof,
  };
}

export function createUnetProviderClaimHandler(options: UnetProviderClaimOptions): () => UnetProviderClaimResponse {
  return () => createUnetProviderClaim(options);
}

export function createUnetMiniappManifest(options: UnetMiniappManifestOptions): UnetMiniappManifest {
  const origin = normalizeOrigin(options.origin);
  const launchUrl = new URL(options.launchUrl, origin);
  if (launchUrl.origin !== origin) throw new Error('launch_url_origin_mismatch');
  return {
    serviceId: options.serviceId,
    name: options.name,
    provider: options.provider,
    description: options.description ?? '',
    category: options.category ?? 'service',
    ...(options.icon ? { icon: options.icon } : {}),
    launchUrl: launchUrl.toString(),
    permissions: options.permissions ?? ['identity.scoped'],
    notificationCategories: options.notificationCategories ?? [],
    ...(options.domainClaim ? { domainClaim: createUnetProviderClaim(options.domainClaim) } : {}),
  };
}

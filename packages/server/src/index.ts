import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebLoginAssertionClaims { iss?: string; aud?: string; serviceId?: string; scopedUserId?: string; sessionId?: string; issuedAtIso?: string; expiresAtIso?: string; iat?: number; exp?: number; }
export interface VerifyLoginAssertionOptions { secret: string; serviceId?: string; now?: Date; }

const base64UrlToBuffer = (value: string): Buffer => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

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

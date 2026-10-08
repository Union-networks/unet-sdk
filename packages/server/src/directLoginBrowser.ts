import { createHash, randomBytes } from 'node:crypto';

/** @public */
export function directLoginBrowserCookieName(requestRef: string): string {
  if (!/^login_[A-Za-z0-9_-]{24}$/.test(requestRef)) throw new Error('direct_login_request_ref_invalid');
  return `__Host-unet-login-${createHash('sha256').update(requestRef).digest('hex').slice(0, 24)}`;
}

/** @public */
export const createDirectLoginRedemptionSecret = (): string => randomBytes(32).toString('base64url');

/** @public */
export function directLoginBrowserCookie(requestRef: string, secret: string, maxAge = 120): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('direct_login_browser_unauthorized');
  return `${directLoginBrowserCookieName(requestRef)}=${secret}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.min(600, Math.floor(maxAge)))}`;
}

/** @public */
export function readDirectLoginBrowserSecret(request: Request, requestRef: string): string {
  const name = directLoginBrowserCookieName(requestRef);
  const values = (request.headers.get('cookie') ?? '').split(';').map((cookie) => cookie.trim()).filter((cookie) => cookie.startsWith(`${name}=`));
  if (values.length !== 1) throw new Error('direct_login_browser_unauthorized');
  const secret = values[0]!.slice(name.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('direct_login_browser_unauthorized');
  return secret;
}

/** Browser mutations require Origin; native wallet approval is separately signed.
 * @public
 */
export function assertDirectLoginBrowserOrigin(request: Request, origin: string, mutation: boolean): void {
  const expected = new URL(origin).origin;
  if (!expected.startsWith('https://') || new URL(request.url).origin !== expected) throw new Error('direct_login_origin_mismatch');
  const supplied = request.headers.get('origin');
  if ((mutation && !supplied) || (supplied !== null && supplied !== expected)) throw new Error('direct_login_origin_mismatch');
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new Error('direct_login_origin_mismatch');
  if (mutation && !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('direct_login_content_type_invalid');
}

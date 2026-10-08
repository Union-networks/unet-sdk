import { describe, expect, it } from 'vitest';
import { createDirectProviderLogin, exchangeDirectProviderLogin, getDirectProviderLogin, isDirectProviderLoginApproved, renderDirectLoginQrPayload } from './index.js';

describe('@u-net/web-login', () => {
  it('renders a login QR payload and detects approval', () => {
    const challenge = { protocolVersion: 2 as const, requestRef: 'r', serviceId: 'svc', origin: 'https://x.test', challenge: 'c', challengeUrl: 'https://x.test/api/unet/login/challenge/r', approvalUrl: 'https://x.test/api/unet/login/approval', expiresAtIso: 'later' };
    expect(renderDirectLoginQrPayload(challenge)).toContain('unet://service-login');
    expect(isDirectProviderLoginApproved({ state: 'approved' })).toBe(true);
  });

  it('uses same-origin cookies and exchanges request references, not session IDs', async () => {
    const challenge = { protocolVersion: 2, requestRef: 'login_ref', origin: 'https://shop.example' };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = String(url).includes('challenge') ? { success: true, challenge } : String(url).includes('status') ? { success: true, state: 'approved' } : { success: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    expect(await createDirectProviderLogin(challenge.origin, { fetchImpl })).toEqual(challenge);
    expect(await getDirectProviderLogin(challenge.origin, challenge.requestRef, { fetchImpl })).toMatchObject({ state: 'approved' });
    await exchangeDirectProviderLogin(challenge.origin, challenge.requestRef, { fetchImpl });
    expect(calls.every((call) => call.init?.credentials === 'same-origin')).toBe(true);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ requestRef: 'login_ref' });
    expect(JSON.stringify(calls)).not.toContain('sessionId');
  });
});

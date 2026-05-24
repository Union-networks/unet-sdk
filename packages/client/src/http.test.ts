import { describe, expect, it } from 'vitest';
import { UnetApiError, UnetContractError, createUnetClient } from './index.js';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('UnetClient', () => {
  it('creates and polls a login session', async () => {
    const fetchImpl = async () => jsonResponse({ success: true, sessionId: 's1', requestRef: 'r1', serviceId: 'svc', origin: 'https://example.test', status: 'approved', scopedUserId: 'm_svc_1', assertionJws: 'jwt', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now()+1000).toISOString() });
    const client = createUnetClient({ issuerBaseUrl: 'https://issuer.test', fetchImpl });
    await expect(client.getLoginSession('s1')).resolves.toMatchObject({ status: 'approved', scopedUserId: 'm_svc_1' });
  });
  it('throws API errors', async () => {
    const client = createUnetClient({ fetchImpl: async () => jsonResponse({ success: false, errorCode: 'bad_request', message: 'nope' }, 400) });
    await expect(client.getLoginSession('missing')).rejects.toBeInstanceOf(UnetApiError);
  });
  it('throws contract errors for malformed success payloads', async () => {
    const client = createUnetClient({ fetchImpl: async () => jsonResponse({ success: true }) });
    await expect(client.getLoginSession('bad')).rejects.toBeInstanceOf(UnetContractError);
  });
});

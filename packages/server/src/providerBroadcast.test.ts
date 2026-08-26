import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProviderBroadcastHandler } from './providerBroadcast.js';

describe('provider broadcast handler', () => {
  it('accepts an Ed25519-signed provider-owned broadcast and rejects tampering', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const timestamp = new Date().toISOString();
    const rawBody = JSON.stringify({
      protocolVersion: 2,
      serviceId: 'shop',
      idempotencyKey: 'event_1',
      category: 'service',
      pushTitle: 'Update',
      content: { title: 'Ready' },
    });
    const canonical = Buffer.from(`unet-provider-broadcast-v2\nshop\n${timestamp}\n${createHash('sha256').update(rawBody).digest('hex')}`);
    const signature = sign(null, canonical, privateKey).toString('base64url');
    const handler = createProviderBroadcastHandler({
      serviceId: 'shop',
      dashboardPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      dispatch: async () => ({ delivered: 2, storedWithoutPush: 1, blocked: 0, missingKey: 0, failed: 0 }),
    });
    const headers = { 'x-unet-timestamp': timestamp, 'x-unet-signature-algorithm': 'ed25519', 'x-unet-signature': signature };
    const accepted = await handler(new Request('https://shop.example/api/unet/official-messaging/broadcast', { method: 'POST', headers, body: rawBody }));
    expect(accepted.status).toBe(200);
    const rejected = await handler(new Request('https://shop.example/api/unet/official-messaging/broadcast', { method: 'POST', headers, body: `${rawBody} ` }));
    expect(rejected.status).toBe(401);
  });

  it('claims idempotency before dispatching', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const timestamp = new Date().toISOString();
    const rawBody = JSON.stringify({ protocolVersion: 2, serviceId: 'shop', idempotencyKey: 'event_2', category: 'service', pushTitle: 'Update', content: { title: 'Done' } });
    const canonical = Buffer.from(`unet-provider-broadcast-v2\nshop\n${timestamp}\n${createHash('sha256').update(rawBody).digest('hex')}`);
    const signature = sign(null, canonical, privateKey).toString('base64url');
    let claimed = false;
    let dispatches = 0;
    const handler = createProviderBroadcastHandler({
      serviceId: 'shop',
      dashboardPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      claimIdempotency: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      dispatch: async () => {
        dispatches += 1;
        return { delivered: 1, storedWithoutPush: 0, blocked: 0, missingKey: 0, failed: 0 };
      },
    });
    const headers = { 'x-unet-timestamp': timestamp, 'x-unet-signature-algorithm': 'ed25519', 'x-unet-signature': signature };
    const makeRequest = () => new Request('https://shop.example/api/unet/official-messaging/broadcast', { method: 'POST', headers, body: rawBody });

    expect((await handler(makeRequest())).status).toBe(200);
    expect(await (await handler(makeRequest())).json()).toMatchObject({ success: true, duplicate: true });
    expect(dispatches).toBe(1);
  });
});

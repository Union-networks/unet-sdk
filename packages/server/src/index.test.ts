import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyLoginAssertion } from './index.js';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (payload: unknown, secret = 's') => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload); const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url'); return `${h}.${p}.${sig}`; };

describe('@unet/server', () => {
  it('verifies valid assertions and rejects tampering', () => {
    const assertion = sign({ serviceId: 'svc', scopedUserId: 'm_svc_1', sessionId: 'sess', expiresAtIso: new Date(Date.now()+10000).toISOString() });
    expect(verifyLoginAssertion(assertion, { secret: 's', serviceId: 'svc' }).scopedUserId).toBe('m_svc_1');
    expect(() => verifyLoginAssertion(assertion.replace(/.$/, 'x'), { secret: 's' })).toThrow();
  });
});

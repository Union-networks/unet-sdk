import { describe, expect, it } from 'vitest';
import { isDirectProviderLoginApproved, renderDirectLoginQrPayload } from './index.js';

describe('@u-net/web-login', () => {
  it('renders a login QR payload and detects approval', () => {
    const challenge = { protocolVersion: 2 as const, requestRef: 'r', serviceId: 'svc', origin: 'https://x.test', challenge: 'c', challengeUrl: 'https://x.test/api/unet/login/challenge/r', approvalUrl: 'https://x.test/api/unet/login/approval', expiresAtIso: 'later' };
    expect(renderDirectLoginQrPayload(challenge)).toContain('unet://service-login');
    expect(isDirectProviderLoginApproved({ state: 'approved', session: { sessionId: 's', requestRef: 'r', scopedUserId: 'u', expiresAtIso: 'later' } })).toBe(true);
  });
});

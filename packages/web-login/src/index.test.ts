import { describe, expect, it } from 'vitest';
import { isApprovedLoginResult, renderLoginQrPayload } from './index.js';

describe('@unet/web-login', () => {
  it('renders a login QR payload and detects approval', () => {
    const session = { success: true as const, sessionId: 's', requestRef: 'r', serviceId: 'svc', origin: 'https://x.test', status: 'approved' as const, scopedUserId: 'm_svc_1', assertionJws: 'jwt', createdAt: 'now', expiresAt: 'later' };
    expect(renderLoginQrPayload(session)).toContain('unet://web-login');
    expect(isApprovedLoginResult(session)).toBe(true);
  });
});

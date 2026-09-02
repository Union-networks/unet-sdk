import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnetLoginQr, UnetVerificationStatus } from './index.js';

describe('@u-net/react', () => {
  it('renders login QR and verification status components', () => {
    const html = renderToStaticMarkup(<><UnetLoginQr challenge={{ protocolVersion: 2, requestRef: 'r', serviceId: 'svc', origin: 'https://x.test', challenge: 'c', challengeUrl: 'https://x.test/api/unet/login/challenge/r', approvalUrl: 'https://x.test/api/unet/login/approval', expiresAtIso: 'later' }} /><UnetVerificationStatus result={{ sessionId: 'v', status: 'verified', checkedAt: 'now', expiresAt: 'later', aggregateOutcome: 'passed' }} /></>);
    expect(html).toContain('unet://service-login');
    expect(html).toContain('passed');
  });
});

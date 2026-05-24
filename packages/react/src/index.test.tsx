import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnetLoginQr, UnetVerificationStatus } from './index.js';

describe('@unet/react', () => {
  it('renders login QR and verification status components', () => {
    const html = renderToStaticMarkup(<><UnetLoginQr session={{ success: true, sessionId: 's', requestRef: 'r', serviceId: 'svc', origin: 'https://x.test', status: 'pending', qrDataUrl: 'data:image/png;base64,abc', createdAt: 'now', expiresAt: 'later' }} /><UnetVerificationStatus result={{ sessionId: 'v', status: 'verified', checkedAt: 'now', expiresAt: 'later', aggregateOutcome: 'passed' }} /></>);
    expect(html).toContain('data:image/png');
    expect(html).toContain('passed');
  });
});

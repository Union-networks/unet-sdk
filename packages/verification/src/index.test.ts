import { describe, expect, it } from 'vitest';
import { pollVerificationResult } from './index.js';

describe('@union-networks/verification', () => {
  it('polls until a terminal verification state', async () => {
    let count = 0;
    const fetchImpl = async () => {
      count += 1;
      return new Response(JSON.stringify({ sessionId: 'v1', status: count > 1 ? 'verified' : 'pending_scan', checkedAt: 'now', expiresAt: 'later', aggregateOutcome: count > 1 ? 'passed' : undefined }), { status: 200 });
    };
    await expect(pollVerificationResult('v1', { verifierBaseUrl: 'https://verifier.test', fetchImpl, intervalMs: 1, timeoutMs: 100 })).resolves.toMatchObject({ status: 'verified', aggregateOutcome: 'passed' });
  });
});

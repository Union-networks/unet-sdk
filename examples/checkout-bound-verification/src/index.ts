import { createVerificationSession, pollVerificationResult } from '@u-net/verification';

export async function runCheckout(checkoutId: string) {
  // Persist the returned sessionRef beside this provider-owned checkout ID.
  const started = await createVerificationSession({
    verifierId: `demo-supermarket.checkout.${checkoutId}`,
    verifierDisplayName: 'Demo Supermarket',
    requestType: 'age_over_18',
  });
  return pollVerificationResult(started.sessionId);
}

import { createCheckoutVerification, pollCheckoutVerification } from '@union-networks/verification';

export async function runCheckout(assertionJws: string) {
  const started = await createCheckoutVerification({ serviceId: 'demo-supermarket', assertionJws, requiredChecks: ['age_over_18'], restrictedResourceIds: ['beer-pale-ale'] });
  if (started.checkout.status === 'pending_verification') {
    return pollCheckoutVerification({ checkoutId: started.checkout.checkoutId, serviceId: 'demo-supermarket', assertionJws });
  }
  return started;
}

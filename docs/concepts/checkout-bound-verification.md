# Checkout-bound verification and holder binding

Checkout-bound verification prevents one person from logging into a service while another person completes the attestation proof. Trust-plane privately binds the checkout to the holder behind the logged-in scoped ID. The provider sees only the scoped ID and checkout result.

```ts
import { createCheckoutVerification, pollCheckoutVerification } from '@union-networks/verification';

const checkout = await createCheckoutVerification({
  serviceId: 'demo-supermarket',
  assertionJws,
  requiredChecks: ['age_over_18'],
  restrictedResourceIds: ['beer-pale-ale'],
});

const result = await pollCheckoutVerification({
  checkoutId: checkout.checkout.checkoutId,
  serviceId: 'demo-supermarket',
  assertionJws,
});
```

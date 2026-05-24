# Request an over-18 verification

```bash
pnpm add @unet/verification
```

```ts
import { createVerificationSession, pollVerificationResult } from '@unet/verification';

const session = await createVerificationSession({
  verifierId: 'my-shop',
  verifierDisplayName: 'My Shop',
  requestedChecks: [{ requestType: 'age_over_18' }],
  ttlSeconds: 300,
});

showQr(session.qrPayload);
const result = await pollVerificationResult(session.sessionId);
```

Use `aggregateOutcome` and `checkResults` to display green, orange, or red outcomes.

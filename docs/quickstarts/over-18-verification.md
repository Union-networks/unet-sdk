# Request an over-18 verification

```bash
pnpm add @u-net/verification
```

```ts
import { createVerificationSession, pollVerificationResult } from '@u-net/verification';

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

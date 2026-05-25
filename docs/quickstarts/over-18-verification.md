# Request an over-18 verification

```bash
pnpm add @union-networks/verification
```

```ts
import { createVerificationSession, pollVerificationResult } from '@union-networks/verification';

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

# Login assertion verification

Server integrations should verify the `assertionJws` before creating a web session.

```ts
import { verifyLoginAssertion } from '@union-networks/server';

const claims = verifyLoginAssertion(assertionJws, {
  secret: process.env.WEB_LOGIN_ASSERTION_SECRET!,
  serviceId: 'demo-supermarket',
});
```

The assertion contains the service ID, scoped user ID, session ID, and expiry. It does not contain personal profile data.

# @union-networks/server

Server-side helpers for U-net integrations.

Use this package to verify the login assertion returned by U-net web login before creating a session in your own application.

## Install

```bash
npm install @union-networks/server@alpha
```

## Why This Package Exists

The browser receives a U-net login result after the user scans and approves a QR code. Browser state is not enough to log a user in. Your server must verify the signed `assertionJws` before it creates or resumes a local session.

## Verify A Login Assertion

```ts
import { verifyLoginAssertion } from '@union-networks/server';

const claims = verifyLoginAssertion(assertionJws, {
  secret: process.env.UNET_WEB_LOGIN_ASSERTION_SECRET!,
  serviceId: 'demo-supermarket',
});

console.log(claims.scopedUserId);
```

`verifyLoginAssertion` checks:

- JWS shape
- HMAC signature
- expiration time
- expected `serviceId`, when provided
- required claims such as `scopedUserId` and `sessionId`

## Next.js Route Example

```ts
import { verifyLoginAssertion } from '@union-networks/server';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
  const { assertionJws } = await request.json();

  const claims = verifyLoginAssertion(assertionJws, {
    secret: process.env.UNET_WEB_LOGIN_ASSERTION_SECRET!,
    serviceId: 'demo-supermarket',
  });

  const account = await findOrCreateAccountByScopedId(claims.scopedUserId!);

  const sessionId = await createLocalSession(account.id);
  cookies().set('session', sessionId, { httpOnly: true, secure: true });

  return Response.json({ ok: true });
}
```

## Claims

The returned claims include:

- `serviceId`: the service that requested login.
- `scopedUserId`: the privacy-preserving account ID for your service.
- `sessionId`: U-net login session ID.
- `issuedAtIso`: assertion issue time.
- `expiresAtIso`: assertion expiry time.

## Security Notes

- Keep the assertion secret server-side only.
- Always pass your expected `serviceId`.
- Store accounts by `scopedUserId`.
- Do not accept expired assertions.
- Do not send the assertion secret to browser code, mobile code, or third-party providers.

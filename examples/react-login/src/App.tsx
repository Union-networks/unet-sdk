import React from 'react';
import { UnetLoginQr, useUnetLogin } from '@u-net/react';

export function App() {
  const login = useUnetLogin(window.location.origin);
  return <main>
    <button disabled={login.isLoading} onClick={() => void login.start().catch(() => undefined)}>Sign in with U-net</button>
    {login.isLoading && login.challenge ? <UnetLoginQr challenge={login.challenge} /> : null}
    {login.error ? <p role="alert">Login failed. Start a new attempt.</p> : null}
    {!login.isLoading && !login.error && login.result ? <p role="status">{login.result.state}</p> : null}
  </main>;
}

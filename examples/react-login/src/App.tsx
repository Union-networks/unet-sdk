import React from 'react';
import { UnetLoginQr, useUnetLogin } from '@u-net/react';

export function App() {
  const login = useUnetLogin(window.location.origin);
  return <main><button onClick={() => void login.start()}>Sign in with U-net</button>{login.challenge ? <UnetLoginQr challenge={login.challenge} /> : null}</main>;
}

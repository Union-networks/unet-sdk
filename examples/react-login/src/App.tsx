import React from 'react';
import { UnetLoginQr, useUnetLogin } from '@unet/react';

export function App() {
  const login = useUnetLogin({ serviceId: 'demo-supermarket', origin: window.location.origin });
  return <main><button onClick={() => void login.start()}>Sign in with U-net</button>{login.session ? <UnetLoginQr session={login.session} /> : null}</main>;
}

import React from 'react';
import { UnetVerificationQr, UnetVerificationStatus, useUnetVerification } from '@union-networks/react';

export function App() {
  const verification = useUnetVerification({ verifierId: 'example-shop', verifierDisplayName: 'Example Shop', requestedChecks: [{ requestType: 'age_over_18' }] });
  return <main><button onClick={() => void verification.start()}>Request over-18 proof</button>{verification.session ? <UnetVerificationQr session={verification.session} /> : null}<UnetVerificationStatus result={verification.result} /></main>;
}

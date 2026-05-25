import React from 'react';
import { createLoginSession, pollLoginSession, renderLoginQrPayload } from '@union-networks/web-login';
import { createVerificationSession, pollVerificationResult } from '@union-networks/verification';
import type { CreateVerificationSessionInput, VerificationSession, VerificationSessionStatus } from '@union-networks/verification';
import type { CreateWebLoginSessionInput, WebLoginSession } from '@union-networks/web-login';
import type { UnetClientOptions } from '@union-networks/client';

export function useUnetLogin(input: CreateWebLoginSessionInput, options?: UnetClientOptions) {
  const [session, setSession] = React.useState<WebLoginSession | undefined>();
  const [error, setError] = React.useState<Error | undefined>();
  const start = React.useCallback(async () => {
    setError(undefined);
    try {
      const created = await createLoginSession(input, options);
      setSession(created);
      const result = await pollLoginSession(created.sessionId, options);
      setSession(result);
      return result;
    } catch (err) {
      const errorValue = err instanceof Error ? err : new Error(String(err));
      setError(errorValue);
      throw errorValue;
    }
  }, [input, options]);
  return { session, error, start };
}

export function UnetLoginQr(props: { session: WebLoginSession; alt?: string }) {
  if (props.session.qrDataUrl) return <img src={props.session.qrDataUrl} alt={props.alt ?? 'Sign in with U-net'} />;
  return <pre>{renderLoginQrPayload(props.session)}</pre>;
}

export function useUnetVerification(input: CreateVerificationSessionInput, options?: UnetClientOptions) {
  const [session, setSession] = React.useState<VerificationSession | undefined>();
  const [result, setResult] = React.useState<VerificationSessionStatus | undefined>();
  const start = React.useCallback(async () => {
    const created = await createVerificationSession(input, options);
    setSession(created);
    const finalResult = await pollVerificationResult(created.sessionId, options);
    setResult(finalResult);
    return finalResult;
  }, [input, options]);
  return { session, result, start };
}

export function UnetVerificationQr(props: { session: VerificationSession; alt?: string }) {
  return <pre aria-label={props.alt ?? 'U-net verification QR payload'}>{props.session.qrPayload}</pre>;
}

export function UnetVerificationStatus(props: { result?: VerificationSessionStatus }) {
  const text = props.result ? props.result.aggregateOutcome ?? props.result.status : 'pending';
  return <span data-unet-verification-status={text}>{text}</span>;
}

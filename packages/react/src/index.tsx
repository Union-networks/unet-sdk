import React from 'react';
import { createDirectProviderLogin, renderDirectLoginQrPayload, waitForDirectProviderLogin } from '@u-net/web-login';
import { createVerificationSession, listMiniPrograms, listVerificationChecks, pollVerificationResult } from '@u-net/verification';
import type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, VerificationCheckCatalogResponse, VerificationSession, VerificationSessionStatus } from '@u-net/verification';
import type { DirectProviderLoginChallenge, DirectProviderLoginOptions, DirectProviderLoginPollResult } from '@u-net/web-login';
import type { UnetClientOptions } from '@u-net/client';

export function useUnetLogin(origin: string, options?: DirectProviderLoginOptions) {
  const [challenge, setChallenge] = React.useState<DirectProviderLoginChallenge | undefined>();
  const [result, setResult] = React.useState<DirectProviderLoginPollResult | undefined>();
  const [error, setError] = React.useState<Error | undefined>();
  const [isLoading, setIsLoading] = React.useState(false);
  const start = React.useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const created = await createDirectProviderLogin(origin, options);
      setChallenge(created);
      const finalResult = await waitForDirectProviderLogin(origin, created.requestRef, options);
      setResult(finalResult);
      return finalResult;
    } catch (err) {
      const errorValue = err instanceof Error ? err : new Error(String(err));
      setError(errorValue);
      throw errorValue;
    } finally {
      setIsLoading(false);
    }
  }, [origin, options]);
  return { challenge, result, error, isLoading, start };
}

export function UnetLoginQr(props: { challenge: DirectProviderLoginChallenge; label?: string }) {
  return <pre aria-label={props.label ?? 'U-net Direct Login QR payload'}>{renderDirectLoginQrPayload(props.challenge)}</pre>;
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


export function useVerificationChecks(input: ListVerificationChecksOptions = {}, options?: UnetClientOptions) {
  const [catalog, setCatalog] = React.useState<VerificationCheckCatalogResponse | undefined>();
  const [error, setError] = React.useState<Error | undefined>();
  const [isLoading, setIsLoading] = React.useState(false);
  const load = React.useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const page = await listVerificationChecks({ ...input, cursor: cursor ?? input.cursor }, options);
      setCatalog((current: VerificationCheckCatalogResponse | undefined) => cursor && current ? { ...page, checks: [...current.checks, ...page.checks] } : page);
      return page;
    } catch (err) {
      const errorValue = err instanceof Error ? err : new Error(String(err));
      setError(errorValue);
      throw errorValue;
    } finally {
      setIsLoading(false);
    }
  }, [input, options]);
  const loadMore = React.useCallback(() => catalog?.pageInfo?.nextCursor ? load(catalog.pageInfo.nextCursor) : Promise.resolve(undefined), [catalog, load]);
  return { catalog, error, isLoading, load, loadMore, hasNextPage: Boolean(catalog?.pageInfo?.hasNextPage) };
}

export function useMiniPrograms(input: ListMiniProgramsOptions = {}, options?: UnetClientOptions) {
  const [catalog, setCatalog] = React.useState<MiniProgramCatalogResponse | undefined>();
  const [error, setError] = React.useState<Error | undefined>();
  const [isLoading, setIsLoading] = React.useState(false);
  const load = React.useCallback(async (cursor?: string) => {
    setIsLoading(true);
    setError(undefined);
    try {
      const page = await listMiniPrograms({ ...input, cursor: cursor ?? input.cursor }, options);
      setCatalog((current: MiniProgramCatalogResponse | undefined) => cursor && current ? { ...page, programs: [...current.programs, ...page.programs] } : page);
      return page;
    } catch (err) {
      const errorValue = err instanceof Error ? err : new Error(String(err));
      setError(errorValue);
      throw errorValue;
    } finally {
      setIsLoading(false);
    }
  }, [input, options]);
  const loadMore = React.useCallback(() => catalog?.pageInfo?.nextCursor ? load(catalog.pageInfo.nextCursor) : Promise.resolve(undefined), [catalog, load]);
  return { catalog, error, isLoading, load, loadMore, hasNextPage: Boolean(catalog?.pageInfo?.hasNextPage) };
}



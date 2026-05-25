import React from 'react';
import { createLoginSession, pollLoginSession, renderLoginQrPayload } from '@union-networks/web-login';
import { createVerificationSession, listMiniPrograms, listVerificationChecks, pollVerificationResult } from '@union-networks/verification';
import type { CreateVerificationSessionInput, ListMiniProgramsOptions, ListVerificationChecksOptions, MiniProgramCatalogResponse, VerificationCheckCatalogResponse, VerificationSession, VerificationSessionStatus } from '@union-networks/verification';
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

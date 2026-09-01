import type { DirectLoginServiceOptions } from './directLogin.js';

export type ServiceAccountMode = 'single' | 'multiple';

export interface UnetServiceManifestV2 {
  protocolVersion: 2;
  serviceId: string;
  origin: string;
  accountPolicy: {
    mode: ServiceAccountMode;
    maxAccounts: number;
    policyVersion: 2;
  };
  endpoints: {
    challenge: string;
    approval: string;
    status: string;
    exchange: string;
    retirement: string;
    selfTest: string;
    officialInbox?: string;
    officialBroadcast?: string;
  };
  issuer?: {
    endpoints: {
      request: string;
      status: string;
      acknowledge: string;
      renew: string;
      revocation: string;
    };
  };
}

export interface UnetServiceManifestOptions {
  serviceId: string;
  origin: string;
  accountMode?: ServiceAccountMode;
  maxAccounts?: number;
  officialMessaging?: boolean;
  directIssuer?: boolean;
}

const sameOriginUrl = (origin: string, path: string): string => new URL(path, origin).toString();

export function createUnetServiceManifest(options: UnetServiceManifestOptions): UnetServiceManifestV2 {
  const origin = new URL(options.origin).origin;
  const maxAccounts = options.accountMode === 'multiple'
    ? Math.min(10, Math.max(2, options.maxAccounts ?? 10))
    : 1;
  return {
    protocolVersion: 2,
    serviceId: options.serviceId,
    origin,
    accountPolicy: {
      mode: options.accountMode ?? 'single',
      maxAccounts,
      policyVersion: 2,
    },
    endpoints: {
      challenge: sameOriginUrl(origin, '/api/unet/login/challenge'),
      approval: sameOriginUrl(origin, '/api/unet/login/approve'),
      status: sameOriginUrl(origin, '/api/unet/login/status'),
      exchange: sameOriginUrl(origin, '/api/unet/login/exchange'),
      retirement: sameOriginUrl(origin, '/api/unet/account/retire'),
      selfTest: sameOriginUrl(origin, '/api/unet/self-test'),
      ...(options.officialMessaging
        ? {
            officialInbox: sameOriginUrl(origin, '/api/unet/official-inbox'),
            officialBroadcast: sameOriginUrl(origin, '/api/unet/official-messaging/broadcast'),
          }
        : {}),
    },
    ...(options.directIssuer
      ? {
          issuer: {
            endpoints: {
              request: sameOriginUrl(origin, '/api/unet/issuer/request'),
              status: sameOriginUrl(origin, '/api/unet/issuer/status'),
              acknowledge: sameOriginUrl(origin, '/api/unet/issuer/acknowledge'),
              renew: sameOriginUrl(origin, '/api/unet/issuer/renew'),
              revocation: sameOriginUrl(origin, '/api/unet/issuer/revocation'),
            },
          },
        }
      : {}),
  };
}

export function createUnetServiceManifestHandler(options: UnetServiceManifestOptions) {
  const manifest = createUnetServiceManifest(options);
  return async (): Promise<Response> => new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

export type DirectLoginServiceConfiguration = Pick<DirectLoginServiceOptions, 'serviceId' | 'origin'>;

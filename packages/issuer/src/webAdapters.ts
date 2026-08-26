import type { DirectIssuerRequestInput, DirectIssuerService, DirectIssuerRenewalInput } from './directIssuer.js';

type JsonObject = Record<string, unknown>;

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const body = async <T extends JsonObject>(request: Request): Promise<T> => {
  const value = await request.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_body_invalid');
  return value as T;
};

const statusFor = (code: string): number => {
  if (/not_found|unavailable/.test(code)) return 404;
  if (/capability|authorization/.test(code)) return 401;
  if (/exists|replayed|not_pending|not_renewable/.test(code)) return 409;
  return 400;
};

const failure = (error: unknown): Response => {
  const code = error instanceof Error ? error.message : 'direct_issuer_request_failed';
  return json({ success: false, error: code }, statusFor(code));
};

export interface DirectIssuerWebAdapterOptions {
  service: DirectIssuerService;
  authorizeManagement: (request: Request) => Promise<boolean>;
}

export function createDirectIssuerWebHandlers(options: DirectIssuerWebAdapterOptions) {
  const requireManagement = async (request: Request): Promise<void> => {
    if (!(await options.authorizeManagement(request))) throw new Error('issuer_management_authorization_required');
  };

  return {
    createRequest: async (request: Request): Promise<Response> => {
      try {
        return json({ success: true, ...(await options.service.createRequest(await body<DirectIssuerRequestInput & JsonObject>(request))) }, 201);
      } catch (error) {
        return failure(error);
      }
    },

    requestStatus: async (request: Request): Promise<Response> => {
      try {
        const url = new URL(request.url);
        const requestId = url.searchParams.get('requestId');
        const deliveryCapability = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('deliveryCapability');
        if (!requestId || !deliveryCapability) throw new Error('delivery_capability_invalid');
        return json({ success: true, ...(await options.service.getDelivery(requestId, deliveryCapability)) });
      } catch (error) {
        return failure(error);
      }
    },

    acknowledge: async (request: Request): Promise<Response> => {
      try {
        const input = await body<{ requestId?: unknown; deliveryCapability?: unknown; attestationHash?: unknown } & JsonObject>(request);
        if (typeof input.requestId !== 'string' || typeof input.deliveryCapability !== 'string' || typeof input.attestationHash !== 'string') {
          throw new Error('delivery_acknowledgement_invalid');
        }
        await options.service.acknowledgeDelivery(input.requestId, input.deliveryCapability, input.attestationHash);
        return json({ success: true });
      } catch (error) {
        return failure(error);
      }
    },

    renew: async (request: Request): Promise<Response> => {
      try {
        return json({ success: true, ...(await options.service.createRenewalRequest(await body<DirectIssuerRenewalInput & JsonObject>(request))) }, 201);
      } catch (error) {
        return failure(error);
      }
    },

    authorizeRevocation: async (request: Request): Promise<Response> => {
      try {
        const input = await body<{ requestId?: unknown; deliveryCapability?: unknown; attestationHash?: unknown } & JsonObject>(request);
        if (typeof input.requestId !== 'string' || typeof input.deliveryCapability !== 'string' || typeof input.attestationHash !== 'string') {
          throw new Error('revocation_capability_invalid');
        }
        return json({ success: true, authorization: await options.service.authorizeRevocation({
          requestId: input.requestId,
          deliveryCapability: input.deliveryCapability,
          attestationHash: input.attestationHash,
        }) });
      } catch (error) {
        return failure(error);
      }
    },

    approve: async (request: Request): Promise<Response> => {
      try {
        await requireManagement(request);
        const input = await body<{ requestId?: unknown } & JsonObject>(request);
        if (typeof input.requestId !== 'string') throw new Error('issuer_request_invalid');
        return json({ success: true, request: await options.service.approve(input.requestId) });
      } catch (error) {
        return failure(error);
      }
    },

    deny: async (request: Request): Promise<Response> => {
      try {
        await requireManagement(request);
        const input = await body<{ requestId?: unknown; category?: unknown } & JsonObject>(request);
        if (typeof input.requestId !== 'string') throw new Error('issuer_request_invalid');
        return json({ success: true, request: await options.service.deny(input.requestId, typeof input.category === 'string' ? input.category : undefined) });
      } catch (error) {
        return failure(error);
      }
    },
  };
}

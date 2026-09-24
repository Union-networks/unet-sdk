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

// Only exact service/adapter codes are public. Store/provider exceptions may
// contain credentials or request URLs and must never become response text.
const publicErrors = new Map<string, number>([
  ['request_body_invalid', 400], ['issuer_management_authorization_required', 401],
  ['issuer_request_invalid', 400], ['holder_revocation_signer_invalid', 400],
  ['issuer_request_idempotency_replayed', 409], ['active_credential_exists', 409],
  ['renewal_capability_invalid', 401], ['credential_not_renewable', 409],
  ['issuer_renewal_invalid', 400], ['issuer_request_not_pending', 409],
  ['attestation_hash_invalid', 400], ['attestation_hash_missing_after_build', 503],
  ['active_credential_not_found', 404], ['issuer_revocation_not_configured', 503],
  ['revocation_capability_invalid', 401], ['revocation_commitment_mismatch', 400],
  ['credential_not_revocable', 400], ['delivery_capability_invalid', 401],
  ['delivery_acknowledgement_invalid', 400], ['issuer_request_duplicate', 400],
  ['issuer_request_not_found', 404], ['delivery_reference_required', 400],
]);

const failure = (error: unknown): Response => {
  const code = error instanceof Error && publicErrors.has(error.message) ? error.message : 'direct_issuer_request_failed';
  return json({ success: false, error: code }, publicErrors.get(code) ?? 503);
};

/** @public */
export interface DirectIssuerWebAdapterOptions {
  service: DirectIssuerService;
  authorizeManagement: (request: Request) => Promise<boolean>;
}

/** @public */
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
        if (url.searchParams.has('deliveryCapability')) throw new Error('delivery_capability_invalid');
        const requestId = url.searchParams.get('requestId');
        if (!requestId || url.searchParams.getAll('requestId').length !== 1) throw new Error('delivery_reference_required');
        const deliveryCapability = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!deliveryCapability) throw new Error('delivery_capability_invalid');
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

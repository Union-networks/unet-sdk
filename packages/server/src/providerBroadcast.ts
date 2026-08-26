import { createHash, createHmac, timingSafeEqual, verify } from 'node:crypto';

export interface ProviderBroadcastRequest {
  protocolVersion: 2;
  serviceId: string;
  idempotencyKey: string;
  category: string;
  pushTitle: string;
  encryptedContentReference?: string;
  templateReference?: {
    templateId: string;
    version: number;
  };
  content: Record<string, unknown>;
}

export interface ProviderBroadcastOutcomes {
  delivered: number;
  storedWithoutPush: number;
  blocked: number;
  missingKey: number;
  failed: number;
}

const signatureFor = (secret: string, timestamp: string, rawBody: string): Buffer => Buffer.from(
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  'hex',
);

export function createProviderBroadcastHandler(options: {
  serviceId: string;
  dashboardPublicKeyPem?: string;
  /** @deprecated Configure dashboardPublicKeyPem for asymmetric callback verification. */
  dashboardSigningSecret?: string;
  claimIdempotency?: (idempotencyKey: string) => Promise<boolean>;
  dispatch: (request: ProviderBroadcastRequest) => Promise<ProviderBroadcastOutcomes>;
  now?: () => Date;
}) {
  return async (request: Request): Promise<Response> => {
    const rawBody = await request.text();
    const timestamp = request.headers.get('x-unet-timestamp') ?? '';
    const supplied = request.headers.get('x-unet-signature') ?? '';
    const algorithm = request.headers.get('x-unet-signature-algorithm') ?? '';
    const timestampMs = Date.parse(timestamp);
    const fresh = Number.isFinite(timestampMs) && Math.abs((options.now?.() ?? new Date()).getTime() - timestampMs) <= 5 * 60_000;
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const canonical = Buffer.from(`unet-provider-broadcast-v2\n${options.serviceId}\n${timestamp}\n${bodyHash}`, 'utf8');
    let authorized = false;
    if (fresh && options.dashboardPublicKeyPem && algorithm === 'ed25519') {
      try { authorized = verify(null, canonical, options.dashboardPublicKeyPem, Buffer.from(supplied, 'base64url')); } catch { authorized = false; }
    } else if (fresh && options.dashboardSigningSecret) {
      const suppliedBytes = /^[a-f0-9]{64}$/.test(supplied) ? Buffer.from(supplied, 'hex') : Buffer.alloc(0);
      const expected = signatureFor(options.dashboardSigningSecret, timestamp, rawBody);
      authorized = suppliedBytes.length === expected.length && timingSafeEqual(suppliedBytes, expected);
    }
    if (!authorized) {
      return Response.json({ success: false, error: 'broadcast_authorization_invalid' }, { status: 401 });
    }
    let body: ProviderBroadcastRequest;
    try {
      body = JSON.parse(rawBody) as ProviderBroadcastRequest;
    } catch {
      return Response.json({ success: false, error: 'broadcast_request_invalid' }, { status: 400 });
    }
    if (body.protocolVersion !== 2 || body.serviceId !== options.serviceId || !body.idempotencyKey) {
      return Response.json({ success: false, error: 'broadcast_request_invalid' }, { status: 400 });
    }
    if (options.claimIdempotency && !(await options.claimIdempotency(body.idempotencyKey))) {
      return Response.json({ success: true, duplicate: true });
    }
    const outcomes = await options.dispatch(body);
    return Response.json({ success: true, outcomes });
  };
}

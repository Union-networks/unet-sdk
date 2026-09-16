import type { DirectLoginApproval, DirectLoginService, ServiceAccountRetirement } from './directLogin.js';
import type { OfficialMessagingInboxRegistration, OfficialMessagingInboxStore } from './officialMessagingInbox.js';
import { registerOfficialMessagingInbox } from './officialMessagingInbox.js';
import type { DirectLoginAccountStore } from './directLogin.js';
import { assertDirectLoginBrowserOrigin, createDirectLoginRedemptionSecret, directLoginBrowserCookie, readDirectLoginBrowserSecret } from './directLoginBrowser.js';

type JsonObject = Record<string, unknown>;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const errorStatus = (message: string): number => {
  if (/unauthorized|origin_mismatch/.test(message)) return 403;
  if (/not_found|invalid/.test(message)) return 404;
  if (/expired|stale/.test(message)) return 410;
  if (/mismatch|bad_signature|retired|already/.test(message)) return 409;
  return 400;
};

const safeError = (error: unknown): Response => {
  const code = error instanceof Error && /^(direct_login|service_account_retirement|protocol_upgrade|required|request_body)_[a-z_]+$/.test(error.message)
    ? error.message : 'unet_provider_request_failed';
  return json({ success: false, error: code }, errorStatus(code));
};

const body = async <T extends JsonObject>(request: Request): Promise<T> => {
  const value = await request.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_body_invalid');
  return value as T;
};

/** @public */
export interface DirectLoginWebAdapterOptions {
  serviceId: string;
  origin: string;
  service: DirectLoginService;
  accountStore: DirectLoginAccountStore;
  inboxStore?: OfficialMessagingInboxStore;
  exchange: (session: { sessionId: string; requestRef: string; scopedUserId: string; expiresAtIso: string }) => Promise<Response | Record<string, unknown>>;
}

/** @public */
export function createUnetProtocolOptionsHandler(input: { methods: string[]; capabilities: string[] }) {
  const methods = Array.from(new Set(["OPTIONS", ...input.methods.map((method) => method.toUpperCase())]));
  return async (): Promise<Response> => new Response(null, {
    status: 204,
    headers: {
      allow: methods.join(", "),
      "x-unet-protocol-version": "2",
      "x-unet-capabilities": input.capabilities.join(","),
      "cache-control": "no-store",
    },
  });
}

/** @public */
export type ProviderSelfTestName = "database" | "replay" | "direct_login" | "issuer_storage" | "delivery" | "revocation" | "official_messaging";

/** @public */
export function createProviderSelfTestHandler(input: {
  serviceId: string;
  authorize: (request: Request, body: Record<string, unknown>) => Promise<boolean>;
  checks: Partial<Record<ProviderSelfTestName, () => Promise<void>>>;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      const value = await body<JsonObject>(request);
      const requested = Array.isArray(value.checks) ? value.checks.filter((item): item is ProviderSelfTestName => typeof item === "string" && item in input.checks) : [];
      if (value.version !== 1 || value.action !== "provider.self-test" || value.serviceId !== input.serviceId || !requested.length) return json({ success: false, error: "provider_self_test_invalid" }, 400);
      if (!(await input.authorize(request, value))) return json({ success: false, error: "provider_self_test_unauthorized" }, 403);
      const results = await Promise.all(requested.map(async (name) => {
        try { await input.checks[name]!(); return { name, status: "passed" as const }; }
        catch { return { name, status: "failed" as const }; }
      }));
      return json({ success: true, protocolVersion: 2, results });
    } catch (error) {
      return safeError(error);
    }
  };
}

/** @public */
export function createDirectLoginWebHandlers(options: DirectLoginWebAdapterOptions) {
  return {
    challenge: async (request: Request): Promise<Response> => {
      try {
        assertDirectLoginBrowserOrigin(request, options.origin, true);
        const redemptionSecret = createDirectLoginRedemptionSecret();
        const challenge = await options.service.createChallenge({
          challengeUrl: '/api/unet/login/challenge',
          approvalUrl: '/api/unet/login/approve',
          redemptionSecret,
        });
        const response = json({ success: true, challenge });
        response.headers.append('set-cookie', directLoginBrowserCookie(challenge.requestRef, redemptionSecret, (Date.parse(challenge.expiresAtIso) - Date.now()) / 1000));
        return response;
      } catch (error) {
        return safeError(error);
      }
    },

    challengeStatus: async (request: Request): Promise<Response> => {
      try {
        assertDirectLoginBrowserOrigin(request, options.origin, false);
        const requestRef = new URL(request.url).searchParams.get('requestRef');
        if (!requestRef) throw new Error('direct_login_request_ref_invalid');
        return json({ success: true, ...(await options.service.poll(requestRef, readDirectLoginBrowserSecret(request, requestRef))) });
      } catch (error) {
        return safeError(error);
      }
    },

    challengeDetails: async (request: Request): Promise<Response> => {
      try {
        const requestRef = new URL(request.url).searchParams.get('requestRef');
        if (!requestRef) throw new Error('direct_login_request_ref_invalid');
        return json({ success: true, challenge: await options.service.getChallenge(requestRef) });
      } catch (error) {
        return safeError(error);
      }
    },

    approve: async (request: Request): Promise<Response> => {
      try {
        await options.service.approve(await body<DirectLoginApproval & JsonObject>(request));
        return json({ success: true });
      } catch (error) {
        return safeError(error);
      }
    },

    exchange: async (request: Request): Promise<Response> => {
      try {
        assertDirectLoginBrowserOrigin(request, options.origin, true);
        const input = await body<{ requestRef?: unknown; sessionId?: unknown } & JsonObject>(request);
        if (input.sessionId !== undefined) throw new Error('protocol_upgrade_required');
        if (typeof input.requestRef !== 'string') throw new Error('direct_login_request_ref_invalid');
        const secret = readDirectLoginBrowserSecret(request, input.requestRef);
        const session = await options.service.exchangeSession(input.requestRef, secret);
        const result = await options.exchange(session);
        const response = result instanceof Response ? result : json(result);
        response.headers.append('set-cookie', directLoginBrowserCookie(input.requestRef, secret, 0));
        response.headers.set('cache-control', 'no-store');
        return response;
      } catch (error) {
        return safeError(error);
      }
    },

    retire: async (request: Request): Promise<Response> => {
      try {
        await options.service.retire(await body<ServiceAccountRetirement & JsonObject>(request));
        return json({ success: true });
      } catch (error) {
        return safeError(error);
      }
    },

    officialInbox: async (request: Request): Promise<Response> => {
      if (!options.inboxStore) return json({ success: false, error: 'official_messaging_not_configured' }, 404);
      try {
        await registerOfficialMessagingInbox({
          serviceId: options.serviceId,
          origin: options.origin,
          registration: await body<OfficialMessagingInboxRegistration & JsonObject>(request),
          accountStore: options.accountStore,
          inboxStore: options.inboxStore,
        });
        return json({ success: true });
      } catch (error) {
        return safeError(error);
      }
    },
  };
}

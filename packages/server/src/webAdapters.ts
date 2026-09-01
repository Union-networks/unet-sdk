import type { DirectLoginApproval, DirectLoginService, ServiceAccountRetirement } from './directLogin.js';
import type { OfficialMessagingInboxRegistration, OfficialMessagingInboxStore } from './officialMessagingInbox.js';
import { registerOfficialMessagingInbox } from './officialMessagingInbox.js';
import type { DirectLoginAccountStore } from './directLogin.js';

type JsonObject = Record<string, unknown>;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const errorStatus = (message: string): number => {
  if (/not_found|invalid/.test(message)) return 404;
  if (/expired|stale/.test(message)) return 410;
  if (/mismatch|bad_signature|retired|already/.test(message)) return 409;
  return 400;
};

const safeError = (error: unknown): Response => {
  const code = error instanceof Error ? error.message : 'unet_provider_request_failed';
  return json({ success: false, error: code }, errorStatus(code));
};

const body = async <T extends JsonObject>(request: Request): Promise<T> => {
  const value = await request.json().catch(() => undefined);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_body_invalid');
  return value as T;
};

export interface DirectLoginWebAdapterOptions {
  serviceId: string;
  origin: string;
  service: DirectLoginService;
  accountStore: DirectLoginAccountStore;
  inboxStore?: OfficialMessagingInboxStore;
  exchange?: (session: { sessionId: string; requestRef: string; scopedUserId: string; expiresAtIso: string }) => Promise<Response | JsonObject>;
}

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

export type ProviderSelfTestName = "database" | "replay" | "direct_login" | "issuer_storage" | "delivery" | "revocation" | "official_messaging";

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

export function createDirectLoginWebHandlers(options: DirectLoginWebAdapterOptions) {
  return {
    challenge: async (_request: Request): Promise<Response> => {
      try {
        const challenge = await options.service.createChallenge({
          challengeUrl: '/api/unet/login/challenge',
          approvalUrl: '/api/unet/login/approve',
        });
        return json({ success: true, challenge });
      } catch (error) {
        return safeError(error);
      }
    },

    challengeStatus: async (request: Request): Promise<Response> => {
      try {
        const requestRef = new URL(request.url).searchParams.get('requestRef');
        if (!requestRef) throw new Error('direct_login_request_ref_invalid');
        return json({ success: true, ...(await options.service.poll(requestRef)) });
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
        const input = await body<{ sessionId?: unknown } & JsonObject>(request);
        if (typeof input.sessionId !== 'string') throw new Error('direct_login_session_invalid');
        const session = await options.service.prepareSessionExchange(input.sessionId);
        const result = options.exchange ? await options.exchange(session) : { success: true, session };
        await options.service.completeSessionExchange(input.sessionId);
        return result instanceof Response ? result : json(result);
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

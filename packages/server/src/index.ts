import { createHash, createHmac, randomBytes } from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

export * from './directLogin.js';
export * from './directLoginPostgres.js';
export * from './officialMessagingInbox.js';
export * from './operationalMetrics.js';
export * from './providerBroadcast.js';
export * from './providerEnvironment.js';
export * from './serviceManifest.js';
export * from './webAdapters.js';

export interface UnetProviderClaimOptions {
  serviceId: string;
  origin: string;
  claimId: string;
  challenge: string;
  claimToken: string;
}

export interface UnetProviderClaimResponse {
  serviceId: string;
  origin: string;
  claimId: string;
  challenge: string;
  proof: string;
}

export interface UnetMiniappManifestOptions {
  serviceId: string;
  name: string;
  provider: string;
  description?: string;
  category?: string;
  icon?: string;
  origin: string;
  launchUrl: string;
  permissions?: string[];
  notificationCategories?: string[];
  domainClaim?: UnetProviderClaimOptions;
}

export interface UnetMiniappManifest {
  serviceId: string;
  name: string;
  provider: string;
  description: string;
  category: string;
  icon?: string;
  launchUrl: string;
  permissions: string[];
  notificationCategories: string[];
  domainClaim?: UnetProviderClaimResponse;
}

const base64UrlToBuffer = (value: string): Buffer => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const normalizeOrigin = (origin: string): string => new URL(origin).origin;

export function createUnetProviderClaim(options: UnetProviderClaimOptions): UnetProviderClaimResponse {
  const origin = normalizeOrigin(options.origin);
  const tokenHash = createHash('sha256').update(options.claimToken).digest('hex');
  const message = `${options.claimId}.${options.serviceId}.${origin}.${options.challenge}`;
  const proof = createHmac('sha256', tokenHash).update(message).digest('base64url');
  return {
    serviceId: options.serviceId,
    origin,
    claimId: options.claimId,
    challenge: options.challenge,
    proof,
  };
}

export function createUnetProviderClaimHandler(options: UnetProviderClaimOptions): () => UnetProviderClaimResponse {
  return () => createUnetProviderClaim(options);
}

export function createUnetMiniappManifest(options: UnetMiniappManifestOptions): UnetMiniappManifest {
  const origin = normalizeOrigin(options.origin);
  const launchUrl = new URL(options.launchUrl, origin);
  if (launchUrl.origin !== origin) throw new Error('launch_url_origin_mismatch');
  return {
    serviceId: options.serviceId,
    name: options.name,
    provider: options.provider,
    description: options.description ?? '',
    category: options.category ?? 'service',
    ...(options.icon ? { icon: options.icon } : {}),
    launchUrl: launchUrl.toString(),
    permissions: options.permissions ?? ['identity.scoped'],
    notificationCategories: options.notificationCategories ?? [],
    ...(options.domainClaim ? { domainClaim: createUnetProviderClaim(options.domainClaim) } : {}),
  };
}

export interface OfficialMessagingVariableDefinition {
  key: string;
  type: 'text' | 'number' | 'date';
  required: boolean;
}

export interface OfficialMessagingTemplate {
  templateId: string;
  version: number;
  kind: 'standard' | 'process';
  category: string;
  notificationTitle: string;
  variables: OfficialMessagingVariableDefinition[];
  content: {
    title: string;
    body: string;
    image?: { url: string; alt: string };
    timeline?: Array<{ key: string; label: string; description?: string }>;
    actions?: Array<{ type: 'open_mini_program' | 'open_url'; label: string; miniProgramId?: string; path?: string; url?: string; external?: boolean }>;
  };
}

export interface OfficialMessagingAutomation {
  automationId: string;
  eventKey: string;
  mode: 'create' | 'update';
  timelineStepIndex?: number;
}

export interface EmitOfficialMessagingEventInput {
  eventKey: string;
  scopedUserId: string;
  eventId: string;
  processId?: string;
  variables?: Record<string, string | number | Date>;
}

export interface OfficialMessagingClientOptions {
  controlPlaneUrl: string;
  messagingBaseUrl: string;
  serviceId: string;
  automationKey: string;
  /**
   * Resolves provider-owned recipient state. This function runs only on the
   * provider server; scopedUserId is never sent to U-net infrastructure.
   */
  recipientResolver: (scopedUserId: string) => Promise<OfficialMessagingRecipient | undefined>;
  fetch?: typeof globalThis.fetch;
}

export interface OfficialMessagingRecipient {
  /** Random, provider-stored 32-byte reference encoded as 64 lowercase hex characters. */
  recipientReference: string;
  recipientEncryptionPublicKey: string;
  mailboxAddress: string;
  sendCapability: string;
}

type AutomationPrepareResponse = {
  success?: boolean;
  errorCode?: string;
  message?: string;
  duplicate?: boolean;
  ignoredRegression?: boolean;
  dispatchRef?: string;
  automation?: OfficialMessagingAutomation;
  template?: OfficialMessagingTemplate;
  logicalMessageId?: string;
  messageId?: string;
  revision?: number;
};

const interpolateTemplate = (value: string, variables: Record<string, string>): string =>
  value.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_match, key: string) => variables[key] ?? `{{${key}}}`);

const normalizeAutomationVariables = (
  definitions: OfficialMessagingVariableDefinition[],
  supplied: Record<string, string | number | Date>,
): Record<string, string> => {
  const allowed = new Set(definitions.map((definition) => definition.key));
  for (const key of Object.keys(supplied)) if (!allowed.has(key)) throw new Error(`undeclared_automation_variable:${key}`);
  const normalized: Record<string, string> = {};
  for (const definition of definitions) {
    const value = supplied[definition.key];
    if (value === undefined || value === null || value === '') {
      if (definition.required) throw new Error(`required_automation_variable_missing:${definition.key}`);
      continue;
    }
    if (definition.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`invalid_automation_variable:${definition.key}`);
      normalized[definition.key] = String(value);
    } else if (definition.type === 'date') {
      const date = value instanceof Date ? value : new Date(String(value));
      if (!Number.isFinite(date.getTime())) throw new Error(`invalid_automation_variable:${definition.key}`);
      normalized[definition.key] = date.toISOString();
    } else {
      if (typeof value !== 'string') throw new Error(`invalid_automation_variable:${definition.key}`);
      normalized[definition.key] = value.slice(0, 1000);
    }
  }
  return normalized;
};

const encryptOfficialPayload = (recipientPublicKey: string, payload: Record<string, unknown>) => {
  const ephemeral = x25519.keygen(randomBytes(32));
  const recipient = base64UrlToBuffer(recipientPublicKey);
  if (recipient.length !== 32) throw new Error('invalid_recipient_encryption_key');
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipient);
  const key = hkdf(sha256, shared, Buffer.from('unet-official-account-v1'), Buffer.from('official-account-message'), 32);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(Buffer.from(JSON.stringify(payload), 'utf8'));
  return {
    v: 1,
    senderEncryptionPublicKey: Buffer.from(ephemeral.publicKey).toString('base64url'),
    nonce: nonce.toString('base64url'),
    ciphertext: Buffer.from(ciphertext).toString('base64url'),
  };
};

export function createOfficialMessagingClient(options: OfficialMessagingClientOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch_unavailable');
  if (!options.automationKey) throw new Error('messaging_automation_key_required');
  const baseUrl = options.controlPlaneUrl.replace(/\/+$/, '');
  const messagingBaseUrl = options.messagingBaseUrl.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', 'x-unet-provider-key': options.automationKey };
  const recordOutcome = async (dispatchRef: string, outcome: string): Promise<void> => {
    const response = await fetchImpl(`${baseUrl}/v2/official-account/automations/outcome`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ miniProgramId: options.serviceId, dispatchRef, outcome }),
    });
    if (!response.ok) throw new Error('automation_outcome_failed');
  };
  return {
    async emitEvent(input: EmitOfficialMessagingEventInput) {
        const recipient = await options.recipientResolver(input.scopedUserId);
        if (!recipient) throw new Error('official_messaging_recipient_not_found');
        if (!/^[a-f0-9]{64}$/.test(recipient.recipientReference)) throw new Error('official_messaging_recipient_reference_invalid');
        const prepareResponse = await fetchImpl(`${baseUrl}/v2/official-account/automations/prepare`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            miniProgramId: options.serviceId,
            eventKey: input.eventKey,
            eventId: input.eventId,
            ...(input.processId ? { processId: input.processId } : {}),
            recipientReference: recipient.recipientReference,
            variableKeys: Object.keys(input.variables ?? {}),
          }),
        });
        const prepared = await prepareResponse.json().catch(() => ({})) as AutomationPrepareResponse;
        if (!prepareResponse.ok || !prepared.dispatchRef || !prepared.automation || !prepared.template || !prepared.logicalMessageId || !prepared.revision) {
          throw new Error(prepared.errorCode ?? prepared.message ?? 'automation_prepare_failed');
        }
        if (prepared.ignoredRegression) {
          await recordOutcome(prepared.dispatchRef, 'ignored_regression');
          return { success: true, status: 'ignored_regression', messageId: prepared.messageId, revision: prepared.revision };
        }
        const variables = normalizeAutomationVariables(prepared.template.variables ?? [], input.variables ?? {});
        const content = {
          ...prepared.template.content,
          title: interpolateTemplate(prepared.template.content.title, variables),
          body: interpolateTemplate(prepared.template.content.body, variables),
        };
        const encryptedPayload = encryptOfficialPayload(recipient.recipientEncryptionPublicKey, {
          version: 2,
          kind: 'rich_official_message',
          title: content.title,
          text: content.body,
          rich: {
            ...content,
            ...(prepared.template.kind === 'process' ? { currentStepIndex: prepared.automation.timelineStepIndex ?? 0 } : {}),
          },
          action: content.actions?.find((action) => action.type === 'open_mini_program'),
        });
        try {
          const deliveryResponse = await fetchImpl(`${messagingBaseUrl}/v2/mailboxes/${encodeURIComponent(recipient.mailboxAddress)}/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sendCapability: recipient.sendCapability,
              idempotencyKey: input.eventId,
              ciphertext: encryptedPayload,
              logicalMessageId: prepared.logicalMessageId,
              revision: prepared.revision,
            }),
          });
          const delivered = await deliveryResponse.json().catch(() => ({})) as Record<string, unknown>;
          if (!deliveryResponse.ok || delivered.success === false) throw new Error(String(delivered.error ?? 'official_message_delivery_failed'));
          const status = String(delivered.status ?? 'stored');
          await recordOutcome(prepared.dispatchRef, ['updated', 'duplicate', 'ignored_regression'].includes(status) ? status : 'stored');
          return delivered;
        } catch (error) {
          await recordOutcome(prepared.dispatchRef, 'failed').catch(() => undefined);
          throw error;
        }
    },
  };
}

export function createUnetServerClient(options: OfficialMessagingClientOptions) {
  return { officialMessaging: createOfficialMessagingClient(options) };
}

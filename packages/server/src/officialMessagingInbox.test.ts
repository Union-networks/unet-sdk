import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DirectLoginAccountStore } from './directLogin.js';
import {
  canonicalOfficialInboxRegistration,
  registerOfficialMessagingInbox,
  type OfficialMessagingInboxRegistration,
  type OfficialMessagingInboxStore,
} from './officialMessagingInbox.js';

describe('provider-owned official inbox registration', () => {
  it('requires the scoped account signature and never needs a central holder record', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const saved: OfficialMessagingInboxRegistration[] = [];
    const accountStore: DirectLoginAccountStore = {
      getPublicKey: async (id) => id === 'scoped_private_1' ? publicKeyPem : undefined,
      bindPublicKey: async () => 'existing',
      retire: async () => undefined,
    };
    const inboxStore: OfficialMessagingInboxStore = {
      register: async (value) => { saved.push(value); },
      resolve: async () => undefined,
      retire: async () => undefined,
    };
    const unsigned: Omit<OfficialMessagingInboxRegistration, 'signature'> = {
      protocolVersion: 2,
      serviceId: 'demo-shop',
      origin: 'https://shop.example',
      scopedUserId: 'scoped_private_1',
      mailboxAddress: 'mbx_provider_owned_random_123456',
      recipientEncryptionPublicKey: 'recipient_encryption_public_key_1234567890',
      sendCapability: 'send_provider_owned_random_123456',
      recipientReference: 'b'.repeat(64),
      signedAtIso: '2026-08-24T12:00:00.000Z',
    };
    const registration = {
      ...unsigned,
      signature: sign(null, Buffer.from(canonicalOfficialInboxRegistration(unsigned)), privateKey).toString('base64url'),
    };
    await registerOfficialMessagingInbox({
      serviceId: 'demo-shop',
      origin: 'https://shop.example',
      registration,
      accountStore,
      inboxStore,
      now: new Date('2026-08-24T12:01:00.000Z'),
    });
    expect(saved).toEqual([registration]);
    await expect(registerOfficialMessagingInbox({
      serviceId: 'other-service',
      origin: 'https://shop.example',
      registration,
      accountStore,
      inboxStore,
      now: new Date('2026-08-24T12:01:00.000Z'),
    })).rejects.toThrow('official_inbox_registration_mismatch');
  });
});

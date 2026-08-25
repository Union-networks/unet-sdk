import { verify } from 'node:crypto';
import type { DirectLoginAccountStore } from './directLogin.js';
import type { SqlClient } from './directLoginPostgres.js';

export interface OfficialMessagingInboxRegistration {
  protocolVersion: 2;
  serviceId: string;
  origin: string;
  scopedUserId: string;
  mailboxAddress: string;
  recipientEncryptionPublicKey: string;
  sendCapability: string;
  recipientReference: string;
  signedAtIso: string;
  signature: string;
}

export interface ProviderOfficialMessagingRecipient {
  recipientReference: string;
  recipientEncryptionPublicKey: string;
  mailboxAddress: string;
  sendCapability: string;
}

export interface OfficialMessagingInboxStore {
  register(registration: OfficialMessagingInboxRegistration): Promise<void>;
  resolve(scopedUserId: string): Promise<ProviderOfficialMessagingRecipient | undefined>;
  retire(scopedUserId: string): Promise<void>;
}

const normalizeOrigin = (value: string): string => new URL(value).origin;

export function canonicalOfficialInboxRegistration(
  registration: Omit<OfficialMessagingInboxRegistration, 'signature'>,
): string {
  return [
    'unet-official-inbox-registration-v2',
    registration.serviceId,
    normalizeOrigin(registration.origin),
    registration.scopedUserId,
    registration.mailboxAddress,
    registration.recipientEncryptionPublicKey,
    registration.sendCapability,
    registration.recipientReference,
    registration.signedAtIso,
  ].join('\n');
}

export async function registerOfficialMessagingInbox(input: {
  serviceId: string;
  origin: string;
  registration: OfficialMessagingInboxRegistration;
  accountStore: DirectLoginAccountStore;
  inboxStore: OfficialMessagingInboxStore;
  now?: Date;
}): Promise<void> {
  const registration = input.registration;
  if (
    registration.protocolVersion !== 2
    || registration.serviceId !== input.serviceId
    || normalizeOrigin(registration.origin) !== normalizeOrigin(input.origin)
  ) throw new Error('official_inbox_registration_mismatch');
  if (!/^[a-f0-9]{64}$/.test(registration.recipientReference)) throw new Error('official_inbox_recipient_reference_invalid');
  if (!/^mbx_[A-Za-z0-9_-]{16,}$/.test(registration.mailboxAddress)) throw new Error('official_inbox_mailbox_invalid');
  if (registration.sendCapability.length < 24 || registration.recipientEncryptionPublicKey.length < 32) throw new Error('official_inbox_capability_invalid');
  const signedAt = Date.parse(registration.signedAtIso);
  if (!Number.isFinite(signedAt) || Math.abs((input.now ?? new Date()).getTime() - signedAt) > 5 * 60_000) {
    throw new Error('official_inbox_registration_stale');
  }
  const accountPublicKey = await input.accountStore.getPublicKey(registration.scopedUserId);
  if (!accountPublicKey) throw new Error('official_inbox_account_unavailable');
  const { signature, ...unsigned } = registration;
  const valid = verify(
    null,
    Buffer.from(canonicalOfficialInboxRegistration(unsigned), 'utf8'),
    accountPublicKey,
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) throw new Error('official_inbox_registration_bad_signature');
  await input.inboxStore.register(registration);
}

export async function ensureOfficialMessagingInboxSchema(db: SqlClient): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS unet_official_inboxes_v2 (
      scoped_user_id TEXT PRIMARY KEY REFERENCES unet_service_accounts_v2(scoped_user_id) ON DELETE CASCADE,
      mailbox_address TEXT NOT NULL,
      recipient_encryption_public_key TEXT NOT NULL,
      send_capability TEXT NOT NULL,
      recipient_reference TEXT NOT NULL CHECK(recipient_reference ~ '^[a-f0-9]{64}$'),
      status TEXT NOT NULL CHECK(status IN ('active','retired')) DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      retired_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS unet_official_inboxes_mailbox_idx ON unet_official_inboxes_v2(mailbox_address);
    CREATE UNIQUE INDEX IF NOT EXISTS unet_official_inboxes_reference_idx ON unet_official_inboxes_v2(recipient_reference);
  `);
}

export class PostgresOfficialMessagingInboxStore implements OfficialMessagingInboxStore {
  public constructor(private readonly db: SqlClient) {}

  public async register(registration: OfficialMessagingInboxRegistration): Promise<void> {
    const existing = await this.db.query<{ mailbox_address: string; recipient_reference: string; status: string }>(
      'SELECT mailbox_address,recipient_reference,status FROM unet_official_inboxes_v2 WHERE scoped_user_id=$1',
      [registration.scopedUserId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].status !== 'active') throw new Error('official_inbox_retired');
      if (existing.rows[0].mailbox_address !== registration.mailboxAddress || existing.rows[0].recipient_reference !== registration.recipientReference) {
        throw new Error('official_inbox_already_registered');
      }
      return;
    }
    await this.db.query(
      `INSERT INTO unet_official_inboxes_v2
       (scoped_user_id,mailbox_address,recipient_encryption_public_key,send_capability,recipient_reference,status)
       VALUES($1,$2,$3,$4,$5,'active')`,
      [registration.scopedUserId, registration.mailboxAddress, registration.recipientEncryptionPublicKey, registration.sendCapability, registration.recipientReference],
    );
  }

  public async resolve(scopedUserId: string): Promise<ProviderOfficialMessagingRecipient | undefined> {
    const result = await this.db.query<{
      recipient_reference: string;
      recipient_encryption_public_key: string;
      mailbox_address: string;
      send_capability: string;
    }>(
      `SELECT recipient_reference,recipient_encryption_public_key,mailbox_address,send_capability
       FROM unet_official_inboxes_v2 WHERE scoped_user_id=$1 AND status='active'`,
      [scopedUserId],
    );
    const row = result.rows[0];
    return row ? {
      recipientReference: row.recipient_reference,
      recipientEncryptionPublicKey: row.recipient_encryption_public_key,
      mailboxAddress: row.mailbox_address,
      sendCapability: row.send_capability,
    } : undefined;
  }

  public async retire(scopedUserId: string): Promise<void> {
    await this.db.query(
      "UPDATE unet_official_inboxes_v2 SET status='retired',retired_at=COALESCE(retired_at,now()),updated_at=now() WHERE scoped_user_id=$1",
      [scopedUserId],
    );
  }
}

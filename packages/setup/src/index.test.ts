import { describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import { createProviderSetup, serializeDotenv } from './index.js';

describe('provider setup', () => {
  it('emits canonical claim and selected issuer values', async () => {
    const result = await createProviderSetup({
      schemaVersion: 1, serviceId: 'example-shop', origin: 'https://shop.example', controlPlaneUrl: 'https://issuer.egress.live',
      claim: { claimId: 'claim_1', challenge: 'challenge_1', claimToken: 'secret_token' },
      ledger: { chainId: 708222, attestationLedgerAddress: '0x1111111111111111111111111111111111111111', issuerRegistryAddress: '0x2222222222222222222222222222222222222222', readUrl: 'https://ledger.egress.live', relayerUrls: ['https://relay.example'] },
      capabilities: ['direct_login', 'public_issuer'], publicIssuerId: 'issuer:example-shop:custom',
    });
    expect(result.env).toContain('UNET_PROVIDER_CLAIM_ID=claim_1');
    expect(result.env).toContain('UNET_PROVIDER_CLAIM_CHALLENGE=challenge_1');
    expect(result.env).toContain('UNET_ISSUER_ID=issuer:example-shop:custom');
    const issuer = result.publicRegistration.publicIssuer!;
    expect(issuer.issuerId).toBe('issuer:example-shop:custom');
    const canonical = (fields: Record<string, string>) => JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))));
    expect(verify('sha256', Buffer.from(canonical({ issuerId: issuer.issuerId, credentialKeyId: issuer.credentialKeyId, credentialPublicKeyHash: issuer.credentialPublicKeyHash })), createPublicKey(issuer.credentialPublicKeyPem), Buffer.from(issuer.credentialProofOfPossession, 'base64url'))).toBe(true);
    expect(verify('sha256', Buffer.from(canonical({ issuerId: issuer.issuerId, ledgerKeyId: issuer.ledgerKeyId, ledgerAddress: issuer.ledgerAddress })), createPublicKey(issuer.ledgerPublicKeyPem), Buffer.from(issuer.ledgerProofOfPossession, 'base64url'))).toBe(true);
  });

  it('escapes multiline dotenv values', () => {
    expect(serializeDotenv([['TEST_PEM', 'line1\nline2']])).toBe('TEST_PEM="line1\\nline2"');
  });
});

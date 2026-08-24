import { describe, expect, it } from 'vitest';
import { generateLedgerV2HolderRevocationKey, signLedgerV2HolderRevoke } from './ledgerV2.js';

describe('Ledger V2 holder revocation', () => {
  it('uses a credential-specific key and binds the signature to the chain and contract', () => {
    const key = generateLedgerV2HolderRevocationKey();
    expect(key.privateKeyHex).toMatch(/^0x[a-f0-9]{64}$/);
    expect(key.address).toMatch(/^0x[a-f0-9]{40}$/);
    const input = {
      key,
      attestationHash: `0x${'11'.repeat(32)}`,
      requestId: 'holder-revoke-test',
      reason: 'holder_relinquished',
      nonce: 0,
      deadline: 2_000_000_000,
    };
    const first = signLedgerV2HolderRevoke({ ...input, domain: { chainId: 708221, ledgerAddress: `0x${'22'.repeat(20)}` } });
    const otherChain = signLedgerV2HolderRevoke({ ...input, domain: { chainId: 708222, ledgerAddress: `0x${'22'.repeat(20)}` } });
    expect(first.signature).toMatch(/^0x[a-f0-9]{130}$/);
    expect(first.signature).not.toBe(otherChain.signature);
    expect(first.operation.nonce).toBe('0');
  });
});

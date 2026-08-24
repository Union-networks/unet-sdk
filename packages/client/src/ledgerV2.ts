import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

export interface LedgerV2HolderRevocationKey {
  privateKeyHex: string;
  address: string;
}

export interface LedgerV2HolderRevokeOperation {
  attestationHash: string;
  requestIdHash: string;
  reasonHash: string;
  nonce: string;
  deadline: number;
}

export interface LedgerV2Domain {
  chainId: number | bigint;
  ledgerAddress: string;
}

const utf8 = new TextEncoder();
const fromHex = (value: string) => Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));
const toHex = (value: Uint8Array) => `0x${Buffer.from(value).toString('hex')}`;
const concat = (...values: Uint8Array[]) => Uint8Array.from(Buffer.concat(values.map((value) => Buffer.from(value))));
const uint256 = (value: string | number | bigint) => fromHex(BigInt(value).toString(16).padStart(64, '0'));
const bytes32 = (value: string) => {
  const result = fromHex(value);
  if (result.length !== 32) throw new Error('ledger_v2_bytes32_invalid');
  return result;
};
const addressWord = (value: string) => {
  const result = fromHex(value);
  if (result.length !== 20) throw new Error('ledger_v2_address_invalid');
  return concat(new Uint8Array(12), result);
};
const hashText = (value: string) => keccak_256(utf8.encode(value));
const typeHash = hashText;
const domainSeparator = (domain: LedgerV2Domain) => keccak_256(concat(
  typeHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  hashText('U-net Attestation Ledger'),
  hashText('2'),
  uint256(domain.chainId),
  addressWord(domain.ledgerAddress),
));
const typedDigest = (domain: LedgerV2Domain, structHash: Uint8Array) => keccak_256(concat(
  Uint8Array.from([0x19, 0x01]),
  domainSeparator(domain),
  structHash,
));

export const ledgerV2RequestHash = (requestId: string): string => toHex(hashText(requestId));
export const ledgerV2ReasonHash = (reason: string): string => toHex(hashText(reason));

export function generateLedgerV2HolderRevocationKey(): LedgerV2HolderRevocationKey {
  const privateKey = secp256k1.utils.randomSecretKey(randomBytes(48));
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return { privateKeyHex: toHex(privateKey), address: toHex(keccak_256(publicKey.slice(1)).slice(-20)) };
}

export function signLedgerV2HolderRevoke(input: {
  domain: LedgerV2Domain;
  key: LedgerV2HolderRevocationKey;
  attestationHash: string;
  requestId: string;
  reason: string;
  nonce: string | number | bigint;
  deadline: number;
}): { operation: LedgerV2HolderRevokeOperation; signature: string } {
  const operation: LedgerV2HolderRevokeOperation = {
    attestationHash: toHex(bytes32(input.attestationHash)),
    requestIdHash: ledgerV2RequestHash(input.requestId),
    reasonHash: ledgerV2ReasonHash(input.reason),
    nonce: String(input.nonce),
    deadline: input.deadline,
  };
  const structHash = keccak_256(concat(
    typeHash('HolderRevoke(bytes32 attestationHash,bytes32 requestIdHash,bytes32 reasonHash,uint256 nonce,uint64 deadline)'),
    bytes32(operation.attestationHash),
    bytes32(operation.requestIdHash),
    bytes32(operation.reasonHash),
    uint256(operation.nonce),
    uint256(operation.deadline),
  ));
  const privateKey = fromHex(input.key.privateKeyHex);
  if (!secp256k1.utils.isValidSecretKey(privateKey)) throw new Error('holder_revocation_private_key_invalid');
  const signature = secp256k1.sign(typedDigest(input.domain, structHash), privateKey, { lowS: true, prehash: false });
  if (signature.recovery === undefined) throw new Error('ledger_v2_signature_recovery_missing');
  return { operation, signature: toHex(concat(signature.toCompactRawBytes(), Uint8Array.from([signature.recovery + 27]))) };
}

export async function resolveLedgerV2Attestation(readGatewayUrl: string, attestationHash: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
  const response = await fetchImpl(`${readGatewayUrl.replace(/\/+$/, '')}/v2/attestations/${encodeURIComponent(attestationHash)}`, { headers: { accept: 'application/json' } });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || result.success === false) throw new Error(String(result.error ?? 'ledger_v2_read_failed'));
  return result;
}

export async function submitLedgerV2HolderRevoke(input: {
  relayerUrls: string[];
  payload: { operation: LedgerV2HolderRevokeOperation; signature: string };
  fetch?: typeof globalThis.fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const failures: string[] = [];
  for (const baseUrl of input.relayerUrls) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v2/operations/revoke/holder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input.payload),
      });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok && result.success !== false) return result;
      failures.push(`${response.status}:${String(result.error ?? 'rejected')}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.name : 'network_error');
    }
  }
  throw new Error(`ledger_v2_relayers_unavailable:${failures.join(',')}`);
}

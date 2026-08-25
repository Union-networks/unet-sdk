import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

export const LEDGER_V2_EIP712_NAME = 'U-net Attestation Ledger';
export const LEDGER_V2_EIP712_VERSION = '2';

export interface LedgerV2Signer {
  issuerId: string;
  keyId: string;
  privateKeyHex: string;
  address: string;
  keyEpoch: number;
}

export interface LedgerV2Domain {
  chainId: number | bigint;
  ledgerAddress: string;
}

export interface LedgerV2AnchorOperation {
  attestationHash: string;
  issuerIdHash: string;
  holderRevocationSigner: string;
  requestIdHash: string;
  issuerKeyEpoch: number;
  nonce: string;
  deadline: number;
}

export interface LedgerV2IssuerRevokeOperation {
  attestationHash: string;
  issuerIdHash: string;
  requestIdHash: string;
  reasonHash: string;
  issuerKeyEpoch: number;
  nonce: string;
  deadline: number;
}

export interface LedgerV2IssuerRotateOperation {
  issuerIdHash: string;
  newSigner: string;
  nonce: string;
  deadline: number;
}

export interface LedgerV2IssuerRetireOperation {
  issuerIdHash: string;
  nonce: string;
  deadline: number;
}

const utf8 = new TextEncoder();
const bytes = (value: string) => Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));
const hex = (value: Uint8Array) => `0x${Buffer.from(value).toString('hex')}`;
const concat = (...values: Uint8Array[]) => Uint8Array.from(Buffer.concat(values.map((value) => Buffer.from(value))));
const uint256 = (value: string | number | bigint) => bytes(BigInt(value).toString(16).padStart(64, '0'));
const bytes32 = (value: string) => {
  const result = bytes(value);
  if (result.length !== 32) throw new Error('ledger_v2_bytes32_invalid');
  return result;
};
const addressWord = (value: string) => {
  const result = bytes(value);
  if (result.length !== 20) throw new Error('ledger_v2_address_invalid');
  return concat(new Uint8Array(12), result);
};
const hashText = (value: string) => keccak_256(utf8.encode(value));
const typeHash = (value: string) => hashText(value);

const domainSeparator = (domain: LedgerV2Domain) => keccak_256(concat(
  typeHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  hashText(LEDGER_V2_EIP712_NAME),
  hashText(LEDGER_V2_EIP712_VERSION),
  uint256(domain.chainId),
  addressWord(domain.ledgerAddress),
));

const issuerRegistryDomainSeparator = (domain: LedgerV2Domain) => keccak_256(concat(
  typeHash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  hashText('U-net Issuer Registry'),
  hashText('2'),
  uint256(domain.chainId),
  addressWord(domain.ledgerAddress),
));

const digest = (domain: LedgerV2Domain, structHash: Uint8Array) => keccak_256(concat(
  Uint8Array.from([0x19, 0x01]),
  domainSeparator(domain),
  structHash,
));

const registryDigest = (domain: LedgerV2Domain, structHash: Uint8Array) => keccak_256(concat(
  Uint8Array.from([0x19, 0x01]),
  issuerRegistryDomainSeparator(domain),
  structHash,
));

const signDigest = (digestBytes: Uint8Array, privateKeyHex: string): string => {
  const signature = secp256k1.sign(digestBytes, bytes(privateKeyHex), { lowS: true, prehash: false });
  if (signature.recovery === undefined) throw new Error('ledger_v2_signature_recovery_missing');
  return hex(concat(signature.toCompactRawBytes(), Uint8Array.from([signature.recovery + 27])));
};

export const ledgerV2IssuerIdHash = (issuerId: string): string => hex(hashText(issuerId));
export const ledgerV2RequestHash = (requestId: string): string => hex(hashText(requestId));
export const ledgerV2ReasonHash = (reason: string): string => hex(hashText(reason));

export function generateLedgerV2Signer(input: { issuerId: string; keyId?: string; keyEpoch?: number }): LedgerV2Signer {
  const privateKey = secp256k1.utils.randomSecretKey(randomBytes(48));
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const address = hex(keccak_256(publicKey.slice(1)).slice(-20));
  return {
    issuerId: input.issuerId,
    keyId: input.keyId ?? `${input.issuerId}#ledger-1`,
    privateKeyHex: hex(privateKey),
    address,
    keyEpoch: input.keyEpoch ?? 1,
  };
}

export function generateLedgerV2SignerEnv(input: { issuerId: string; keyId?: string }): string {
  const signer = generateLedgerV2Signer(input);
  return [
    `UNET_ISSUER_LEDGER_KEY_ID=${signer.keyId}`,
    `UNET_ISSUER_LEDGER_PRIVATE_KEY=${signer.privateKeyHex}`,
    `UNET_ISSUER_LEDGER_ADDRESS=${signer.address}`,
    `UNET_ISSUER_LEDGER_KEY_EPOCH=${signer.keyEpoch}`,
  ].join('\n');
}

export function createLedgerV2SignerFromEnv(
  issuerId: string,
  env: Record<string, string | undefined> = process.env,
  prefix = 'UNET_ISSUER_LEDGER',
): LedgerV2Signer {
  if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) throw new Error('issuer_ledger_environment_prefix_invalid');
  const keyId = env[`${prefix}_KEY_ID`];
  const privateKeyHex = env[`${prefix}_PRIVATE_KEY`];
  const configuredAddress = env[`${prefix}_ADDRESS`];
  const keyEpoch = Number(env[`${prefix}_KEY_EPOCH`] ?? '1');
  if (!keyId || !privateKeyHex || !configuredAddress || !Number.isInteger(keyEpoch) || keyEpoch < 1) {
    throw new Error('issuer_ledger_signer_environment_missing');
  }
  const privateKey = bytes(privateKeyHex);
  if (!secp256k1.utils.isValidSecretKey(privateKey)) throw new Error('issuer_ledger_private_key_invalid');
  const derivedAddress = hex(keccak_256(secp256k1.getPublicKey(privateKey, false).slice(1)).slice(-20));
  if (derivedAddress.toLowerCase() !== configuredAddress.toLowerCase()) throw new Error('issuer_ledger_address_mismatch');
  return { issuerId, keyId, privateKeyHex: hex(privateKey), address: derivedAddress, keyEpoch };
}

export function signLedgerV2Anchor(input: {
  domain: LedgerV2Domain;
  signer: LedgerV2Signer;
  attestationHash: string;
  holderRevocationSigner: string;
  requestId: string;
  nonce: string | number | bigint;
  deadline: number;
}): { operation: LedgerV2AnchorOperation; signature: string } {
  const operation: LedgerV2AnchorOperation = {
    attestationHash: hex(bytes32(input.attestationHash)),
    issuerIdHash: ledgerV2IssuerIdHash(input.signer.issuerId),
    holderRevocationSigner: hex(bytes(input.holderRevocationSigner)),
    requestIdHash: ledgerV2RequestHash(input.requestId),
    issuerKeyEpoch: input.signer.keyEpoch,
    nonce: String(input.nonce),
    deadline: input.deadline,
  };
  const structHash = keccak_256(concat(
    typeHash('Anchor(bytes32 attestationHash,bytes32 issuerIdHash,address holderRevocationSigner,bytes32 requestIdHash,uint64 issuerKeyEpoch,uint256 nonce,uint64 deadline)'),
    bytes32(operation.attestationHash),
    bytes32(operation.issuerIdHash),
    addressWord(operation.holderRevocationSigner),
    bytes32(operation.requestIdHash),
    uint256(operation.issuerKeyEpoch),
    uint256(operation.nonce),
    uint256(operation.deadline),
  ));
  return { operation, signature: signDigest(digest(input.domain, structHash), input.signer.privateKeyHex) };
}

export function signLedgerV2IssuerRevoke(input: {
  domain: LedgerV2Domain;
  signer: LedgerV2Signer;
  attestationHash: string;
  requestId: string;
  reason: string;
  nonce: string | number | bigint;
  deadline: number;
}): { operation: LedgerV2IssuerRevokeOperation; signature: string } {
  const operation: LedgerV2IssuerRevokeOperation = {
    attestationHash: hex(bytes32(input.attestationHash)),
    issuerIdHash: ledgerV2IssuerIdHash(input.signer.issuerId),
    requestIdHash: ledgerV2RequestHash(input.requestId),
    reasonHash: ledgerV2ReasonHash(input.reason),
    issuerKeyEpoch: input.signer.keyEpoch,
    nonce: String(input.nonce),
    deadline: input.deadline,
  };
  const structHash = keccak_256(concat(
    typeHash('IssuerRevoke(bytes32 attestationHash,bytes32 issuerIdHash,bytes32 requestIdHash,bytes32 reasonHash,uint64 issuerKeyEpoch,uint256 nonce,uint64 deadline)'),
    bytes32(operation.attestationHash),
    bytes32(operation.issuerIdHash),
    bytes32(operation.requestIdHash),
    bytes32(operation.reasonHash),
    uint256(operation.issuerKeyEpoch),
    uint256(operation.nonce),
    uint256(operation.deadline),
  ));
  return { operation, signature: signDigest(digest(input.domain, structHash), input.signer.privateKeyHex) };
}

export function signLedgerV2IssuerRotate(input: {
  domain: LedgerV2Domain;
  signer: LedgerV2Signer;
  newSigner: string;
  nonce: string | number | bigint;
  deadline: number;
}): { operation: LedgerV2IssuerRotateOperation; signature: string } {
  const operation: LedgerV2IssuerRotateOperation = {
    issuerIdHash: ledgerV2IssuerIdHash(input.signer.issuerId),
    newSigner: hex(bytes(input.newSigner)),
    nonce: String(input.nonce),
    deadline: input.deadline,
  };
  const structHash = keccak_256(concat(
    typeHash('RotateIssuer(bytes32 issuerIdHash,address newSigner,uint64 currentKeyEpoch,uint256 nonce,uint64 deadline)'),
    bytes32(operation.issuerIdHash),
    addressWord(operation.newSigner),
    uint256(input.signer.keyEpoch),
    uint256(operation.nonce),
    uint256(operation.deadline),
  ));
  return { operation, signature: signDigest(registryDigest(input.domain, structHash), input.signer.privateKeyHex) };
}

export function signLedgerV2IssuerRetire(input: {
  domain: LedgerV2Domain;
  signer: LedgerV2Signer;
  nonce: string | number | bigint;
  deadline: number;
}): { operation: LedgerV2IssuerRetireOperation; signature: string } {
  const operation: LedgerV2IssuerRetireOperation = {
    issuerIdHash: ledgerV2IssuerIdHash(input.signer.issuerId),
    nonce: String(input.nonce),
    deadline: input.deadline,
  };
  const structHash = keccak_256(concat(
    typeHash('RetireIssuer(bytes32 issuerIdHash,uint64 currentKeyEpoch,uint256 nonce,uint64 deadline)'),
    bytes32(operation.issuerIdHash),
    uint256(input.signer.keyEpoch),
    uint256(operation.nonce),
    uint256(operation.deadline),
  ));
  return { operation, signature: signDigest(registryDigest(input.domain, structHash), input.signer.privateKeyHex) };
}

export async function submitLedgerV2Operation(input: {
  relayerUrls: string[];
  path: '/v2/operations/anchor' | '/v2/operations/revoke/issuer' | '/v2/operations/issuer/rotate' | '/v2/operations/issuer/retire';
  payload: { operation: Record<string, unknown>; signature: string };
  fetch?: typeof globalThis.fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch_unavailable');
  const failures: string[] = [];
  for (const baseUrl of input.relayerUrls) {
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${input.path}`, {
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

export async function anchorLedgerV2CredentialFromEnv(input: {
  issuerId: string;
  attestationHash: string;
  holderRevocationSigner: string;
  requestId: string;
  env?: Record<string, string | undefined>;
  signerEnvPrefix?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ transactionHash: string; issuerIdHash: string }> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch_unavailable');
  const chainId = Number(env.LEDGER_V2_CHAIN_ID);
  const ledgerAddress = env.LEDGER_V2_CONTRACT_ADDRESS;
  const readUrl = env.LEDGER_V2_READ_URL?.replace(/\/+$/, '');
  const relayerUrls = (env.LEDGER_V2_RELAYER_URLS ?? '').split(',').map((value) => value.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!Number.isSafeInteger(chainId) || !ledgerAddress || !readUrl || relayerUrls.length < 2) {
    throw new Error('ledger_v2_provider_configuration_incomplete');
  }
  const signer = createLedgerV2SignerFromEnv(input.issuerId, env, input.signerEnvPrefix);
  const issuerIdHash = ledgerV2IssuerIdHash(input.issuerId);
  const nonceResponse = await fetchImpl(`${readUrl}/v2/nonces/issuer/${issuerIdHash}`, { cache: 'no-store' });
  const nonceBody = await nonceResponse.json().catch(() => ({})) as { result?: { ledgerNonce?: string }; error?: string };
  if (!nonceResponse.ok || nonceBody.result?.ledgerNonce === undefined) throw new Error(nonceBody.error ?? 'ledger_v2_nonce_unavailable');
  const signed = signLedgerV2Anchor({
    domain: { chainId, ledgerAddress },
    signer,
    attestationHash: input.attestationHash,
    holderRevocationSigner: input.holderRevocationSigner,
    requestId: input.requestId,
    nonce: nonceBody.result.ledgerNonce,
    deadline: Math.floor(Date.now() / 1000) + 300,
  });
  const submitted = await submitLedgerV2Operation({
    relayerUrls,
    path: '/v2/operations/anchor',
    payload: { operation: { ...signed.operation }, signature: signed.signature },
    fetch: fetchImpl,
  });
  const transactionHash = String(submitted.transactionHash ?? '');
  if (!/^0x[a-f0-9]{64}$/i.test(transactionHash)) throw new Error('ledger_v2_transaction_hash_missing');
  return { transactionHash, issuerIdHash };
}

export async function revokeLedgerV2CredentialFromEnv(input: {
  issuerId: string;
  attestationHash: string;
  requestId: string;
  reason: string;
  env?: Record<string, string | undefined>;
  signerEnvPrefix?: string;
  fetch?: typeof globalThis.fetch;
}): Promise<{ transactionHash: string; issuerIdHash: string }> {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch_unavailable');
  const chainId = Number(env.LEDGER_V2_CHAIN_ID);
  const ledgerAddress = env.LEDGER_V2_CONTRACT_ADDRESS;
  const readUrl = env.LEDGER_V2_READ_URL?.replace(/\/+$/, '');
  const relayerUrls = (env.LEDGER_V2_RELAYER_URLS ?? '').split(',').map((value) => value.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!Number.isSafeInteger(chainId) || !ledgerAddress || !readUrl || relayerUrls.length < 2) {
    throw new Error('ledger_v2_provider_configuration_incomplete');
  }
  const signer = createLedgerV2SignerFromEnv(input.issuerId, env, input.signerEnvPrefix);
  const issuerIdHash = ledgerV2IssuerIdHash(input.issuerId);
  const nonceResponse = await fetchImpl(`${readUrl}/v2/nonces/issuer/${issuerIdHash}`, { cache: 'no-store' });
  const nonceBody = await nonceResponse.json().catch(() => ({})) as { result?: { ledgerNonce?: string }; error?: string };
  if (!nonceResponse.ok || nonceBody.result?.ledgerNonce === undefined) throw new Error(nonceBody.error ?? 'ledger_v2_nonce_unavailable');
  const signed = signLedgerV2IssuerRevoke({
    domain: { chainId, ledgerAddress },
    signer,
    attestationHash: input.attestationHash,
    requestId: input.requestId,
    reason: input.reason,
    nonce: nonceBody.result.ledgerNonce,
    deadline: Math.floor(Date.now() / 1000) + 300,
  });
  const submitted = await submitLedgerV2Operation({
    relayerUrls,
    path: '/v2/operations/revoke/issuer',
    payload: { operation: { ...signed.operation }, signature: signed.signature },
    fetch: fetchImpl,
  });
  const transactionHash = String(submitted.transactionHash ?? '');
  if (!/^0x[a-f0-9]{64}$/i.test(transactionHash)) throw new Error('ledger_v2_transaction_hash_missing');
  return { transactionHash, issuerIdHash };
}

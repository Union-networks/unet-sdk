import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildFieldMerkleProofV2,
  createCredentialEnvelopeV2,
  deriveClaimLeafV2,
  deriveHolderBindingV2,
  deriveNullifierV2,
  derivePredicateV2,
  generateCredentialSigningKeyPair,
} from '../packages/issuer/dist/index.js';

const root = process.argv[2];
if (!root) throw new Error('usage: node generate-generic-fixtures.mjs <zk-repo>');

const q = (value) => JSON.stringify(String(value));
const array = (values, quote = true) => `[${values.map((value) => quote ? q(value) : String(value)).join(', ')}]`;
const fromB64 = (value) => [...Buffer.from(value, 'base64url')];
const fieldFromHex = (value) => BigInt(`0x${value}`).toString(10);
const now = 1_800_000_000;
const holderSecret = '424242424242424242424242';
const holderBinding = await deriveHolderBindingV2(holderSecret);
const credentialKeys = generateCredentialSigningKeyPair();
const claim = { path: 'age_years', type: 'u64', value: 21 };
const envelope = await createCredentialEnvelopeV2({
  requestType: 'golden-generic-credential',
  schemaId: 'unet.test.generic-credential.v1',
  issuerId: 'issuer:golden-vector',
  issuerKeyId: 'issuer:golden-vector#api',
  issuerCredentialKeyId: 'issuer:golden-vector#credential-v1',
  credentialPrivateKeyPem: credentialKeys.privateKeyPem,
  holderBinding,
  validFromEpoch: now - 3600,
  validUntilEpoch: now + 86400,
  statusEpoch: 7,
  claims: [claim],
  claimSalts: ['11'],
  commitmentSalt: '22',
});
const proof = envelope.claims[0];
const attestationCommitment = fieldFromHex(envelope.attestationCommitment);
const commonCredential = {
  message_hash: fromB64(envelope.messageHash),
  issuer_pub_key_x: fromB64(envelope.issuerPublicKeyX),
  issuer_pub_key_y: fromB64(envelope.issuerPublicKeyY),
  issuer_signature: fromB64(envelope.signature),
  issuer_key_id: envelope.issuerKeyIdField,
  holder_secret: holderSecret,
  valid_from_epoch: envelope.validFromEpoch,
  valid_until_epoch: envelope.validUntilEpoch,
  claims_root: envelope.claimsRoot,
  commitment_salt: envelope.commitmentSalt,
};

const credentialToml = (credential) => [
  '[credential]',
  `message_hash = ${array(credential.message_hash, false)}`,
  `issuer_pub_key_x = ${array(credential.issuer_pub_key_x, false)}`,
  `issuer_pub_key_y = ${array(credential.issuer_pub_key_y, false)}`,
  `issuer_signature = ${array(credential.issuer_signature, false)}`,
  `issuer_key_id = ${q(credential.issuer_key_id)}`,
  `holder_secret = ${q(credential.holder_secret)}`,
  `valid_from_epoch = ${q(credential.valid_from_epoch)}`,
  `valid_until_epoch = ${q(credential.valid_until_epoch)}`,
  `claims_root = ${q(credential.claims_root)}`,
  `commitment_salt = ${q(credential.commitment_salt)}`,
  '',
];

const profiles = [
  { id: 'credential_valid_v1' },
  { id: 'claim_equals_v1', claim: true, extra: { expected_value: proof.valueField } },
  { id: 'claim_range_v1', claim: true, extra: { claim_value_u64: 21, lower_bound: 18, upper_bound: 150 } },
  { id: 'claim_present_v1', claim: true },
  { id: 'credential_not_expired_v1' },
];

const memberSalt = '77';
const memberLeaf = await deriveClaimLeafV2(claim, memberSalt);
const memberProof = await buildFieldMerkleProofV2({ leaves: [memberLeaf], selectedIndex: 0 });
profiles.push({
  id: 'claim_set_membership_v1',
  claim: true,
  extra: {
    member_salt: memberSalt,
    member_siblings: memberProof.siblings,
    member_path_bits: memberProof.pathBits,
    allowed_set_root: memberProof.root,
  },
});
const issuerProof = await buildFieldMerkleProofV2({ leaves: [envelope.issuerKeyHash], selectedIndex: 0 });
profiles.push({
  id: 'credential_issuer_member_v1',
  extra: {
    issuer_siblings: issuerProof.siblings,
    issuer_path_bits: issuerProof.pathBits,
    issuer_set_root: issuerProof.root,
  },
});

const vectors = { version: 2, holderSecret, holderBinding, credentialPublicKeyPem: credentialKeys.publicKeyPem, envelope, profiles: {} };
for (const profile of profiles) {
  const predicate = await derivePredicateV2({
    proofProfileId: profile.id,
    schemaId: envelope.schemaId,
    claimPath: profile.claim ? claim.path : undefined,
    claimType: profile.claim ? claim.type : undefined,
    expectedValue: profile.id === 'claim_equals_v1' ? claim.value : undefined,
    lowerBound: profile.id === 'claim_range_v1' ? 18 : undefined,
    upperBound: profile.id === 'claim_range_v1' ? 150 : undefined,
    setRoot: profile.id === 'claim_set_membership_v1' ? memberProof.root : profile.id === 'credential_issuer_member_v1' ? issuerProof.root : undefined,
  });
  const nonce = String(9000 + profiles.indexOf(profile));
  const nullifier = await deriveNullifierV2({ holderSecret, attestationCommitment: envelope.attestationCommitment, nonce, predicate });
  const values = {
    ...(profile.claim ? {
      claim_path: proof.pathField,
      claim_type: proof.typeField,
      claim_value: proof.valueField,
      claim_salt: proof.salt,
      claim_siblings: proof.siblings,
      claim_path_bits: proof.pathBits,
    } : {}),
    ...(profile.extra ?? {}),
    nullifier,
    nonce,
    predicate,
    attestation_commitment: attestationCommitment,
    schema_id: envelope.schemaIdField,
    issuer_key_hash: envelope.issuerKeyHash,
    status_epoch: envelope.statusEpoch,
    verification_epoch: now,
  };
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) lines.push(`${key} = ${array(value, typeof value[0] !== 'boolean')}`);
    else lines.push(`${key} = ${typeof value === 'boolean' ? value : q(value)}`);
  }
  lines.push('', ...credentialToml(commonCredential));
  const circuitDir = join(root, 'circuits', profile.id);
  await writeFile(join(circuitDir, 'Prover.toml'), lines.join('\n'));
  await writeFile(join(circuitDir, 'Prover.toml.example'), lines.join('\n'));
  vectors.profiles[profile.id] = values;
}

const vectorDir = join(root, 'test-vectors');
await mkdir(vectorDir, { recursive: true });
await writeFile(join(vectorDir, 'generic-credential-v2.json'), `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`Wrote deterministic fixtures for ${profiles.length} profiles.`);

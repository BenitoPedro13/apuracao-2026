import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { TseJwk } from '@apuracao/tse';

// The ephemeral test key for rebuilt coverage files (TASK-fake-tse.md §2.2). Rebuilt files
// can't carry the TSE's signature, so they're signed with a key generated at start and
// trusted only by a recorder/projector given TSE_TEST_JWK_URL (never on the production
// bucket). Real files keep the TSE's `prod` signature.

export const TEST_JWK_PATH = 'app/assets/assinatura-jws/test.jwk.json';

export interface Signer {
  jwk: TseJwk;
  /** Compact JWS over `payload`, in the TSE's form: header {kid, typ: JOSE, alg: EdDSA}. */
  sign(payload: Uint8Array): Buffer;
}

export function createTestSigner(): Signer {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = `fake-tse-${randomBytes(6).toString('base64url')}`;
  return signerFor(privateKey, { ...(publicKey.export({ format: 'jwk' }) as { x: string }), kty: 'OKP', crv: 'Ed25519', kid });
}

function signerFor(privateKey: KeyObject, jwk: TseJwk): Signer {
  const header = Buffer.from(JSON.stringify({ kid: jwk.kid, typ: 'JOSE', alg: 'EdDSA' })).toString('base64url');
  return {
    jwk,
    sign(payload) {
      const input = `${header}.${Buffer.from(payload).toString('base64url')}`;
      return Buffer.from(`${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`);
    },
  };
}

/** The payload bytes of a compact JWS (no verification). */
export const jwsPayload = (token: Uint8Array): Buffer => Buffer.from(Buffer.from(token).toString('utf8').trim().split('.')[1] ?? '', 'base64url');

/** Flip one character in the middle of the signature segment: still well-formed, never valid. */
export function corruptSignature(token: Buffer): Buffer {
  const text = token.toString('utf8');
  const at = text.lastIndexOf('.') + Math.floor((text.length - text.lastIndexOf('.')) / 2);
  return Buffer.from(text.slice(0, at) + (text[at] === 'A' ? 'B' : 'A') + text.slice(at + 1));
}

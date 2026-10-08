// Compact JWS (EdDSA / Ed25519) verification for TSE files, on WebCrypto only, so the same
// code runs in Node 24 and in browsers ("verify this number"). How the TSE signs: research
// 02 §2. Handling an unknown kid (fetch the JWK, page a human) is the recorder's job.

export interface TseJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
}

/** Imported verification keys by kid. Build once with `importKeys`. */
export type Keyring = ReadonlyMap<string, CryptoKey>;

export type JwsResult =
  | { status: 'valid'; kid: string; payload: Uint8Array }
  | { status: 'invalid'; kid: string; reason: string }
  | { status: 'unknown_kid'; kid: string; reason: string }
  | { status: 'malformed'; reason: string };

export async function importKeys(jwks: readonly TseJwk[]): Promise<Keyring> {
  const entries = await Promise.all(
    jwks.map(async (jwk) => {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
      return [jwk.kid, key] as const;
    }),
  );
  return new Map(entries);
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function decodeBase64url(segment: string): Uint8Array<ArrayBuffer> {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export async function verifyJws(token: string, keys: Keyring): Promise<JwsResult> {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) {
    return { status: 'malformed', reason: 'not a compact JWS with an embedded payload' };
  }
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: unknown; kid?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64url(h))) as typeof header;
  } catch {
    return { status: 'malformed', reason: 'protected header is not JSON' };
  }
  if (header.alg !== 'EdDSA') return { status: 'malformed', reason: `alg ${String(header.alg)} is not EdDSA` };
  if (typeof header.kid !== 'string') return { status: 'malformed', reason: 'no kid' };

  const kid = header.kid;
  const key = keys.get(kid);
  if (!key) return { status: 'unknown_kid', kid, reason: `kid ${kid} is not in the keyring` };

  const ok = await crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    decodeBase64url(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  return ok
    ? { status: 'valid', kid, payload: decodeBase64url(p) }
    : { status: 'invalid', kid, reason: 'signature does not verify' };
}

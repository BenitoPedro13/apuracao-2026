import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, test } from 'vitest';
import { importKeys, verifyJws, type Keyring, type TseJwk } from './jws.js';
import { SAMPLES, readSample, sampleNames } from './samples.test-helper.js';

const pinned = JSON.parse(readFileSync(new URL('../keys/prod.jwk.json', import.meta.url), 'utf8')) as TseJwk;
let keys: Keyring;
beforeAll(async () => {
  keys = await importKeys([pinned]);
});

const JWS = sampleNames('jws');
const b64 = (s: string) => Buffer.from(s).toString('base64url');
const flipChar = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);

test('the pinned key is the key the TSE app serves', () => {
  expect(pinned).toEqual(JSON.parse(readFileSync(new URL('app_assets_assinatura-jws_prod.jwk.json', SAMPLES), 'utf8')));
  expect(JWS).toHaveLength(9);
});

describe.each(JWS)('%s', (name) => {
  const token = () => readSample(name).toString('utf8');

  test('verifies, and its payload equals the saved .json byte for byte', async () => {
    const r = await verifyJws(token(), keys);
    expect(r.status).toBe('valid');
    const jsonName = name.replace(/\.jws$/, '.json');
    if (sampleNames('json').includes(jsonName) && r.status === 'valid') {
      expect(Buffer.from(r.payload).equals(readSample(jsonName))).toBe(true);
    }
  });

  test('one changed character in the payload → invalid', async () => {
    const [h, p, s] = token().trim().split('.') as [string, string, string];
    expect((await verifyJws(`${h}.${flipChar(p, 40)}.${s}`, keys)).status).toBe('invalid');
  });

  test('one changed character in the signature → invalid', async () => {
    const [h, p, s] = token().trim().split('.') as [string, string, string];
    expect((await verifyJws(`${h}.${p}.${flipChar(s, 10)}`, keys)).status).toBe('invalid');
  });
});

describe('header and shape checks (derived from a real token)', () => {
  const token = () => readSample(JWS[0]!).toString('utf8').trim();
  const reheader = (header: object) => {
    const [, p, s] = token().split('.');
    return `${b64(JSON.stringify(header))}.${p}.${s}`;
  };

  test('another kid → unknown_kid', async () => {
    const r = await verifyJws(reheader({ kid: 'not-the-prod-key', typ: 'JOSE', alg: 'EdDSA' }), keys);
    expect(r).toMatchObject({ status: 'unknown_kid', kid: 'not-the-prod-key' });
  });
  test('alg other than EdDSA → malformed', async () => {
    const r = await verifyJws(reheader({ kid: pinned.kid, typ: 'JOSE', alg: 'none' }), keys);
    expect(r.status).toBe('malformed');
  });
  test('two segments → malformed', async () => {
    const [h, p] = token().split('.');
    expect((await verifyJws(`${h}.${p}`, keys)).status).toBe('malformed');
  });
  test('detached payload → malformed', async () => {
    const [h, , s] = token().split('.');
    expect((await verifyJws(`${h}..${s}`, keys)).status).toBe('malformed');
  });
});

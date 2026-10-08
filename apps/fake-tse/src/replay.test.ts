import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { REPLAY_START_1T } from './reveal.js';
import { startFakeTse, type FakeTse } from './server.js';
import { jwsPayload, TEST_JWK_PATH } from './sign.js';

const samplesDir = fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
const SP_AB = 'ele2026/6257/dados/sp/sp-e006257-ab.jws';
const SP_MU = 'ele2026/6257/dados/sp/sp71072-c0001-e006257-u.jws';
let wall = Date.UTC(2026, 9, 22, 12, 0, 0);
let tse: FakeTse;

beforeAll(async () => {
  tse = await startFakeTse({ samplesDir, maxAgeSeconds: 60, now: () => wall, reveal: { origin: REPLAY_START_1T, speed: 20 } });
});
afterAll(() => tse.close());

const get = (path: string, headers: Record<string, string> = {}) => fetch(tse.url + path, { headers: { 'accept-encoding': 'identity', ...headers } });
const control = (what: string, body: unknown) =>
  fetch(tse.url.replace('/oficial/', `/_control/${what}`), { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
/**
 * Pause the replay at `iso` and move past the current edge window (3 s of wall at ×20): the
 * edge serves what the origin had when its window opened.
 */
async function jump(iso: string) {
  await control('clock', { at: iso, paused: true });
  wall += 10_000;
}

test('edge window is the TSE 60 s in replay time: 3 s of wall time at ×20', async () => {
  const res = await get(SP_AB);
  expect(res.status).toBe(200);
  expect(Number(/max-age=(\d+)/.exec(res.headers.get('cache-control')!)![1])).toBeLessThanOrEqual(3);
  expect(Date.parse(res.headers.get('expires')!) - wall).toBeLessThanOrEqual(3_000);
});

test('a municipal file is 404 until its row instant, then byte-identical with ETag = MD5', async () => {
  await jump('2026-10-04T21:50:00-03:00');
  expect((await get(SP_MU)).status).toBe(404);
  await jump('2026-10-04T21:50:33-03:00');
  const res = await get(SP_MU);
  expect(res.status).toBe(200);
  const body = Buffer.from(await res.arrayBuffer());
  expect(body.equals(readFileSync(`${samplesDir}/${SP_MU.replace(/\//g, '_')}`))).toBe(true);
  expect(res.headers.get('etag')).toBe(`"${createHash('md5').update(body).digest('hex')}"`);
  expect(tse.log.at(-1)).toMatchObject({ status: 200, version: 'final', sha256: createHash('sha256').update(body).digest('hex') });
});

test('the coverage file changes ETag between reveal steps, 304 within one', async () => {
  await jump('2026-10-04T19:00:00-03:00');
  const a = await get(SP_AB);
  const idgA = Number((JSON.parse(jwsPayload(Buffer.from(await a.arrayBuffer())).toString('utf8')) as { idg: string }).idg);
  expect((await get(SP_AB, { 'if-none-match': a.headers.get('etag')! })).status).toBe(304);
  await jump('2026-10-04T20:00:00-03:00');
  const b = await get(SP_AB, { 'if-none-match': a.headers.get('etag')! });
  expect(b.status).toBe(200);
  expect(b.headers.get('etag')).not.toBe(a.headers.get('etag'));
  const idgB = Number((JSON.parse(jwsPayload(Buffer.from(await b.arrayBuffer())).toString('utf8')) as { idg: string }).idg);
  expect(idgB).toBeGreaterThan(idgA);
});

test('serves the test JWK and the TSE prod JWK', async () => {
  expect(await (await get(TEST_JWK_PATH)).json()).toMatchObject({ kid: tse.signer!.jwk.kid, kty: 'OKP', crv: 'Ed25519' });
  expect((await get('app/assets/assinatura-jws/prod.jwk.json')).status).toBe(200);
});

test('faults: 429 with Retry-After, regression to a lower idg, a corrupted signature', async () => {
  await control('faults', { seed: 7, errors: { rate429: 1, retryAfterS: 9 } });
  const r429 = await get(SP_AB);
  expect(r429.status).toBe(429);
  expect(r429.headers.get('retry-after')).toBe('9');

  await control('faults', { regression: { paths: [SP_AB], rate: 1 } });
  await jump('2026-10-04T20:30:00-03:00');
  const regressed = JSON.parse(jwsPayload(Buffer.from(await (await get(SP_AB)).arrayBuffer())).toString('utf8')) as { idg: string };
  await control('faults', {});
  wall += 10_000;
  const current = JSON.parse(jwsPayload(Buffer.from(await (await get(SP_AB)).arrayBuffer())).toString('utf8')) as { idg: string };
  expect(Number(regressed.idg)).toBe(Number(current.idg) - 1);

  await control('faults', { badSignature: [SP_MU] });
  await jump('2026-10-04T22:00:00-03:00');
  const bad = Buffer.from(await (await get(SP_MU)).arrayBuffer());
  expect(bad.equals(readFileSync(`${samplesDir}/${SP_MU.replace(/\//g, '_')}`))).toBe(false);
  expect(tse.log.at(-1)?.version).toBe('final+badsig');
  await control('faults', {});
});

test('the clock pauses, changes speed, and reports when the replay is done', async () => {
  const s1 = (await control('clock', { paused: true })) as { tReal: string };
  wall += 60_000;
  const s2 = (await (await fetch(tse.url.replace('/oficial/', '/_control/state'))).json()) as { tReal: string; done: boolean };
  expect(s2.tReal).toBe(s1.tReal);
  await control('clock', { paused: false, at: new Date(tse.replay!.endsAt).toISOString() });
  expect(tse.replay!.done).toBe(true);
});

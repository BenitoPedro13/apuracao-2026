import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startFakeTse, type FakeTse } from './server.js';

const samplesDir = fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
const NAME = 'ele2026_6257_dados_br_br-c0001-e006257-u.jws';
const PATH = NAME.replace(/_/g, '/');
let clock = Date.UTC(2026, 9, 25, 20, 0, 0);
let tse: FakeTse;

beforeAll(async () => {
  tse = await startFakeTse({ samplesDir, maxAgeSeconds: 60, now: () => clock });
});
afterAll(() => tse.close());

test('serves a sample byte for byte with ETag = MD5 and a fixed Expires', async () => {
  const body = readFileSync(`${samplesDir}/${NAME}`);
  const res = await fetch(tse.url + PATH, { headers: { 'accept-encoding': 'identity' } });
  expect(res.status).toBe(200);
  expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  expect(res.headers.get('etag')).toBe(`"${createHash('md5').update(body).digest('hex')}"`);
  const expires = Date.parse(res.headers.get('expires')!);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control')!)![1]);
  expect(expires).toBeGreaterThan(clock);
  expect(Math.abs(expires - clock - maxAge * 1000)).toBeLessThanOrEqual(1000);

  // max-age counts down to the same Expires
  clock += 5000;
  const again = await fetch(tse.url + PATH);
  expect(Date.parse(again.headers.get('expires')!)).toBe(expires);
});

test('If-None-Match with the current ETag → 304, and requests before Expires are flagged', async () => {
  const first = await fetch(tse.url + PATH);
  const res = await fetch(tse.url + PATH, { headers: { 'if-none-match': first.headers.get('etag')! } });
  expect(res.status).toBe(304);
  expect(tse.log.at(-1)).toMatchObject({ status: 304, conditional: true, early: true });
  clock = Date.parse(first.headers.get('expires')!) + 1500;
  await fetch(tse.url + PATH, { headers: { 'if-none-match': first.headers.get('etag')! } });
  expect(tse.log.at(-1)?.early).toBe(false);
});

test('gzip on request decodes to the same bytes', async () => {
  const { request } = await import('node:http');
  const raw = await new Promise<Buffer>((resolve) => {
    request(tse.url + PATH, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      expect(res.headers['content-encoding']).toBe('gzip');
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks)));
    }).end();
  });
  expect(gunzipSync(raw).equals(readFileSync(`${samplesDir}/${NAME}`))).toBe(true);
});

test('unknown paths and any query string → 404 (cache-busting is never served)', async () => {
  expect((await fetch(tse.url + 'ele2026/6258/dados/br/br-c0001-e006258-u.jws')).status).toBe(404);
  expect((await fetch(tse.url + PATH + '?nocache=1')).status).toBe(404);
  expect(tse.log.at(-1)?.query).toBe('?nocache=1');
});

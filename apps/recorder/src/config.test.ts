import { expect, test } from 'vitest';
import { loadConfig } from './config.js';

test('defaults: 1st round soaks at 600 s, 2nd round at Expires, 10 req/s', () => {
  const c = loadConfig({ RAW_BUCKET: 'bucket' });
  expect(c.RATE_MAX).toBe(10);
  expect(c.RECORDER_TARGETS).toEqual([
    { election: '6257', office: 1, minIntervalS: 600, ufOnly: false },
    { election: '6259', office: 3, minIntervalS: 600, ufOnly: false },
    { election: '6258', office: 1, minIntervalS: null, ufOnly: false },
    { election: '6260', office: 3, minIntervalS: null, ufOnly: false },
    { election: '6259', office: 5, minIntervalS: 600, ufOnly: true },
    { election: '6259', office: 6, minIntervalS: 600, ufOnly: true },
    { election: '6259', office: 7, minIntervalS: 600, ufOnly: true },
    { election: '6259', office: 8, minIntervalS: 600, ufOnly: true },
  ]);
});

test('rejects unknown elections and a missing bucket', () => {
  expect(() => loadConfig({ RAW_BUCKET: 'bucket', RECORDER_TARGETS: '9999:1:expires' })).toThrow();
  expect(() => loadConfig({})).toThrow();
  expect(() => loadConfig({ RAW_BUCKET: 'bucket', RECORDER_TARGETS: '6259:5:600:mu' })).toThrow();
});

test('a test key is refused on the production raw bucket', () => {
  const TSE_TEST_JWK_URL = 'http://127.0.0.1:8080/oficial/app/assets/assinatura-jws/test.jwk.json';
  expect(() => loadConfig({ RAW_BUCKET: 'apuracao26-raw-860897618882', TSE_TEST_JWK_URL })).toThrow(/production bucket/);
  expect(loadConfig({ RAW_BUCKET: 'replay-raw', TSE_TEST_JWK_URL }).TSE_TEST_JWK_URL).toBe(TSE_TEST_JWK_URL);
  expect(loadConfig({ RAW_BUCKET: 'apuracao26-raw-860897618882' }).TSE_TEST_JWK_URL).toBeUndefined();
});

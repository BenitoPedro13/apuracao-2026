import { expect, test } from 'vitest';
import { loadConfig } from './config.js';
import { keyAt, parseSegmentKey, segmentOrder } from './source.js';

// The recorder's key format (apps/recorder/src/store.ts segmentKey), as written on AWS.
const KEY = 'obs/v1/rec-a/2026-10-08/03/20261008T032600Z-00000042.ndjson.gz';

test('parses the recorder segment key', () => {
  expect(parseSegmentKey(KEY)).toEqual({ key: KEY, recorder: 'rec-a', cycleStart: Date.parse('2026-10-08T03:26:00Z') });
  expect(parseSegmentKey('obs/v1/rec-a/whatever.gz')).toBeUndefined();
});

test('keyAt(t) sorts before every segment that started at or after t, after every earlier one', () => {
  const t = Date.parse('2026-10-08T03:26:00Z');
  expect(keyAt('rec-a', t) < KEY).toBe(true);
  expect(keyAt('rec-a', t + 1_000) > KEY).toBe(true);
  expect(keyAt('rec-a', t - 600_000)).toBe('obs/v1/rec-a/2026-10-08/03/20261008T031600Z');
});

test('merge order: cycle start, then recorder', () => {
  const a = parseSegmentKey('obs/v1/b/2026-10-08/03/20261008T032600Z-00000001.ndjson.gz')!;
  const b = parseSegmentKey('obs/v1/a/2026-10-08/03/20261008T032605Z-00000001.ndjson.gz')!;
  const c = parseSegmentKey('obs/v1/a/2026-10-08/03/20261008T032600Z-00000009.ndjson.gz')!;
  expect([a, b, c].sort(segmentOrder)).toEqual([c, a, b]);
});

test('config: ELECTIONS is required; governor UFs follow the election', () => {
  expect(() => loadConfig({ RAW_BUCKET: 'raw' })).toThrow();
  expect(loadConfig({ RAW_BUCKET: 'raw', ELECTIONS: 'president=6258,governor=6260' }).governorUfs).toEqual(['ac', 'am', 'df', 'es', 'rj', 'rn', 'to']);
  expect(loadConfig({ RAW_BUCKET: 'raw', ELECTIONS: 'president=6257,governor=6259' }).governorUfs).toHaveLength(27);
  expect(loadConfig({ RAW_BUCKET: 'raw', ELECTIONS: 'president=6257,governor=6259' }).legislative).toBe(true);
  expect(loadConfig({ RAW_BUCKET: 'raw', ELECTIONS: 'president=6258,governor=6260' }).legislative).toBe(false);
  expect(() => loadConfig({ RAW_BUCKET: 'raw', ELECTIONS: 'president=6257,governor=6259', GOVERNOR_UFS: 'xx' })).toThrow();
});

test('config: a test key is refused on a production raw or public bucket', () => {
  const base = { ELECTIONS: 'president=6257,governor=6259', TSE_TEST_JWK_URL: 'http://127.0.0.1:8080/oficial/app/assets/assinatura-jws/test.jwk.json' };
  expect(() => loadConfig({ ...base, RAW_BUCKET: 'apuracao26-raw-860897618882' })).toThrow(/production bucket/);
  expect(() => loadConfig({ ...base, RAW_BUCKET: 'replay-raw', PUB_BUCKET: 'apuracao26-pub' })).toThrow(/production bucket/);
  expect(loadConfig({ ...base, RAW_BUCKET: 'replay-raw', PUB_DIR: '/tmp/x' }).TSE_TEST_JWK_URL).toBe(base.TSE_TEST_JWK_URL);
});

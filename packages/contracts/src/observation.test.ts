import { expect, test } from 'vitest';
import { Observation } from './observation.js';
import { RESULT_STATUS_CODE, ResultStatus } from './status.js';

const version = {
  v: 1,
  kind: 'version',
  path: 'ele2026/6257/dados/br/br-c0001-e006257-u.jws',
  election: '6257',
  fileType: 'u',
  scope: { level: 'br' },
  sha256: 'a'.repeat(64),
  fetchedAt: '2026-10-25T17:00:01-03:00',
  recorder: 'rec-1',
  leaseGeneration: 1,
  cycleNo: 0,
  seqInCycle: 0,
};

test('a version observation parses; v and timestamps are enforced', () => {
  expect(Observation.parse(version).kind).toBe('version');
  expect(Observation.safeParse({ ...version, v: 2 }).success).toBe(false);
  expect(Observation.safeParse({ ...version, fetchedAt: '25/10/2026' }).success).toBe(false);
  expect(Observation.safeParse({ ...version, sha256: 'xyz' }).success).toBe(false);
});

test('every status has a distinct, stable code', () => {
  const codes = ResultStatus.options.map((s) => RESULT_STATUS_CODE[s]);
  expect(new Set(codes).size).toBe(ResultStatus.options.length);
  expect(RESULT_STATUS_CODE).toEqual({ not_published: 0, no_sections: 1, counting: 2, final: 3, fetch_failed: 4 });
});

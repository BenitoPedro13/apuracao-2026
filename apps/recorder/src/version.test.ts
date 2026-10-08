import { importKeys, type Keyring, type TseJwk } from '@apuracao/tse';
import pinned from '@apuracao/tse/keys/prod.jwk.json' with { type: 'json' };
import { beforeAll, describe, expect, test } from 'vitest';
import { pathOf, sample } from './test-samples.test-helper.js';
import { analyze, decide, emptyState, ERROR_AFTER_FAILURES, type Analysis, type PathState } from './version.js';

// Inputs derived from real samples only (CLAUDE.md "Tests").
const NAME = 'ele2026_6257_dados_sp_sp71072-c0001-e006257-u.jws';
let keys: Keyring;
let real: Analysis;
beforeAll(async () => {
  keys = await importKeys([pinned as TseJwk]);
  real = await analyze(pathOf(NAME), sample(NAME), keys);
});

/** The same token with its payload's idg rewritten: real numbers, signature now invalid. */
function withIdg(idg: string): Buffer {
  const [h, p, s] = sample(NAME).toString('utf8').trim().split('.') as [string, string, string];
  const json = Buffer.from(p, 'base64url').toString('utf8').replace(/"idg"\s*:\s*"\d+"/, `"idg" : "${idg}"`);
  return Buffer.from(`${h}.${Buffer.from(json).toString('base64url')}.${s}`);
}

const ok = (analysis: Analysis) => ({ kind: 'ok' as const, etag: '"e"', analysis });

describe('analyze', () => {
  test('a real municipal .jws: valid signature, schema ok, idg and TSE instants', () => {
    expect(real.sig.status).toBe('valid');
    expect(real.schemaOk).toBe(true);
    expect(real.idg).toBe(2_854_936);
    expect(real.tseTotalizedAt).toBe('2026-10-05T12:51:05-03:00');
    expect(real.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  test('a tampered payload still yields idg, but sig invalid', async () => {
    const a = await analyze(pathOf(NAME), withIdg('2854937'), keys);
    expect(a.sig.status).toBe('invalid');
    expect(a.idg).toBe(2_854_937);
  });
});

describe('decide (architecture.md §4.4)', () => {
  test('first version: store, accept, observation "version"', () => {
    const d = decide(emptyState(), ok(real));
    expect(d).toMatchObject({ store: true, accept: true, pending: false });
    expect(d.observation).toMatchObject({ kind: 'version', sig: 'valid', schema: 'ok', idg: '2854936', sha256: real.sha256 });
    expect(d.state).toMatchObject({ maxIdg: 2_854_936, everSeen: true });
  });

  test('same bytes again (or 304): nothing', () => {
    const s = decide(emptyState(), ok(real)).state;
    expect(decide(s, ok(real))).toMatchObject({ store: false, observation: undefined });
    expect(decide(s, { kind: 'not_modified' })).toMatchObject({ store: false, observation: undefined });
  });

  test('lower idg: stored as a regression, not accepted', () => {
    const s: PathState = { ...emptyState(), everSeen: true, sha256: 'x', maxIdg: 3_000_000, shaAtMaxIdg: 'x' };
    const d = decide(s, ok(real));
    expect(d).toMatchObject({ store: true, accept: false });
    expect(d.observation).toMatchObject({ kind: 'version', regression: true });
    expect(d.state.maxIdg).toBe(3_000_000);
  });

  test('same idg, different bytes: anomaly, first one kept', () => {
    const s: PathState = { ...emptyState(), everSeen: true, sha256: 'x', maxIdg: real.idg, shaAtMaxIdg: 'x' };
    const d = decide(s, ok(real));
    expect(d.observation?.anomaly).toBe('same-idg-different-bytes');
    expect(d).toMatchObject({ store: true, accept: false });
    expect(d.state.shaAtMaxIdg).toBe('x');
  });

  test('invalid signature: stored and observed, never accepted', async () => {
    const tampered = await analyze(pathOf(NAME), withIdg('2854999'), keys);
    const d = decide(emptyState(), ok(tampered));
    expect(d).toMatchObject({ store: true, accept: false });
    expect(d.observation).toMatchObject({ sig: 'invalid', kid: 'sNbt9Q_fLS65zE1_ZLNV-XRRwPY' });
  });

  test('schema failure: stored, observed "failed", never accepted', () => {
    const d = decide(emptyState(), ok({ ...real, schemaOk: false, schemaIssues: ['s.st: not a TSE integer'] }));
    expect(d).toMatchObject({ store: true, accept: false });
    expect(d.observation?.schema).toBe('failed');
  });

  test('municipal file older than the coverage row that triggered it: pending', () => {
    const d = decide(emptyState(), ok(real), '2026-10-05T13:00:00-03:00');
    expect(d).toMatchObject({ store: true, accept: true, pending: true });
    expect(d.state.pendingTries).toBe(1);
    const again = decide(d.state, ok(real), '2026-10-05T13:00:00-03:00');
    expect(again).toMatchObject({ store: false, pending: true });
    expect(again.state.pendingTries).toBe(2);
    expect(decide(emptyState(), ok(real), '2026-10-05T12:00:00-03:00').pending).toBe(false);
  });

  test(`errors: one "error" observation after ${ERROR_AFTER_FAILURES} failures, one "recovered" after`, () => {
    let s = decide(emptyState(), ok(real)).state;
    const kinds: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const d = decide(s, { kind: 'failed', error: 'HTTP 503', status: 503 });
      expect(d.retry).toBe(true);
      kinds.push(d.observation?.kind);
      s = d.state;
    }
    expect(kinds).toEqual([undefined, undefined, 'error', undefined, undefined]);
    expect(decide(s, { kind: 'not_modified' }).observation?.kind).toBe('recovered');
  });

  test('404 on a file that existed: one "absent"; 404 on a never-seen file: nothing', () => {
    const s = decide(emptyState(), ok(real)).state;
    const d = decide(s, { kind: 'not_found' });
    expect(d.observation?.kind).toBe('absent');
    expect(decide(d.state, { kind: 'not_found' }).observation).toBeUndefined();
    expect(decide(emptyState(), { kind: 'not_found' }).observation).toBeUndefined();
    // It comes back with the same bytes: a new version observation (it was absent).
    expect(decide(d.state, ok(real)).observation?.kind).toBe('version');
  });
});

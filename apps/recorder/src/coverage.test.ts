import { TseCoverageFile } from '@apuracao/contracts';
import { expect, test } from 'vitest';
import { changedMunicipalities, indexCoverage, pendingPlan, staleMunicipal } from './coverage.js';
import { sample } from './test-samples.test-helper.js';

const sp = () => TseCoverageFile.parse(JSON.parse(sample('ele2026_6257_dados_sp_sp-e006257-ab.json').toString('utf8')));

test('a cold start sees every municipality as changed (that is the capture)', () => {
  const idx = indexCoverage(sp());
  expect(Object.keys(idx)).toHaveLength(645);
  expect(changedMunicipalities(undefined, idx)).toHaveLength(645);
});

test('the same version again changes nothing', () => {
  expect(changedMunicipalities(indexCoverage(sp()), indexCoverage(sp()))).toEqual([]);
});

test('one row with a later ht (derived from the real file) → exactly that municipality', () => {
  const next = sp();
  const row = next.abr.find((r) => r.cdabr === '71072')!;
  row.ht = '23:59:59';
  const changed = changedMunicipalities(indexCoverage(sp()), indexCoverage(next));
  expect(changed).toEqual([{ mu: '71072', instant: `${row.dt!.split('/').reverse().join('-')}T23:59:59-03:00` }]);
});

test('pending: fast tries, then slow ones, then give up (2026-10-25: 5 stale answers in a row)', () => {
  const cfg = { fastTries: 5, slowTries: 288 };
  expect([0, 4].map((t) => pendingPlan(t, cfg))).toEqual(['fast', 'fast']);
  expect([5, 292].map((t) => pendingPlan(t, cfg))).toEqual(['slow', 'slow']);
  expect(pendingPlan(293, cfg)).toBe('give-up');
});

test('start-up sweep: rows later than the accepted version, or with no recorded instant', () => {
  const idx = indexCoverage(sp());
  const withInstant = Object.entries(idx).filter(([, r]) => r.instant);
  // A snapshot from before this field: every row with an instant is re-checked.
  expect(staleMunicipal(idx, () => undefined)).toHaveLength(withInstant.length);
  // Up to date everywhere but one municipality, stuck at an older version.
  const [stuck, row] = withInstant[0]!;
  const at = (mu: string) => ({ totalizedAt: mu === stuck ? '2026-10-01T00:00:00-03:00' : idx[mu]!.instant });
  expect(staleMunicipal(idx, at)).toEqual([{ mu: stuck, instant: row.instant }]);
});

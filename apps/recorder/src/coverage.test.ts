import { TseCoverageFile } from '@apuracao/contracts';
import { expect, test } from 'vitest';
import { changedMunicipalities, indexCoverage } from './coverage.js';
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

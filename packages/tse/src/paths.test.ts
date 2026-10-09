import { TseMunicipalityIndex } from '@apuracao/contracts';
import { describe, expect, test } from 'vitest';
import { ELECTIONS, OFFICES } from './codes.js';
import { catalogPath, coveragePath, municipalityIndexPath, parsePath, resultPath, type Area } from './paths.js';
import { readSample, sampleNames, samplePath } from './samples.test-helper.js';

test('builders reproduce every sample file name', () => {
  const built = new Set([
    catalogPath('json'),
    municipalityIndexPath('6257', 'json'),
    resultPath('6257', OFFICES.president, 'br', undefined, 'json'),
    coveragePath('6257', 'br', 'json'),
    coveragePath('6257', 'sp', 'json'),
    resultPath('6257', OFFICES.president, 'sp', '71072', 'json'),
    resultPath('6257', OFFICES.president, 'zz', undefined, 'json'),
    resultPath('6259', OFFICES.governor, 'rj', undefined, 'json'),
    resultPath('6257', OFFICES.president, 'zz', '29424', 'json'),
    resultPath('6259', OFFICES.senator, 'sp', undefined, 'json'),
    resultPath('6259', OFFICES.federalDeputy, 'sp', undefined, 'json'),
    resultPath('6259', OFFICES.stateDeputy, 'ac', undefined, 'json'),
    resultPath('6259', OFFICES.districtDeputy, 'df', undefined, 'json'),
  ]);
  expect(new Set(sampleNames('json').map(samplePath))).toEqual(built);
  expect(resultPath('6259', OFFICES.governor, 'rj', '60011')).toBe(samplePath('ele2026_6259_dados_rj_rj60011-c0003-e006259-u.jws'));
});

test('every municipality × {6257, 6258} round-trips (11,514 paths)', () => {
  const idx = TseMunicipalityIndex.parse(JSON.parse(readSample('ele2026_6257_config_mun-e006257-cm.json').toString('utf8')));
  let n = 0;
  for (const election of [ELECTIONS.federal1, ELECTIONS.federal2]) {
    for (const uf of idx.abr) {
      for (const mu of uf.mu) {
        const path = resultPath(election, OFFICES.president, uf.cd as Area, mu.cd);
        expect(parsePath(path)).toEqual({
          fileType: 'u', ext: 'jws', election, office: 1, scope: { level: 'mu', uf: uf.cd, mu: mu.cd },
        });
        n++;
      }
    }
  }
  expect(n).toBe(11_514);
});

describe('parsePath', () => {
  test('classifies aggregate scopes', () => {
    expect(parsePath(resultPath('6258', 1, 'br')).scope).toEqual({ level: 'br' });
    expect(parsePath(resultPath('6258', 1, 'zz')).scope).toEqual({ level: 'zz', uf: 'zz' });
    expect(parsePath(coveragePath('6260', 'rj')).scope).toEqual({ level: 'uf', uf: 'rj' });
    expect(parsePath(municipalityIndexPath('6258'))).toEqual({ fileType: 'cm', ext: 'jws', election: '6258' });
    expect(parsePath(catalogPath())).toEqual({ fileType: 'c', ext: 'jws' });
  });
  test.each([
    'ele2026/6257/dados/br/br-c0001-e006257-u.json?nocache=1', // cache-busting is forbidden
    'ele2026/6257/dados/sp/rj-c0001-e006257-u.jws', // directory ≠ file area
    'ele2026/6257/dados/br/br-c0001-e006258-u.jws', // election ≠ e-code
    'ele2026/1234/dados/br/br-c0001-e001234-u.jws', // unknown election
    'ele2026/6257/dados/xx/xx-e006257-ab.jws', // unknown area
    'ele2026/6257/dados/br/br12345-c0001-e006257-u.jws', // br has no municipalities
    'ele2026/6257/fotos/sp/123.jpeg',
  ])('rejects %s', (path) => {
    expect(() => parsePath(path)).toThrow(/unrecognised/);
  });
});

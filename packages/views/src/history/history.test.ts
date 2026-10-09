import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HistoryMunicipalities, HistoryRound, TseMunicipalityIndex } from '@apuracao/contracts';
import { candidateReader, detailReader } from '@apuracao/tse';
import { HistoryFold, type Place } from './fold.js';
import { pearson, slope } from './insights.js';

// The fold over real excerpts of the TSE archive (docs/research/samples/hist/). The full
// files are checked by scripts/build-history.ts --check against research 05.
const SAMPLES = new URL('../../../../docs/research/samples/', import.meta.url);
const lines = (name: string) => readFileSync(new URL(`hist/${name}`, SAMPLES)).toString('latin1').split(/\r?\n/).filter(Boolean);

const cfg = TseMunicipalityIndex.parse(JSON.parse(readFileSync(new URL('ele2026_6257_config_mun-e006257-cm.json', SAMPLES), 'utf8')));
const places = new Map<string, Place>();
for (const a of cfg.abr) for (const m of a.mu) if (m.cdi) places.set(m.cd, { ibge: m.cdi, name: m.nm });

function foldOf(files: { candidates?: string[]; details?: string[] }) {
  const f = new HistoryFold();
  for (const name of files.candidates ?? []) {
    const [h, ...rest] = lines(name);
    const read = candidateReader(h!);
    for (const l of rest) {
      const r = read(l);
      if (r) f.addCandidate(r);
    }
  }
  for (const name of files.details ?? []) {
    const [h, ...rest] = lines(name);
    const read = detailReader(h!);
    for (const l of rest) {
      const r = read(l);
      if (r) f.addDetail(r);
    }
  }
  return f.build(places);
}

describe('HistoryFold', () => {
  it('sums zones into municipalities and municipalities into the nation (2022 excerpt)', () => {
    const { rounds, municipalities } = foldOf({ candidates: ['votacao_candidato_munzona_2022_BR.head.csv'], details: ['detalhe_votacao_munzona_2022_BR.head.csv'] });
    for (const r of rounds) HistoryRound.parse(r);
    HistoryMunicipalities.parse(municipalities);
    // Raw sum of every president row in the excerpt, independently of the fold.
    const [h, ...rest] = lines('votacao_candidato_munzona_2022_BR.head.csv');
    const read = candidateReader(h!);
    const raw = rest.map(read).filter((r) => r !== null);
    for (const r of rounds) {
      const total = raw.filter((x) => x.round === r.round).reduce((s, x) => s + x.votes, 0);
      expect(r.national.votes.reduce((a, b) => a + b, 0)).toBe(total);
      // Candidates are ordered by national votes, most first.
      expect([...r.national.votes].sort((a, b) => b - a)).toEqual(r.national.votes);
    }
  });

  it('keeps abroad out of the municipalities and the UFs, but in the national sum (Conakry)', () => {
    const { rounds, municipalities } = foldOf({ details: ['detalhe_votacao_munzona_2022_BR.head.csv'] });
    const r = rounds.find((x) => x.round === 1)!;
    expect(r.abroad).not.toBeNull();
    expect(r.abroad!.naoInstaladas).toBeGreaterThanOrEqual(2);
    expect(r.byUf.ZZ).toBeUndefined();
    const sumUf = Object.values(r.byUf).reduce((s, u) => s + u.aptos, 0);
    expect(sumUf + r.abroad!.aptos + (r.transit?.aptos ?? 0)).toBe(r.national.aptos);
    expect(municipalities.tse).not.toContain('38903');
  });

  it('reports the 2010 transit pseudo-municipalities as transit, never as municipalities', () => {
    const { rounds, municipalities, unjoined } = foldOf({ details: ['detalhe_votacao_munzona_2010_BR.VT.csv'] });
    expect(rounds.every((r) => r.transit !== null && Object.keys(r.byUf).length === 0)).toBe(true);
    expect(municipalities.ids).toEqual([]);
    expect(unjoined).toEqual([]);
  });

  it('returns 2002 Boa Esperança do Norte (91065) as unjoined instead of dropping it', () => {
    const { unjoined, municipalities } = foldOf({ candidates: ['votacao_candidato_munzona_2002_BR.91065.csv'] });
    expect(unjoined).toEqual([{ year: 2002, tse: '91065', uf: 'MT' }]);
    expect(municipalities.ids).toEqual([]);
  });

  it('joins 6092 (2018 candidates) and 06092 (2018 detail) to one municipality, Oiapoque 1600501', () => {
    const { municipalities } = foldOf({ candidates: ['votacao_candidato_munzona_2018_BR.short-code.csv'], details: ['detalhe_votacao_munzona_2018_BR.06092.csv'] });
    expect(municipalities.ids).toEqual(['1600501']);
    const r1 = municipalities.rounds.find((r) => r.round === 1)!;
    expect(r1.aptos[0]).toBeGreaterThan(0);
    expect(r1.votes.every((c) => c[0] !== null)).toBe(true);
  });

  it('marks a municipality absent from a round as null, never 0 (1994 vs 2002 excerpts)', () => {
    const { municipalities } = foldOf({ details: ['detalhe_votacao_munzona_1994_BR.head.csv', 'detalhe_votacao_munzona_2022_BR.head.csv'] });
    const y94 = municipalities.rounds.find((r) => r.year === 1994)!;
    const y22 = municipalities.rounds.find((r) => r.year === 2022 && r.round === 1)!;
    const only22 = municipalities.ids.findIndex((_, i) => y94.aptos[i] === null && y22.aptos[i] !== null);
    expect(only22).toBeGreaterThanOrEqual(0);
    expect(y94.aptos[only22]).toBeNull();
    expect(y94.comparecimento[only22]).toBeNull();
  });

  it('marks 1994 as decisive in its 1st round (no 2nd round that year)', () => {
    const { rounds } = foldOf({ details: ['detalhe_votacao_munzona_1994_BR.head.csv'] });
    expect(rounds.map((r) => [r.year, r.round, r.decisive])).toEqual([[1994, 1, true]]);
    expect(rounds[0]!.abroad).toBeNull();
  });
});

describe('statistics', () => {
  it('pearson: ±1 on lines, 0 on an orthogonal pattern', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 2, 3, 4], [1, -1, -1, 1])).toBeCloseTo(0, 12);
  });
  it('slope: least squares', () => {
    expect(slope([0, 1, 2], [1, 3, 5])).toBeCloseTo(2, 12);
  });
});

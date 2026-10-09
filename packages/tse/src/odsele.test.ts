import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { candidateReader, countOf, detailReader, municipalityCode, presidentCsvName, RowSetHash, splitCsvLine, withoutGeneration } from './odsele.js';
import { SAMPLES } from './samples.test-helper.js';

// Real excerpts of the TSE archive (docs/research/samples/hist/, research 05 §3), one per quirk.
const lines = (name: string) =>
  readFileSync(new URL(`hist/${name}`, SAMPLES)).toString('latin1').split(/\r?\n/).filter((l) => l.length > 0);
function rows<T>(name: string, reader: (header: string) => (line: string) => T | null): T[] {
  const [header, ...rest] = lines(name);
  const read = reader(header!);
  return rest.map(read).filter((r): r is T => r !== null);
}

describe('splitCsvLine', () => {
  it('splits quoted and bare fields, keeping ; and "" inside quotes', () => {
    expect(splitCsvLine('"a;b";12;"say ""hi""";;"x"')).toEqual(['a;b', '12', 'say "hi"', '', 'x']);
  });
  it('rejects an unterminated quote', () => {
    expect(() => splitCsvLine('"abc;1')).toThrow(/unterminated/);
  });
});

describe('codes and markers', () => {
  it('pads the bare integers of 2018/2022 to five digits', () => {
    expect(municipalityCode('6092')).toBe('06092');
    expect(municipalityCode('06092')).toBe('06092');
    expect(() => municipalityCode('123456')).toThrow();
  });
  it('reads #NULO#, #NE and the −1/−3 markers as missing, never zero', () => {
    for (const m of ['#NULO#', '#NE#', '#NE', '-1', '-3', '']) expect(countOf(m)).toBeNull();
    expect(countOf('0')).toBe(0);
    expect(() => countOf('1,5')).toThrow();
  });
  it('finds the president CSV, falling back to _BRASIL.csv (1998)', () => {
    expect(presidentCsvName(['x_AC.csv', 'x_BR.csv', 'x_BRASIL.csv'])).toBe('x_BR.csv');
    expect(presidentCsvName(['x_AC.csv', 'x_BRASIL.csv', 'leiame.pdf'])).toBe('x_BRASIL.csv');
  });
});

describe('candidate rows', () => {
  it('1998: votes come from QT_VOTOS_NOMINAIS_VALIDOS, the NOMINAIS column being 0', () => {
    const r = rows('votacao_candidato_munzona_1998_BRASIL.presidente.head.csv', candidateReader);
    expect(r.length).toBeGreaterThan(0);
    const ciro = r.find((x) => x.municipality === '01120' && x.number === 23);
    expect(ciro).toMatchObject({ year: 1998, round: 1, uf: 'AC', name: 'CIRO GOMES', party: 'PPS', votes: 173 });
    expect(r.some((x) => x.votes > 0)).toBe(true);
  });
  it('2018 and 2022: Oiapoque written 6092 joins as 06092', () => {
    for (const f of ['votacao_candidato_munzona_2018_BR.short-code.csv', 'votacao_candidato_munzona_2022_BR.06092.csv']) {
      const r = rows(f, candidateReader);
      expect(r.length).toBeGreaterThan(0);
      expect(new Set(r.map((x) => x.municipality))).toEqual(new Set(['06092']));
    }
    const d = rows('detalhe_votacao_munzona_2018_BR.06092.csv', detailReader);
    expect(d.every((x) => x.municipality === '06092' && x.municipalityName === 'OIAPOQUE')).toBe(true);
  });
  it('2002: Boa Esperança do Norte votes as 91065', () => {
    const r = rows('votacao_candidato_munzona_2002_BR.91065.csv', candidateReader);
    expect(new Set(r.map((x) => x.municipality))).toEqual(new Set(['91065']));
    expect(r[0]!.uf).toBe('MT');
  });
});

describe('detail rows', () => {
  it('1994: null votes from QT_VOTOS_NULOS; valid + blank + null = turnout (Ji-Paraná)', () => {
    const r = rows('detalhe_votacao_munzona_1994_BR.head.csv', detailReader);
    const ji = r.find((x) => x.municipality === '00051')!;
    expect(ji).toMatchObject({ aptos: 58099, comparecimento: 40397, abstencoes: 17702, brancos: 3573, nulos: 2991 });
    expect(33833 + ji.brancos + ji.nulos).toBe(ji.comparecimento);
  });
  it('2010: the VT rows are transit votes, not municipalities', () => {
    const r = rows('detalhe_votacao_munzona_2010_BR.VT.csv', detailReader);
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.kind === 'transit' && /^999\d\d$/.test(x.municipality))).toBe(true);
  });
  it('aptos = comparecimento + abstencoes + voters of uninstalled sections (Conakry 2022: 2 voters, no section)', () => {
    const r = rows('detalhe_votacao_munzona_2022_BR.head.csv', detailReader);
    for (const x of r) expect(x.comparecimento + x.abstencoes + x.naoInstaladas).toBe(x.aptos);
    expect(r.find((x) => x.municipality === '38903')).toMatchObject({ kind: 'abroad', aptos: 2, comparecimento: 0, abstencoes: 0, naoInstaladas: 2 });
  });
});

describe('content identity', () => {
  it('ignores DT_GERACAO/HH_GERACAO and nothing else', () => {
    const [header, row] = lines('detalhe_votacao_munzona_2022_BR.head.csv');
    const strip = withoutGeneration(header!);
    const regenerated = row!.replace(/^"\d\d\/\d\d\/\d{4}";"\d\d:\d\d:\d\d"/, '"01/01/2030";"00:00:00"');
    expect(regenerated).not.toBe(row);
    expect(strip(regenerated)).toBe(strip(row!));
    expect(strip(row!.replace(';63;', ';64;'))).not.toBe(strip(row!));
  });
});

describe('2006 abroad: negative QT_TOTAL_VOTOS_NULOS', () => {
  it('takes QT_VOTOS_NULOS, so valid + blank + null = turnout (Tailândia, 2nd round)', () => {
    const r = rows('detalhe_votacao_munzona_2006_BR.negative-nulos.csv', detailReader);
    expect(r).toHaveLength(32);
    expect(r.every((x) => x.kind === 'abroad' && x.nulos >= 0)).toBe(true);
    expect(r.find((x) => x.municipalityName === 'TAILÂNDIA' && x.round === 2)).toMatchObject({ comparecimento: 15, brancos: 0, nulos: 1 });
  });
});

describe('RowSetHash', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const id = (rows: string[]) => {
    const h = new RowSetHash(sha);
    for (const r of rows) h.add(r);
    return h.digest();
  };
  const [header, ...rest] = lines('detalhe_votacao_munzona_2022_BR.head.csv');
  const strip = withoutGeneration(header!);
  it('is the same for the same rows in another order (the TSE regenerates reordered)', () => {
    expect(id(rest.map(strip))).toBe(id([...rest].reverse().map(strip)));
  });
  it('changes when a row changes, is added, or is duplicated', () => {
    const base = id(rest.map(strip));
    expect(id(rest.slice(1).map(strip))).not.toBe(base);
    expect(id([...rest, rest[0]!].map(strip))).not.toBe(base);
    const changed = rest.map((r, i) => (i === 3 ? r.replace(/;(\d+);/, ';999999;') : r));
    expect(changed[3]).not.toBe(rest[3]);
    expect(id(changed.map(strip))).not.toBe(base);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  TseCoverageFile,
  TseElectionCatalog,
  TseMunicipalityIndex,
  TseResultFile,
} from './files.js';

// Real captured TSE files only (CLAUDE.md "Tests"). Numbers below are from research 01 §4.
const SAMPLES = new URL('../../../../docs/research/samples/', import.meta.url);
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, SAMPLES), 'utf8'));

const RESULT_FILES = [
  'ele2026_6257_dados_br_br-c0001-e006257-u.json',
  'ele2026_6257_dados_sp_sp71072-c0001-e006257-u.json',
  'ele2026_6257_dados_zz_zz-c0001-e006257-u.json',
  'ele2026_6259_dados_rj_rj-c0003-e006259-u.json',
  'ele2026_6257_dados_zz_zz29424-c0001-e006257-u.json',
];

const candidates = (f: TseResultFile) =>
  f.carg.flatMap((c) => c.agr.flatMap((a) => a.par.flatMap((p) => p.cand)));

describe('TseResultFile', () => {
  test('national file matches the published 1st-round numbers', () => {
    const br = TseResultFile.parse(load(RESULT_FILES[0]!));
    const byName = new Map(candidates(br).map((c) => [c.nmu, c]));
    expect(byName.get('FLAVIO BOLSONARO')?.vap).toBe(56_104_503);
    expect(byName.get('FLAVIO BOLSONARO')?.pvap.raw).toBe('47,03');
    expect(byName.get('LULA')?.vap).toBe(53_879_538);
    expect(br.v.vv).toBe(119_300_788);
    expect(br.v.tv).toBe(125_275_835);
    expect(br.e.pc.raw).toBe('78,92');
  });

  // Vote identities observed in the samples (research 02 §8). Votes for a candidacy that is
  // "Anulado sub judice" are in vansj and vvc, but not in vv; the TSE's pvap is over vvc.
  test.each(RESULT_FILES)('%s: vote identities hold', (name) => {
    const f = TseResultFile.parse(load(name));
    const cands = candidates(f);
    const sum = (cs: typeof cands) => cs.reduce((total, c) => total + c.vap, 0);
    expect(f.v.vv + f.v.van + f.v.vansj).toBe(f.v.vvc);
    expect(sum(cands)).toBe(f.v.vvc);
    expect(sum(cands.filter((c) => c.dvt === 'Válido'))).toBe(f.v.vv);
    expect(f.v.vvc + f.v.vb + f.v.tvn).toBe(f.v.tv);
    expect(f.v.vn + f.v.vnt).toBe(f.v.tvn);
    expect(f.s.st).toBeLessThanOrEqual(f.s.ts);
  });

  test('RJ governor: a sub judice candidacy is outside vv, and pvap is over vvc', () => {
    const rj = TseResultFile.parse(load(RESULT_FILES[3]!));
    const garotinho = candidates(rj).find((c) => c.nmu === 'GAROTINHO');
    expect(garotinho?.dvt).toBe('Anulado sub judice');
    expect(rj.v.vansj).toBe(garotinho?.vap);
    const ruas = candidates(rj).find((c) => c.nmu === 'DOUGLAS RUAS')!;
    expect(ruas.pvap.raw).toBe('49,27');
    expect(((ruas.vap / rj.v.vvc) * 100).toFixed(2)).toBe('49.27');
    expect(((ruas.vap / rj.v.vv) * 100).toFixed(2)).not.toBe('49.27');
  });

  test('a file with no votes: empty dt/ht → null, candidates without dvt, all zeros', () => {
    const f = TseResultFile.parse(load(RESULT_FILES[4]!));
    expect([f.dt, f.ht]).toEqual([null, null]);
    expect(f.s).toMatchObject({ ts: 1, st: 1, sni: 1 });
    expect(candidates(f).every((c) => c.dvt === undefined && c.vap === 0 && c.pvap.raw === '0,00')).toBe(true);
    expect(f.v.tv).toBe(0);
  });

  test('the abroad aggregate is tpabr "uf" with cdabr "zz"', () => {
    const zz = TseResultFile.parse(load(RESULT_FILES[2]!));
    expect([zz.tpabr, zz.cdabr]).toEqual(['uf', 'zz']);
  });

  test('a thousands separator in an integer fails, naming the field', () => {
    const raw = load(RESULT_FILES[0]!) as { v: { vv: string } };
    raw.v.vv = '119.300.788';
    const r = TseResultFile.safeParse(raw);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['v', 'vv']);
  });

  test('unknown keys are kept, not rejected', () => {
    const raw = load(RESULT_FILES[0]!) as Record<string, unknown>;
    raw['novoCampo'] = 'x';
    expect(TseResultFile.parse(raw)).toHaveProperty('novoCampo', 'x');
  });
});

describe('TseCoverageFile', () => {
  test('br coverage: 29 rows (27 UFs + zz + br) with municipality progress', () => {
    const br = TseCoverageFile.parse(load('ele2026_6257_dados_br_br-e006257-ab.json'));
    expect(br.abr).toHaveLength(29);
    const ac = br.abr.find((r) => r.cdabr === 'ac');
    expect(ac?.munf).toBe(22);
  });
  test('SP coverage: 646 rows (645 municipalities + the UF)', () => {
    const sp = TseCoverageFile.parse(load('ele2026_6257_dados_sp_sp-e006257-ab.json'));
    expect(sp.abr).toHaveLength(646);
    expect(sp.abr.filter((r) => r.tpabr === 'mun')).toHaveLength(645);
  });
});

describe('TseMunicipalityIndex', () => {
  const idx = TseMunicipalityIndex.parse(load('ele2026_6257_config_mun-e006257-cm.json'));
  const all = idx.abr.flatMap((uf) => uf.mu);
  test('5,757 municipalities; 5,571 distinct IBGE codes; 27 capitals', () => {
    expect(all).toHaveLength(5_757);
    const cdi = all.map((m) => m.cdi).filter((c) => c !== '');
    expect(cdi).toHaveLength(5_571);
    expect(new Set(cdi).size).toBe(5_571);
    expect(all.filter((m) => m.c === 's')).toHaveLength(27);
  });
});

describe('TseElectionCatalog', () => {
  test('lists the 2026 elections with their 2nd-round codes', () => {
    const cat = TseElectionCatalog.parse(load('comum_config_ele-c.json'));
    const e2026 = cat.pl.filter((p) => p.c === 'ele2026').flatMap((p) => p.e);
    const byCode = new Map(e2026.map((e) => [e.cd, e.cdt2]));
    expect(byCode.get('6257')).toBe('6258');
    expect(byCode.get('6259')).toBe('6260');
  });
});

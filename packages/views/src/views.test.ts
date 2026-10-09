import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { LegislativeBrView, LegislativeUfView, MapIndexView, MapView, MunicipalityView, RegionsView, ResultView, type Observation } from '@apuracao/contracts';
import type { Keyring } from '@apuracao/tse';
import { beforeAll, describe, expect, test } from 'vitest';
import { emptyState, fold, needsBlob, type ViewState } from './fold.js';
import { classify } from './model.js';
import { prepare, type Prepared } from './prepare.js';
import { reconcile } from './reconcile.js';
import { leaderOf, pctToBp, render } from './render.js';
import { CFG, jwsSamples, keyring, obs } from './samples.test-helper.js';

const BR = 'ele2026/6257/dados/br/br-c0001-e006257-u.jws';
const SP = 'ele2026/6257/dados/sp/sp-c0001-e006257-u.jws';
const SP_MU = 'ele2026/6257/dados/sp/sp71072-c0001-e006257-u.jws';
const ZZ_MU = 'ele2026/6257/dados/zz/zz29424-c0001-e006257-u.jws';
const RJ_GOV = 'ele2026/6259/dados/rj/rj-c0003-e006259-u.jws';

let keys: Keyring;
/** One version observation + prepared blob per relevant sample. */
let inputs: { o: Observation; p: Prepared }[];

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  keys = await keyring();
  inputs = [];
  let minute = 0;
  for (const [path, bytes] of jwsSamples()) {
    const role = classify(path, CFG);
    if (!role) continue;
    const p = await prepare(path, role, bytes, keys);
    const at = new Date(Date.UTC(2026, 9, 5, 15, minute++)).toISOString();
    inputs.push({ o: obs(path, 'version', at, { sha256: sha(bytes), idg: p.ok ? String(p.idg) : undefined }), p });
  }
});

function foldAll(items: { o: Observation; p?: Prepared }[], state: ViewState = emptyState()) {
  for (const { o, p } of items) fold(state, o, CFG, needsBlob(state, o, CFG) ? p : undefined);
  return state;
}

const view = <T>(state: ViewState, name: string, schema: { parse: (x: unknown) => T }) => schema.parse(render(state, CFG).objects.get(name));

describe('views from the real 1st-round samples', () => {
  test('every relevant sample verifies and parses', () => {
    expect(inputs.map((i) => i.o.path)).toEqual(expect.arrayContaining([BR, SP_MU, ZZ_MU, RJ_GOV]));
    expect(inputs.filter((i) => !i.p.ok)).toEqual([]);
  });

  test('national president view (TASK §5 item 1)', () => {
    const br = view(foldAll(inputs), 'result/president/br', ResultView);
    expect(br.status).toBe('final');
    expect(br.votes).toMatchObject({ valid: 119_300_788, validWithSubJudice: 119_300_788 });
    expect(br.electorate?.turnoutPct.raw).toBe('78,92');
    expect(br.candidates[0]).toMatchObject({ name: 'FLAVIO BOLSONARO', votes: 56_104_503, pct: { raw: '47,03' }, seq: 1 });
    expect(br.candidates[1]).toMatchObject({ votes: 53_879_538, seq: 2 });
    expect(br.candidates).toHaveLength(12);
    expect(br.tse?.totalizedAt).toBe('2026-10-05T12:51:05-03:00');
    expect(br.sources).toEqual([inputs.find((i) => i.o.path === BR)!.o.sha256]);
    expect(br.municipalities).toBeNull();
  });

  test('a UF row carries the br coverage counts; the abroad view exists', () => {
    const state = foldAll(inputs);
    const ac = view(state, 'result/president/ac', ResultView);
    expect(ac.municipalities).toEqual({ final: 22, partial: 0, notStarted: 0 });
    expect(view(state, 'result/president/zz', ResultView).status).toBe('final');
  });

  test('missing ≠ zero: a UF with no accepted file is not_published with null numbers', () => {
    const sp = view(foldAll(inputs), 'result/president/sp', ResultView);
    expect(inputs.some((i) => i.o.path === SP)).toBe(false);
    expect(sp).toMatchObject({ status: 'not_published', tse: null, sections: null, electorate: null, votes: null, candidates: [] });
  });

  test('zero-vote abroad city: final, all-zero votes, leader -1, null totalization (not "")', () => {
    const zz = view(foldAll(inputs), 'municipalities/president/zz', MunicipalityView);
    const row = zz.rows.find((r) => r.mu === '29424')!;
    expect(row).toMatchObject({ status: 'final', leader: -1, totalizedAt: null, validWithSubJudice: 0, cdi: null });
    expect(row.votes!.every((v) => v === 0)).toBe(true);
    // Another abroad city without a file: no numbers at all.
    expect(zz.rows.find((r) => r.mu !== '29424')).toMatchObject({ status: 'not_published', votes: null, sections: null });
  });

  test('map: 5,571 domestic municipalities in ascending cdi, one with data', () => {
    const state = foldAll(inputs);
    const idx = view(state, 'map-index/president', MapIndexView);
    const map = view(state, 'map/president', MapView);
    expect(idx.cdi).toHaveLength(5_571);
    expect(new Set(idx.cdi).size).toBe(5_571);
    expect([...idx.cdi].sort()).toEqual(idx.cdi);
    expect(map.count).toBe(5_571);
    expect(map.index).toBe(createHash('sha256').update(idx.cdi.join('\n')).digest('hex'));
    for (const col of [map.leader, map.marginBpCalc, map.countedBp, map.status]) expect(col).toHaveLength(5_571);
    const i = idx.mu.indexOf('71072');
    expect(idx.uf[i]).toBe('sp');
    expect(map.status[i]).toBe(3);
    expect(map.leader[i]).toBeGreaterThanOrEqual(0);
    expect(map.countedBp[i]).toBe(10_000);
    expect(map.status.filter((s) => s === 0)).toHaveLength(5_570);
    expect(map.marginBpCalc.filter((m) => m === null)).toHaveLength(5_570);
    expect(map.candidates.map((c) => c.seq)).toEqual([...Array(12).keys()].map((k) => k + 1));
  });

  test('regions: partial sums labelled incomplete', () => {
    const r = view(foldAll(inputs), 'regions/president', RegionsView);
    expect(r.regions.map((x) => x.code)).toEqual(['N', 'NE', 'CO', 'SE', 'S']);
    expect(r.regions.every((x) => x.calc === null && !x.complete)).toBe(true);
  });

  test('governor: RJ result view keeps the sub judice candidate and its TSE %', () => {
    const rj = view(foldAll(inputs), 'result/governor/rj', ResultView);
    expect(rj.status).toBe('final');
    expect(rj.votes).toMatchObject({ valid: 8_394_627, validWithSubJudice: 8_669_038, subJudice: 274_411 });
    expect(rj.candidates.find((c) => c.destination === 'Anulado sub judice')?.votes).toBe(274_411);
    expect(rj.candidates.find((c) => c.pct.raw === '49,27')?.votes).toBe(4_271_199);
  });

  test('reconciliation: every sample satisfies the identities of research 02 §8', () => {
    const report = reconcile(foldAll(inputs), CFG);
    expect(report.identityFailures).toEqual([]);
    const brSum = report.sums.find((s) => s.parts === 'ufs')!;
    expect(brSum).toMatchObject({ comparable: false }); // 27 UF files missing from the samples
  });
});

// TASK-legislative-archive.md §5 item 1.
describe('senate and deputies from the real samples', () => {
  test('SP senate: every candidate, the 2 elected first, with their alternates', () => {
    const sp = view(foldAll(inputs), 'legislative/senate/sp', LegislativeUfView);
    expect(sp).toMatchObject({ status: 'final', officeName: 'Senador', seats: 2, quotient: null, label: null });
    expect(sp.candidates).toHaveLength(13);
    expect(sp.candidates.slice(0, 2).map((c) => [c.elected, c.situation])).toEqual([[true, 'Eleito'], [true, 'Eleito']]);
    expect(sp.candidates.slice(2).every((c) => !c.elected)).toBe(true);
    expect(sp.candidates.find((c) => c.name === 'ANDRÉ DO PRADO')).toMatchObject({ votes: 12_703_089, pct: { raw: '29,28' } });
    expect(sp.candidates[0]!.alternates.map((a) => a.role)).toEqual(['s1', 's2']);
  });

  test('SP federal deputies: 70 elected = Σ party seats; the quotient; elected only', () => {
    const sp = view(foldAll(inputs), 'legislative/federal-deputy/sp', LegislativeUfView);
    expect([sp.seats, sp.quotient]).toEqual([70, 338_203]);
    expect(sp.candidates).toHaveLength(70);
    expect(sp.candidates.every((c) => c.elected && c.situation.startsWith('Eleito'))).toBe(true);
    expect(sp.parties.reduce((t, p) => t + p.seats, 0)).toBe(70);
    expect(sp.parties[0]).toMatchObject({ party: 'PL', seats: 19 });
    expect(sp.parties.reduce((t, p) => t + p.nominal + (p.label ?? 0), 0)).toBe(sp.votes!.valid);
  });

  test('DF is office 8 (Deputado Distrital) under state-deputy; AC Assembleia is office 7', () => {
    const state = foldAll(inputs);
    expect(view(state, 'legislative/state-deputy/df', LegislativeUfView)).toMatchObject({ officeName: 'Deputado Distrital', seats: 24 });
    expect(view(state, 'legislative/state-deputy/ac', LegislativeUfView)).toMatchObject({ officeName: 'Deputado Estadual', seats: 24 });
    expect(classify('ele2026/6259/dados/df/df-c0007-e006259-u.jws', CFG)).toBeNull();
    expect(classify('ele2026/6259/dados/sp/sp-c0008-e006259-u.jws', CFG)).toBeNull();
    expect(classify('ele2026/6259/dados/sp/sp71072-c0006-e006259-u.jws', CFG)).toBeNull();
  });

  test('the br sum is partial while UFs are missing, never the chamber size (invariant 6)', () => {
    const br = view(foldAll(inputs), 'legislative/federal-deputy/br', LegislativeBrView);
    expect(br.complete).toBe(false);
    expect(br.ufs).toHaveLength(27);
    expect(br.ufs.filter((u) => u.status === 'not_published')).toHaveLength(26);
    expect(br.seatsCalc).toBe(70);
    const pl = br.parties.find((p) => p.party === 'PL')!;
    expect(pl.byUf[br.ufs.findIndex((u) => u.uf === 'sp')]).toBe(19);
    expect(pl.byUf.filter((x) => x === null)).toHaveLength(26);
  });

  test('no legislative views for a 2nd-round projector', () => {
    const names = [...render(foldAll(inputs), { ...CFG, legislative: false }).objects.keys()];
    expect(names.filter((n) => n.startsWith('legislative/'))).toEqual([]);
    expect([...render(foldAll(inputs), CFG).objects.keys()].filter((n) => n.startsWith('legislative/'))).toHaveLength(84);
  });
});

describe('determinism, idempotency, order independence', () => {
  test('rendering the same state twice is byte-identical', () => {
    const state = foldAll(inputs);
    expect(render(state, CFG).views).toEqual(render(state, CFG).views);
  });

  test('folding an input twice changes nothing', () => {
    const state = foldAll(inputs);
    const before = render(state, CFG).views;
    for (const { o, p } of inputs) expect(fold(state, o, CFG, p).changed).toBe(false);
    expect(render(state, CFG).views).toEqual(before);
  });

  test('20 random permutations (with health events) give byte-identical views', () => {
    const extra = [
      { o: obs(SP_MU, 'error', '2026-10-05T16:00:00.000Z', { error: 'timeout' }) },
      { o: obs(SP_MU, 'recovered', '2026-10-05T16:05:00.000Z') },
      { o: obs(BR, 'error', '2026-10-05T17:00:00.000Z', { error: '503' }) },
    ];
    const all = [...inputs, ...extra, ...inputs];
    const reference = render(foldAll(all), CFG).views;
    let seed = 42;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 20; k++) {
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(render(foldAll(shuffled), CFG).views).toEqual(reference);
    }
    // 21 full renders (5,571-row map and tables each): ~1 s on a laptop, 13 s on a GitHub
    // runner sharing its CPU with the testcontainers suites (CI, 2026-10-09).
  }, 60_000);
});

describe('acceptance and fetch health', () => {
  const brInput = () => inputs.find((i) => i.o.path === BR)!;

  test('fetch error keeps the last good numbers and says since when; recovery clears it', () => {
    const state = foldAll(inputs);
    fold(state, obs(BR, 'error', '2026-10-05T18:00:00.000Z', { error: 'timeout' }), CFG);
    const failing = view(state, 'result/president/br', ResultView);
    expect(failing).toMatchObject({ status: 'fetch_failed', failingSince: '2026-10-05T18:00:00.000Z' });
    expect(failing.votes?.valid).toBe(119_300_788);
    fold(state, obs(BR, 'recovered', '2026-10-05T18:03:00.000Z'), CFG);
    expect(view(state, 'result/president/br', ResultView)).toMatchObject({ status: 'final', failingSince: null });
  });

  test('an older error than the newest success does not mark the path failing', () => {
    const state = foldAll(inputs);
    expect(fold(state, obs(BR, 'error', '2026-10-01T00:00:00.000Z'), CFG).changed).toBe(false);
    expect(view(state, 'result/president/br', ResultView).status).toBe('final');
  });

  test('absent (the TSE withdrew the file): not_published, numbers null', () => {
    const state = foldAll(inputs);
    fold(state, obs(BR, 'absent', '2026-10-05T19:00:00.000Z', { httpStatus: 404 }), CFG);
    expect(view(state, 'result/president/br', ResultView)).toMatchObject({ status: 'not_published', votes: null, sources: [] });
  });

  test('a lower idg never replaces a higher one, in either order; no blob is needed for it', () => {
    const { o, p } = brInput();
    if (!p.ok) throw new Error('unreachable');
    // The acceptance rule only reads idg and sha256: relabel the real file's idg.
    const older = { o: { ...o, sha256: 'a'.repeat(64), idg: String(p.idg - 1), fetchedAt: '2026-10-05T20:00:00.000Z' }, p: { ...p, sha256: 'a'.repeat(64), idg: p.idg - 1 } };
    const a = foldAll([{ o, p }, older]);
    const b = foldAll([older, { o, p }]);
    expect(a.paths[BR]!.accepted!.sha256).toBe(o.sha256);
    expect(b.paths[BR]!.accepted!.sha256).toBe(o.sha256);
    expect(needsBlob(a, older.o, CFG)).toBe(false);
  });

  test('same idg, different bytes: the earliest fetched wins, in either order', () => {
    const { o, p } = brInput();
    const later = { o: { ...o, sha256: 'b'.repeat(64), fetchedAt: '2026-10-06T00:00:00.000Z' }, p: { ...p, sha256: 'b'.repeat(64) } };
    expect(foldAll([{ o, p }, later]).paths[BR]!.accepted!.sha256).toBe(o.sha256);
    expect(foldAll([later, { o, p }]).paths[BR]!.accepted!.sha256).toBe(o.sha256);
  });

  test('a tampered blob is rejected and never reaches a view', async () => {
    const bytes = Buffer.from(jwsSamples().get(BR)!);
    bytes[bytes.length - 5] = bytes[bytes.length - 5] === 65 ? 66 : 65; // inside the signature
    const p = await prepare(BR, classify(BR, CFG)!, bytes, keys);
    expect(p.ok).toBe(false);
    const state = emptyState();
    const res = fold(state, obs(BR, 'version', '2026-10-05T12:00:00.000Z', { sha256: p.sha256 }), CFG, p);
    expect(res.rejected).toMatch(/signature/);
    expect(view(state, 'result/president/br', ResultView).votes).toBeNull();
  });
});

test('leader and margin rules (§2.4 item 4)', () => {
  expect(leaderOf([60, 40], 100)).toEqual({ leader: 0, marginBpCalc: 2_000 });
  expect(leaderOf([40, 60], 100)).toEqual({ leader: 1, marginBpCalc: 2_000 });
  expect(leaderOf([50, 50], 100)).toEqual({ leader: -1, marginBpCalc: 0 });
  expect(leaderOf([0, 0], 0)).toEqual({ leader: -1, marginBpCalc: null });
  expect(leaderOf([null, 7], 7)).toEqual({ leader: 1, marginBpCalc: 10_000 });
  expect(pctToBp('47,03')).toBe(4_703);
  expect(pctToBp('100,00')).toBe(10_000);
});

test('MapView with every municipality null stays small', () => {
  const map = render(foldAll(inputs), CFG).views.get('map/president')!;
  expect(gzipSync(map).length).toBeLessThan(25_000);
});

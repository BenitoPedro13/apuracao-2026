import { readFileSync } from 'node:fs';
import { totalizationHistoryReader } from '@apuracao/tse';
import { beforeAll, describe, expect, test } from 'vitest';
import { classify, type ResultData } from './model.js';
import { prepare } from './prepare.js';
import { CFG, jwsSamples, keyring } from './samples.test-helper.js';
import { GAP_MS, historyTimeline, observedTimeline, type ObservedVersion } from './timeline.js';

const BR = 'ele2026/6257/dados/br/br-c0001-e006257-u.jws';
let final: ObservedVersion;

beforeAll(async () => {
  const bytes = jwsSamples().get(BR)!;
  const p = await prepare(BR, classify(BR, CFG)!, bytes, await keyring());
  if (!p.ok) throw new Error(p.reason);
  final = { sha256: p.sha256, idg: p.idg, fetchedAt: '2026-10-05T16:00:00.000Z', data: p.data as ResultData };
});

/** The real final file, as an earlier generation with fewer sections (our log's shape). */
function earlier(minutes: number, st: number, idg: number): ObservedVersion {
  const at = new Date(Date.parse(final.data.generatedAt) - minutes * 60_000).toISOString();
  return { ...final, sha256: String(idg).padStart(64, '0'), idg, data: { ...final.data, generatedAt: at, s: { ...final.data.s, st } } };
}

describe('observedTimeline', () => {
  test('one point per version, in the TSE generation order, never by idg alone', () => {
    // fold.ts since 93bbdad: a later file can carry a lower idg.
    const t = observedTimeline({ year: 2026, round: 1, path: BR, versions: [final, earlier(10, 1000, final.idg + 5)], segmentStarts: [] });
    expect(t.sections).toEqual([1000, final.data.s.st]);
    expect(t.at.at(-1)).toBe(final.data.generatedAt);
    expect(t.candidates.length).toBe(final.data.cand.length);
    expect(t.votes.map((v) => v.at(-1))).toEqual(final.data.cand.map((c) => c.votes));
    expect(t.valid.at(-1)).toBe(final.data.v.vv);
  });

  test('a version with the same numbers adds no point; replaying the same input gives the same object', () => {
    const again = { ...final, sha256: 'f'.repeat(64), fetchedAt: '2026-10-05T16:01:00.000Z' };
    const a = observedTimeline({ year: 2026, round: 1, path: BR, versions: [final, again], segmentStarts: [] });
    const b = observedTimeline({ year: 2026, round: 1, path: BR, versions: [again, final], segmentStarts: [] });
    expect(a.at).toHaveLength(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('a stretch without heartbeats becomes a gap', () => {
    const end = Date.parse(final.data.generatedAt);
    // Heartbeats every minute, except one silence just over GAP_MS.
    const resume = end - 19 * 60_000 + GAP_MS + 1;
    const starts = [end - 20 * 60_000, end - 19 * 60_000, ...Array.from({ length: 16 }, (_, k) => resume + k * 60_000), end];
    const t = observedTimeline({ year: 2026, round: 1, path: BR, versions: [earlier(20, 1000, 1), final], segmentStarts: starts });
    expect(t.gaps).toEqual([{ from: new Date(starts[1]!).toISOString(), to: new Date(starts[2]!).toISOString() }]);
  });
});

describe('historyTimeline', () => {
  const lines = readFileSync(new URL('../../../docs/research/samples/hist/Historico_Totalizacao_Presidente_BR_2T_2022.head-tail.csv', import.meta.url))
    .toString('latin1')
    .split(/\r?\n/)
    .filter(Boolean);
  const { read } = totalizationHistoryReader(lines[0]!);
  const rows = lines.slice(1).map(read);
  const args = {
    year: 2022,
    round: 2 as const,
    url: 'https://cdn.tse.jus.br/x.zip',
    sha256: 'a'.repeat(64),
    candidates: [
      { n: 13, name: 'LULA', party: 'PT' },
      { n: 22, name: 'JAIR BOLSONARO', party: 'PL' },
    ],
    rows,
  };

  test('keeps the last row per 0.1% of sections, and always the first and last', () => {
    const t = historyTimeline(args);
    // 0.1% = 472 sections: 55, 85, 458 | 573, 574 | 472073, 472074 | 472075.
    expect(t.sections).toEqual([55, 458, 574, 472074, 472075]);
    expect(t.votes.map((v) => v.at(-1))).toEqual([60345999, 58206354]);
    expect(t.source).toMatchObject({ kind: 'totalization-history', rows: 8 });
  });
});

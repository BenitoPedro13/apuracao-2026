import { CountTimeline } from '@apuracao/contracts';
import type { ResultData } from './model.js';

// "Ao longo da apuração" (TASK-over-the-count.md §2.1): the national president count as a
// series of real points. Pure and deterministic, like the folds: the same inputs give the
// same bytes. Nothing here interpolates; a point is a file the TSE published.

/** A stored version of the national result file, already verified and parsed (`prepare`). */
export interface ObservedVersion {
  sha256: string;
  idg: number;
  fetchedAt: string;
  data: ResultData;
}

/** More than this without an observation segment (heartbeat every 60 s) is a gap (architecture.md §5.3). */
export const GAP_MS = 3 * 60_000;

/** The fold's order (fold.ts, since 93bbdad): the TSE's generation instant, then idg. */
const byGeneration = (a: ObservedVersion, b: ObservedVersion) =>
  Date.parse(a.data.generatedAt) - Date.parse(b.data.generatedAt) ||
  a.idg - b.idg ||
  a.fetchedAt.localeCompare(b.fetchedAt) ||
  a.sha256.localeCompare(b.sha256);

/**
 * One point per version whose numbers changed. `segmentStarts` are the start instants of
 * every observation segment (ms): a stretch longer than `GAP_MS` without one, between the
 * first and the last point, means the recorder was down and becomes a gap.
 */
export function observedTimeline(args: {
  year: number;
  round: 1 | 2;
  path: string;
  versions: readonly ObservedVersion[];
  segmentStarts: readonly number[];
}): CountTimeline {
  const versions = [...args.versions].sort(byGeneration);
  const last = versions.at(-1);
  if (!last) throw new Error(`no version of ${args.path}`);
  const candidates = last.data.cand.map((c) => ({ n: Number(c.n), name: c.name, party: c.party }));
  const at: string[] = [];
  const sections: number[] = [];
  const valid: number[] = [];
  const votes: number[][] = candidates.map(() => []);
  let prevKey = '';
  for (const v of versions) {
    const d = v.data;
    const byN = new Map(d.cand.map((c) => [Number(c.n), c.votes]));
    const row = candidates.map((c) => byN.get(c.n) ?? 0);
    const key = `${d.s.st}|${d.v.vv}|${row.join(',')}`;
    if (key === prevKey) continue;
    prevKey = key;
    at.push(d.generatedAt);
    sections.push(d.s.st);
    valid.push(d.v.vv);
    row.forEach((n, i) => votes[i]!.push(n));
  }
  const from = Date.parse(at[0]!);
  const to = Date.parse(at.at(-1)!);
  const starts = [...args.segmentStarts].filter((t) => t >= from - GAP_MS && t <= to + GAP_MS).sort((a, b) => a - b);
  const gaps: CountTimeline['gaps'] = [];
  for (let k = 1; k < starts.length; k++) {
    if (starts[k]! - starts[k - 1]! > GAP_MS) gaps.push({ from: new Date(starts[k - 1]!).toISOString(), to: new Date(starts[k]!).toISOString() });
  }
  return CountTimeline.parse({
    v: 1,
    kind: 'count-timeline',
    office: 'president',
    year: args.year,
    round: args.round,
    source: { kind: 'tse-feed-observed', path: args.path, versions: versions.length },
    sectionsTotal: last.data.s.ts,
    candidates,
    at,
    sections,
    valid,
    votes,
    gaps,
  });
}

export interface HistoryRow {
  at: string;
  sectionsTotal: number;
  sections: number;
  valid: number;
  votes: number[];
}

/**
 * The TSE's totalization history, thinned to its last row per `step` of sections (default
 * 0.1%, ≤ 1,001 points from 2022's 5,286): every kept point is a real row, and the first
 * and last rows are always kept.
 */
export function historyTimeline(args: {
  year: number;
  round: 1 | 2;
  url: string;
  sha256: string;
  candidates: CountTimeline['candidates'];
  rows: readonly HistoryRow[];
  step?: number;
}): CountTimeline {
  const step = args.step ?? 0.001;
  const total = args.rows[0]?.sectionsTotal;
  if (total === undefined) throw new Error('no rows');
  const kept: HistoryRow[] = [];
  let bucket = -1;
  for (const [i, r] of args.rows.entries()) {
    if (r.sectionsTotal !== total) throw new Error(`row ${i}: sectionsTotal ${r.sectionsTotal} ≠ ${total}`);
    const b = Math.floor(r.sections / total / step);
    if (b !== bucket) kept.push(r);
    else kept[kept.length - 1] = r;
    bucket = b;
  }
  if (kept[0] !== args.rows[0]) kept.unshift(args.rows[0]!);
  return CountTimeline.parse({
    v: 1,
    kind: 'count-timeline',
    office: 'president',
    year: args.year,
    round: args.round,
    source: { kind: 'totalization-history', url: args.url, sha256: args.sha256, rows: args.rows.length },
    sectionsTotal: total,
    candidates: args.candidates,
    at: kept.map((r) => r.at),
    sections: kept.map((r) => r.sections),
    valid: kept.map((r) => r.valid),
    votes: args.candidates.map((_, i) => kept.map((r) => r.votes[i]!)),
    gaps: [],
  });
}

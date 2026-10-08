import { readFileSync, readdirSync } from 'node:fs';
import { tseInstant } from '@apuracao/contracts';
import { coveragePath, parsePath, type Area } from '@apuracao/tse';
import { jwsPayload, type Signer } from './sign.js';

// Staged reveal (TASK-fake-tse.md §2.2): what the TSE was serving at real instant `tReal`,
// given only the final version of each file. Pure: the same (capture, tReal) always gives
// the same bytes, so a file's ETag changes exactly when its content does.
//
// - `-u` files appear byte-identical at one instant and never change. A municipal file
//   appears at its row's `dt/ht` in its UF's `-ab` (the moment the TSE said it was
//   totalized), or at its own `hg` if that's earlier. That's not always the file's own
//   `dt/ht`: sp71072's final file says 05/10 12:51:05 (a re-totalization) while its row
//   says 04/10 21:50:33.
// - `-ab` files are rebuilt per step from the final file: rows with `ht ≤ tReal` kept
//   verbatim, later rows removed (never zeroed), test-signed. Once `tReal ≥` the file's own
//   `hg`, the original file is served unmodified.
// - Everything else (catalog, municipality indexes, JWKs) is served from the start.

/** URL path (relative to /oficial/) → bytes. File names are the path with '/' → '_'. */
export type Capture = Map<string, Buffer>;

export function loadCapture(dir: string): Capture {
  const capture: Capture = new Map();
  for (const name of readdirSync(dir)) {
    if (!/^(ele2026|comum|app)_/.test(name) || !/\.(json|jws)$/.test(name)) continue;
    capture.set(name.replace(/_/g, '/'), readFileSync(`${dir}/${name}`));
  }
  return capture;
}

interface Row {
  at: number;
  row: Record<string, unknown>;
}

export type PlanEntry =
  | { kind: 'static'; bytes: Buffer }
  | { kind: 'file'; at: number; bytes: Buffer }
  | {
      kind: 'coverage';
      final: Buffer;
      /** The final file's own dg/hg: served unmodified from then on. */
      finalAt: number;
      finalIdg: number;
      /** The final payload without `abr`, in its key order. */
      header: Record<string, unknown>;
      /** Rows in the file's order; `at` = their dt/ht (Infinity when empty). */
      rows: Row[];
      /** Row instants, sorted: step k reveals the first k. */
      steps: number[];
    };

export interface Plan {
  origin: number;
  entries: Map<string, PlanEntry>;
  /** Every distinct instant at which something appears or changes, sorted. */
  events: number[];
}

/** The 1st round's polls closed at 17:00 Brasília time on 2026-10-04. */
export const REPLAY_START_1T = Date.parse('2026-10-04T17:00:00-03:00');

/** Rebuilt idg = final − OFFSET + step: increases per step, stays below the real final idg. */
export const IDG_OFFSET = 1_000_000;

const instantOf = (dt: unknown, ht: unknown): number =>
  typeof dt === 'string' && typeof ht === 'string' && dt && ht ? Date.parse(tseInstant(dt, ht)) : Infinity;

const payloadOf = (bytes: Buffer) => JSON.parse(jwsPayload(bytes).toString('utf8')) as Record<string, unknown>;

/** Build the reveal plan from the `.jws` files of a capture (`.json` siblings are ignored). */
export function planReveal(capture: Capture, origin: number): Plan {
  const entries = new Map<string, PlanEntry>();
  const muAt = new Map<string, number>(); // coverage path|mu → row instant
  const results: [string, Buffer, Record<string, unknown>][] = [];

  for (const [path, bytes] of capture) {
    if (path.startsWith('app/')) {
      entries.set(path, { kind: 'static', bytes });
      continue;
    }
    if (!path.endsWith('.jws')) continue;
    const info = parsePath(path);
    if (info.fileType === 'ab') {
      const { abr, ...header } = payloadOf(bytes) as { abr: Record<string, unknown>[] } & Record<string, unknown>;
      const rows = abr.map((row) => ({ at: instantOf(row['dt'], row['ht']), row }));
      for (const r of rows) if (r.row['tpabr'] === 'mun') muAt.set(`${path}|${String(r.row['cdabr'])}`, r.at);
      const finalIdg = Number(header['idg']);
      if (!(finalIdg >= IDG_OFFSET + rows.length)) throw new Error(`${path}: idg ${String(header['idg'])} too small to rebuild`);
      entries.set(path, {
        kind: 'coverage',
        final: bytes,
        finalAt: instantOf(header['dg'], header['hg']),
        finalIdg,
        header,
        rows,
        steps: rows.map((r) => r.at).sort((a, b) => a - b),
      });
    } else if (info.fileType === 'u') {
      results.push([path, bytes, payloadOf(bytes)]);
    } else {
      entries.set(path, { kind: 'static', bytes });
    }
  }

  for (const [path, bytes, p] of results) {
    const info = parsePath(path);
    let at: number;
    if (info.scope?.level === 'mu') {
      const cov = coveragePath(info.election!, info.scope.uf as Area);
      // The row instant, but never after the file's own hg: it existed from then on. PE's
      // governor -ab (hg 06/10 16:59:20) has a row for pe30015 at 17:57:45, while the
      // pe30015 file says hg 16:59:33; the row would hide it for an hour after the -ab
      // showing that row went out.
      at = Math.min(muAt.get(`${cov}|${info.scope.mu}`) ?? Infinity, instantOf(p['dg'], p['hg']));
      if (at === Infinity) at = instantOf(p['dt'], p['ht']);
      if (at === Infinity) {
        const c = entries.get(cov);
        at = c?.kind === 'coverage' ? c.finalAt : instantOf(p['dg'], p['hg']);
      }
    } else {
      at = instantOf(p['dt'], p['ht']);
      if (at === Infinity) at = instantOf(p['dg'], p['hg']);
    }
    entries.set(path, { kind: 'file', at, bytes });
  }

  const events = new Set<number>();
  for (const e of entries.values()) {
    if (e.kind === 'file') events.add(e.at);
    if (e.kind === 'coverage') {
      events.add(e.finalAt);
      for (const s of e.steps) events.add(s);
    }
  }
  return { origin, entries, events: [...events].filter(Number.isFinite).sort((a, b) => a - b) };
}

/** Rows revealed at `tReal` (−1 = the original file), for a coverage entry. */
export function stepAt(entry: Extract<PlanEntry, { kind: 'coverage' }>, tReal: number): number {
  if (tReal >= entry.finalAt) return -1;
  let lo = 0;
  let hi = entry.steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entry.steps[mid]! <= tReal) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A UTC instant as the TSE's Brasília-time dd/mm/yyyy and HH:MM:SS (UTC−3, no DST since 2019). */
export function tseDateTime(t: number): { d: string; h: string } {
  const b = new Date(t - 3 * 3_600_000);
  return {
    d: `${pad(b.getUTCDate())}/${pad(b.getUTCMonth() + 1)}/${b.getUTCFullYear()}`,
    h: `${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}:${pad(b.getUTCSeconds())}`,
  };
}

/**
 * The coverage file at step `k`: the first k row instants revealed, rows in the file's own
 * order and verbatim, `dg/hg` = the latest revealed row (the origin for k = 0), and
 * `idg` = final − IDG_OFFSET + k. Test-signed.
 */
export function rebuildCoverage(entry: Extract<PlanEntry, { kind: 'coverage' }>, k: number, origin: number, signer: Signer): Buffer {
  const threshold = k === 0 ? -Infinity : entry.steps[k - 1]!;
  const { d, h } = tseDateTime(k === 0 ? origin : threshold);
  const payload = {
    ...entry.header,
    dg: d,
    hg: h,
    idg: String(entry.finalIdg - IDG_OFFSET + k),
    abr: entry.rows.filter((r) => r.at <= threshold).map((r) => r.row),
  };
  return signer.sign(Buffer.from(JSON.stringify(payload)));
}

/**
 * What `path` serves at `tReal`: a version id (stable while the bytes are) and a builder for
 * the bytes, or undefined (404). Coverage `step` is the rows revealed (−1 = the original).
 */
export function versionAt(plan: Plan, path: string, tReal: number, signer: Signer): { version: string; step?: number; build: () => Buffer } | undefined {
  const e = plan.entries.get(path);
  if (!e) return undefined;
  if (e.kind === 'static') return { version: 'final', build: () => e.bytes };
  if (e.kind === 'file') return tReal >= e.at ? { version: 'final', build: () => e.bytes } : undefined;
  const k = stepAt(e, tReal);
  if (k < 0) return { version: 'final', step: -1, build: () => e.final };
  return { version: `step-${k}`, step: k, build: () => rebuildCoverage(e, k, plan.origin, signer) };
}

/**
 * Replay clock with long quiet stretches shortened: a gap between consecutive events longer
 * than `maxGapMs` is cut to `maxGapMs`, so the tail (MA's last municipality at 01:56, the
 * abroad aggregate at 09:19, the final br files at 12:51 the next day) is reached in minutes.
 * `c` is replay milliseconds since the origin with the cuts removed.
 */
export class Timeline {
  readonly #knots: { c: number; removed: number }[] = [];
  readonly end: number;

  constructor(
    readonly origin: number,
    events: readonly number[],
    maxGapMs: number,
  ) {
    let removed = 0;
    let prev = origin;
    for (const e of events) {
      if (e <= prev) continue;
      if (e - prev > maxGapMs) {
        removed += e - prev - maxGapMs;
        this.#knots.push({ c: e - origin - removed, removed });
      }
      prev = e;
    }
    this.end = this.toCompressed(prev);
  }

  toReal(c: number): number {
    let removed = 0;
    for (const k of this.#knots) {
      if (k.c > c) break;
      removed = k.removed;
    }
    return this.origin + c + removed;
  }

  /** Inverse of toReal; an instant inside a cut maps to the cut's end. */
  toCompressed(tReal: number): number {
    let removed = 0;
    for (const k of this.#knots) {
      if (tReal < this.origin + k.c + removed) break; // before this cut
      if (tReal < this.origin + k.c + k.removed) return k.c; // inside it
      removed = k.removed;
    }
    return tReal - this.origin - removed;
  }
}

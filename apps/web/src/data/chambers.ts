import type { LegislativeBrView, LegislativeUfView } from "@apuracao/contracts";
import { hasOwnColour } from "@/lib/party";
import { pctNumber } from "@/lib/format";

// Senate and deputies (TASK-visual-pass-2.md §2.4). Pure, tested on the real views. Seats
// per party are the TSE's elected flags counted per UF (LegislativeBrView.byUf); every
// ordering and difference here is ours and is labelled where shown.

type Candidate = LegislativeUfView["candidates"][number];

export interface UfBench {
  uf: string;
  /** nv; null while the UF's file is missing. */
  seats: number | null;
  /** Parties with seats, most first (then sigla). */
  parties: { party: string; seats: number }[];
  /** The largest bench; several when tied. Empty without data. */
  largest: string[];
}

export function ufBenches(br: LegislativeBrView): UfBench[] {
  return br.ufs.map((u, i) => {
    const parties = br.parties
      .map((p) => ({ party: p.party, seats: p.byUf[i] ?? 0 }))
      .filter((p) => p.seats > 0)
      .sort((a, b) => b.seats - a.seats || a.party.localeCompare(b.party, "pt-BR"));
    const top = parties[0]?.seats ?? 0;
    return { uf: u.uf, seats: u.seats, parties, largest: top > 0 ? parties.filter((p) => p.seats === top).map((p) => p.party) : [] };
  });
}

/** A party's seats in a UF over the UF's seats, in 4 steps (0 is its own state). */
export const SHARE_BREAKS = [0.1, 0.25, 0.4] as const;
export function shareStep(seats: number, total: number): 0 | 1 | 2 | 3 | 4 {
  if (seats <= 0 || total <= 0) return 0;
  const s = seats / total;
  return s < SHARE_BREAKS[0] ? 1 : s < SHARE_BREAKS[1] ? 2 : s < SHARE_BREAKS[2] ? 3 : 4;
}

/** The senate seats won in a UF, most voted first (the TSE's `elected` flag). */
export const senateElected = (v: LegislativeUfView): Candidate[] =>
  v.candidates.filter((c) => c.elected).sort((a, b) => b.votes - a.votes);

export interface SenateClose {
  uf: string;
  lastElected: Candidate;
  firstOut: Candidate;
  /** Ours: votes of the last elected minus the first not elected. */
  votes: number;
}

/** Per UF, the last elected against the most voted not elected; closest (in TSE %) first. */
export function senateClosest(views: readonly (LegislativeUfView | undefined)[]): SenateClose[] {
  const out: { close: SenateClose; gap: number }[] = [];
  for (const v of views) {
    if (!v) continue;
    const elected = senateElected(v);
    const last = elected.at(-1);
    const out1 = v.candidates.filter((c) => !c.elected && c.destination === "Válido").sort((a, b) => b.votes - a.votes)[0];
    if (!last || !out1) continue;
    out.push({ close: { uf: v.area, lastElected: last, firstOut: out1, votes: last.votes - out1.votes }, gap: pctNumber(last.pct) - pctNumber(out1.pct) });
  }
  return out.sort((a, b) => a.gap - b.gap || a.close.votes - b.close.votes).map((o) => o.close);
}

export interface TopVoted extends Candidate {
  uf: string;
}

/** The most voted among the elected, across the UF files (deputy views list the elected only). */
export function topVoted(views: readonly (LegislativeUfView | undefined)[], n: number): TopVoted[] {
  return views
    .flatMap((v) => (v ? v.candidates.filter((c) => c.elected).map((c) => ({ ...c, uf: v.area })) : []))
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, n);
}

// --- The hemicycle ---------------------------------------------------------------------

export interface Group {
  /** A palette party, or null for "Outros". */
  party: string | null;
  seats: number;
}

/** Palette parties in seat order, then everyone else as one "Outros" group. */
export function hemicycleGroups(parties: readonly { party: string; seats: number }[]): Group[] {
  const own = parties.filter((p) => hasOwnColour(p.party) && p.seats > 0).sort((a, b) => b.seats - a.seats);
  const others = parties.filter((p) => !hasOwnColour(p.party)).reduce((t, p) => t + p.seats, 0);
  return [...own.map((p) => ({ party: p.party, seats: p.seats })), ...(others > 0 ? [{ party: null, seats: others }] : [])];
}

export interface Seat {
  /** In a box 2 wide and 1 tall: x from 0 (left) to 2, y from 0 (top) to 1 (the floor). */
  x: number;
  y: number;
}

const INNER = 0.4;

/**
 * n seats on concentric half rings (inner radius 0.4, outer 1), as many rows as needed,
 * seats per row proportional to its length; ordered by angle, left to right, so groups
 * fill wedges. Returns the dot radius too.
 */
export function hemicycle(n: number): { seats: Seat[]; r: number } {
  if (n <= 0) return { seats: [], r: 0 };
  let radii: number[] = [1];
  let caps: number[] = [Math.max(1, n)];
  let gap = 1 - INNER;
  for (let rows = 2; rows < 60; rows++) {
    gap = (1 - INNER) / (rows - 1);
    radii = Array.from({ length: rows }, (_, i) => INNER + i * gap);
    caps = radii.map((r) => Math.floor((Math.PI * r) / gap) + 1);
    if (caps.reduce((a, b) => a + b, 0) >= n) break;
  }
  // Largest remainder: seats per row proportional to its capacity, never above it.
  const total = caps.reduce((a, b) => a + b, 0);
  const exact = caps.map((c) => (c * n) / total);
  const per = exact.map((e, i) => Math.min(caps[i]!, Math.floor(e)));
  let left = n - per.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (per[i]! < caps[i]!) {
      per[i]!++;
      left--;
    }
  }
  const pts: { a: number; r: number }[] = [];
  per.forEach((k, i) => {
    for (let j = 0; j < k; j++) pts.push({ a: k === 1 ? Math.PI / 2 : Math.PI * (1 - j / (k - 1)), r: radii[i]! });
  });
  pts.sort((p, q) => q.a - p.a || p.r - q.r);
  return { seats: pts.map(({ a, r }) => ({ x: 1 + r * Math.cos(a), y: 1 - r * Math.sin(a) })), r: gap * 0.42 };
}

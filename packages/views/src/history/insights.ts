import type { HistoryInsights, HistoryMunicipalities, HistoryRound } from '@apuracao/contracts';

// The answers behind the history page's questions (TASK-historical-presidential.md §2.1).
// All of it is ours, computed from the TSE's numbers in the fold; each function is named
// after its question and documented with its exact method, which the page repeats.

type Mun = HistoryMunicipalities['rounds'][number];

export interface Inputs {
  rounds: HistoryRound[];
  muns: HistoryMunicipalities;
}

const pm = (x: number) => Math.round(1000 * x);

/** A municipality's valid votes in a round (null: not a municipality then). */
function valid(m: Mun, i: number): number | null {
  let s = 0;
  for (const c of m.votes) {
    const v = c[i];
    if (v === null || v === undefined) return null;
    s += v;
  }
  return s;
}

/** Candidate `c`'s share of valid votes in municipality `i` (null when absent or no valid votes). */
function share(m: Mun, c: number, i: number): number | null {
  if (c < 0) return null;
  const v = valid(m, i);
  return v ? m.votes[c]![i]! / v : null;
}

const nationalShare = (r: HistoryRound, c: number) => r.national.votes[c]! / r.national.votes.reduce((a, b) => a + b, 0);

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) (mx += xs[i]!), (my += ys[i]!);
  mx /= n;
  my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) (sxy += (xs[i]! - mx) * (ys[i]! - my)), (sxx += (xs[i]! - mx) ** 2);
  return sxy / sxx;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

export function computeInsights({ rounds, muns }: Inputs): HistoryInsights {
  const n = muns.ids.length;
  const years = [...new Set(rounds.map((r) => r.year))].sort((a, b) => a - b);
  const idx = (year: number, round: number) => rounds.findIndex((r) => r.year === year && r.round === round);
  const first = years.map((y) => idx(y, 1));
  const decisive = years.map((y) => rounds.findIndex((r) => r.year === y && r.decisive));
  const party = (ri: number, p: string) => rounds[ri]!.candidates.findIndex((c) => c.party === p);
  /** The PT's main rival: the best-placed non-PT candidate of the 1st round. */
  const rival = (ri: number) => rounds[ri]!.candidates.findIndex((c) => c.party !== 'PT');

  // Decisive round per year: municipal winner and margin.
  const decisiveOut = decisive.map((ri) => {
    const m = muns.rounds[ri]!;
    const winner: (number | null)[] = [];
    const marginPm: (number | null)[] = [];
    const exact: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
      const v = valid(m, i);
      if (!v) (winner.push(null), marginPm.push(null), exact.push(null));
      else {
        let a = -1, b = -1;
        m.votes.forEach((c, k) => {
          if (a < 0 || c[i]! > m.votes[a]![i]!) (b = a), (a = k);
          else if (b < 0 || c[i]! > m.votes[b]![i]!) b = k;
        });
        const margin = (m.votes[a]![i]! - (b >= 0 ? m.votes[b]![i]! : 0)) / v;
        winner.push(margin === 0 ? -1 : a); // an exact tie has no winner
        marginPm.push(pm(margin));
        exact.push(margin);
      }
    }
    return { winner, marginPm, exact };
  });

  // Bellwethers and the mirror: municipalities that voted in all 8 decisive rounds.
  const inAll = (i: number) => decisive.every((ri) => valid(muns.rounds[ri]!, i));
  const bellwetherHits = muns.ids.map((_, i) => (inAll(i) ? decisiveOut.filter((d) => d.winner[i] === 0).length : null));
  const mirrorGap = muns.ids.map((_, i) => {
    if (!inAll(i)) return null;
    let s = 0;
    for (const ri of decisive) s += Math.abs(share(muns.rounds[ri]!, 0, i)! - nationalShare(rounds[ri]!, 0));
    return pm(s / decisive.length);
  });

  // 1st round: the three national leaders' shares, per municipality.
  const leaders1t = first.map((ri) => [0, 1, 2].map((c) => muns.ids.map((_, i) => {
    const s = share(muns.rounds[ri]!, c, i);
    return s === null ? null : pm(s);
  })));

  const persistence = (a: number, ca: number, b: number, cb: number) => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = share(muns.rounds[a]!, ca, i), y = share(muns.rounds[b]!, cb, i);
      if (x !== null && y !== null) (xs.push(x), ys.push(y));
    }
    return { r: round4(pearson(xs, ys)), n: xs.length };
  };
  const ptPersistence = years.slice(1).map((to, k) => {
    const a = first[k]!, b = first[k + 1]!;
    return { from: years[k]!, to, ...persistence(a, party(a, 'PT'), b, party(b, 'PT')) };
  });
  const rivalPersistence = years.slice(1).map((to, k) => {
    const a = first[k]!, b = first[k + 1]!;
    return {
      from: years[k]!,
      to,
      fromName: rounds[a]!.candidates[rival(a)]!.name,
      toName: rounds[b]!.candidates[rival(b)]!.name,
      ...persistence(a, rival(a), b, rival(b)),
    };
  });

  // Flips: 2002 vs 2022, PT 1st-round share relative to Brazil, beyond ±5 p.p.
  const rel = (y: number, i: number) => {
    const ri = idx(y, 1);
    const s = share(muns.rounds[ri]!, party(ri, 'PT'), i);
    return s === null ? null : s - nationalShare(rounds[ri]!, party(ri, 'PT'));
  };
  const flips = { belowToAbove: 0, aboveToBelow: 0 };
  if (years.includes(2002) && years.includes(2022)) {
    for (let i = 0; i < n; i++) {
      const a = rel(2002, i), b = rel(2022, i);
      if (a === null || b === null) continue;
      if (a < -0.05 && b > 0.05) flips.belowToAbove++;
      if (a > 0.05 && b < -0.05) flips.aboveToBelow++;
    }
  }

  // The big sort: voters living in municipalities won by ≥ 40 p.p. (70/30 in a two-way race).
  const landslide = decisive.map((ri, k) => {
    const m = muns.rounds[ri]!;
    let voters = 0, of = 0, municipalities = 0, ofMunicipalities = 0;
    for (let i = 0; i < n; i++) {
      // The exact margin: rounding first would move Brasília 2018 (39.98 p.p.) over the line.
      const mg = decisiveOut[k]!.exact[i];
      const a = m.aptos[i];
      if (mg === null || mg === undefined || a === null || a === undefined) continue;
      of += a;
      ofMunicipalities++;
      if (mg >= 0.4) (voters += a), municipalities++;
    }
    return { year: years[k]!, round: rounds[ri]!.round, voters, of, municipalities, ofMunicipalities };
  });

  // Between rounds: the finalists' gains, everyone else's 1st-round votes, and how each
  // finalist's gain moves with the others' share across municipalities (an association).
  const transfers = years.filter((y) => idx(y, 2) >= 0).map((y) => {
    const r1 = rounds[idx(y, 1)]!, r2 = rounds[idx(y, 2)]!;
    const m1 = muns.rounds[idx(y, 1)]!, m2 = muns.rounds[idx(y, 2)]!;
    const fin = r2.candidates.map((c) => r1.candidates.findIndex((d) => d.n === c.n));
    const others = r1.national.votes.reduce((s, v, k) => (fin.includes(k) ? s : s + v), 0);
    const gains = [0, 1].map((k) => r2.national.votes[k]! - r1.national.votes[fin[k]!]!) as [number, number];
    const xs: number[] = [], ga: number[] = [], gb: number[] = [];
    for (let i = 0; i < n; i++) {
      const a1 = share(m1, fin[0]!, i), b1 = share(m1, fin[1]!, i), a2 = share(m2, 0, i), b2 = share(m2, 1, i);
      if (a1 === null || b1 === null || a2 === null || b2 === null) continue;
      xs.push(1 - a1 - b1);
      ga.push(a2 - a1);
      gb.push(b2 - b1);
    }
    return { year: y, others, gains, slope: [round4(slope(xs, ga)), round4(slope(xs, gb))] as [number, number] };
  });

  return {
    universe: bellwetherHits.filter((h) => h !== null).length,
    bellwetherHits,
    mirrorGap,
    leaders1t,
    decisive: decisiveOut.map(({ winner, marginPm }) => ({ winner, marginPm })),
    ptPersistence,
    rivalPersistence,
    flips,
    landslide,
    transfers,
    similar: similarMunicipalities(rounds, muns, first),
  };
}

/**
 * The 5 municipalities whose PT 1st-round share, relative to Brazil's, moved most like this
 * one's: root-mean-square difference over the elections both voted in (at least 6).
 */
function similarMunicipalities(rounds: HistoryRound[], muns: HistoryMunicipalities, first: number[]): number[][] {
  const n = muns.ids.length, Y = first.length;
  const v = new Float64Array(n * Y).fill(NaN);
  first.forEach((ri, y) => {
    const c = rounds[ri]!.candidates.findIndex((k) => k.party === 'PT');
    const nat = nationalShare(rounds[ri]!, c);
    for (let i = 0; i < n; i++) {
      const s = share(muns.rounds[ri]!, c, i);
      if (s !== null) v[i * Y + y] = s - nat;
    }
  });
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const best: [number, number][] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      let d = 0, k = 0;
      for (let y = 0; y < Y; y++) {
        const a = v[i * Y + y]!, b = v[j * Y + y]!;
        if (a === a && b === b) (d += (a - b) ** 2), k++; // a === a: not NaN
      }
      if (k < 6) continue;
      const dist = d / k;
      if (best.length < 5 || dist < best[best.length - 1]![0]) {
        best.push([dist, j]);
        best.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
        if (best.length > 5) best.pop();
      }
    }
    out.push(best.map(([, j]) => j));
  }
  return out;
}

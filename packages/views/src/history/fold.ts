import type { HistoryCandidate, HistoryMunicipalities, HistoryRound, HistoryTotals } from '@apuracao/contracts';
import type { CandidateRow, DetailRow } from '@apuracao/tse';

// The fold of the presidential archive (TASK-historical-presidential.md §2.2): TSE rows in,
// per-round totals and per-municipality arrays out. Pure and order-independent: rows are
// summed per (round, municipality, candidate), zones disappear, nothing else is derived.

/** One TSE municipality as the 2026 config names it: its IBGE code and accented name. */
export interface Place {
  ibge: string;
  name: string;
}

interface Acc {
  aptos: number;
  comparecimento: number;
  abstencoes: number;
  naoInstaladas: number;
  brancos: number;
  nulos: number;
  votes: Map<number, number>;
}
const acc = (): Acc => ({ aptos: 0, comparecimento: 0, abstencoes: 0, naoInstaladas: 0, brancos: 0, nulos: 0, votes: new Map() });

interface RoundAcc {
  year: number;
  round: 1 | 2;
  candidates: Map<number, { name: string; party: string }>;
  /** Keyed by TSE municipality code. */
  places: Map<string, { uf: string; kind: CandidateRow['kind']; acc: Acc }>;
}

export class HistoryFold {
  private readonly rounds = new Map<string, RoundAcc>();

  private place(r: { year: number; round: 1 | 2; municipality: string; uf: string; kind: CandidateRow['kind'] }) {
    const k = `${r.year}-${r.round}`;
    let ra = this.rounds.get(k);
    if (!ra) this.rounds.set(k, (ra = { year: r.year, round: r.round, candidates: new Map(), places: new Map() }));
    let p = ra.places.get(r.municipality);
    if (!p) ra.places.set(r.municipality, (p = { uf: r.uf, kind: r.kind, acc: acc() }));
    else if (p.uf !== r.uf) throw new Error(`${r.year} ${r.municipality}: UF ${p.uf} and ${r.uf}`);
    return { ra, p };
  }

  addCandidate(r: CandidateRow) {
    const { ra, p } = this.place(r);
    const known = ra.candidates.get(r.number);
    if (!known) ra.candidates.set(r.number, { name: r.name, party: r.party });
    else if (known.party !== r.party) throw new Error(`${r.year}: candidate ${r.number} is ${known.party} and ${r.party}`);
    p.acc.votes.set(r.number, (p.acc.votes.get(r.number) ?? 0) + r.votes);
  }

  addDetail(r: DetailRow) {
    const { p } = this.place(r);
    p.acc.aptos += r.aptos;
    p.acc.comparecimento += r.comparecimento;
    p.acc.abstencoes += r.abstencoes;
    p.acc.naoInstaladas += r.naoInstaladas;
    p.acc.brancos += r.brancos;
    p.acc.nulos += r.nulos;
  }

  /**
   * Rounds in (year, round) order, and every joined domestic municipality's numbers.
   * `places` maps TSE codes to IBGE; a domestic code it lacks is returned in `unjoined`,
   * never dropped silently.
   */
  build(places: ReadonlyMap<string, Place>): { rounds: HistoryRound[]; municipalities: HistoryMunicipalities; unjoined: { year: number; tse: string; uf: string }[] } {
    const ras = [...this.rounds.values()].sort((a, b) => a.year - b.year || a.round - b.round);
    const years = new Set(ras.map((r) => r.year));
    const rounds: HistoryRound[] = [];
    const order = new Map<RoundAcc, number[]>();
    for (const ra of ras) {
      const national = acc();
      const abroad = acc();
      const transit = acc();
      const byUf = new Map<string, Acc>();
      let hasAbroad = false;
      let hasTransit = false;
      for (const { uf, kind, acc: a } of ra.places.values()) {
        add(national, a);
        if (kind === 'abroad') (add(abroad, a), (hasAbroad = true));
        else if (kind === 'transit') (add(transit, a), (hasTransit = true));
        else {
          let u = byUf.get(uf);
          if (!u) byUf.set(uf, (u = acc()));
          add(u, a);
        }
      }
      const nums = [...ra.candidates.keys()].sort((x, y) => (national.votes.get(y) ?? 0) - (national.votes.get(x) ?? 0) || x - y);
      order.set(ra, nums);
      const candidates: HistoryCandidate[] = nums.map((n) => ({ n, ...ra.candidates.get(n)! }));
      const totals = (a: Acc): HistoryTotals => ({
        aptos: a.aptos,
        comparecimento: a.comparecimento,
        abstencoes: a.abstencoes,
        naoInstaladas: a.naoInstaladas,
        brancos: a.brancos,
        nulos: a.nulos,
        votes: nums.map((n) => a.votes.get(n) ?? 0),
      });
      const decisive = ra.round === 2 || !ras.some((o) => o.year === ra.year && o.round === 2);
      rounds.push({
        year: ra.year,
        round: ra.round,
        decisive,
        candidates,
        national: totals(national),
        abroad: hasAbroad ? totals(abroad) : null,
        transit: hasTransit ? totals(transit) : null,
        byUf: Object.fromEntries([...byUf].sort(([a], [b]) => a.localeCompare(b)).map(([uf, a]) => [uf, totals(a)])),
      });
    }

    // Municipalities: every joined domestic code seen in any round, by IBGE code.
    const unjoined: { year: number; tse: string; uf: string }[] = [];
    const seen = new Map<string, { tse: string; uf: string; name: string }>();
    for (const ra of ras) {
      for (const [code, p] of ra.places) {
        if (p.kind !== 'domestic') continue;
        const place = places.get(code);
        if (!place) {
          if (!unjoined.some((u) => u.year === ra.year && u.tse === code)) unjoined.push({ year: ra.year, tse: code, uf: p.uf });
          continue;
        }
        const prev = seen.get(place.ibge);
        if (prev && prev.tse !== code) throw new Error(`IBGE ${place.ibge} is both TSE ${prev.tse} and ${code}`);
        seen.set(place.ibge, { tse: code, uf: p.uf, name: place.name });
      }
    }
    const ids = [...seen.keys()].sort();
    const munRounds = ras.map((ra) => {
      const nums = order.get(ra)!;
      const col = (f: (a: Acc) => number) => ids.map((id) => {
        const p = ra.places.get(seen.get(id)!.tse);
        return p ? f(p.acc) : null;
      });
      return {
        year: ra.year,
        round: ra.round,
        aptos: col((a) => a.aptos),
        comparecimento: col((a) => a.comparecimento),
        brancos: col((a) => a.brancos),
        nulos: col((a) => a.nulos),
        votes: nums.map((n) => col((a) => a.votes.get(n) ?? 0)),
      };
    });
    if (years.size === 0) throw new Error('no rows');
    return {
      rounds,
      municipalities: {
        v: 1,
        ids,
        tse: ids.map((id) => seen.get(id)!.tse),
        uf: ids.map((id) => seen.get(id)!.uf),
        name: ids.map((id) => seen.get(id)!.name),
        rounds: munRounds,
      },
      unjoined: unjoined.sort((a, b) => a.year - b.year || a.tse.localeCompare(b.tse)),
    };
  }
}

function add(into: Acc, a: Acc) {
  into.aptos += a.aptos;
  into.comparecimento += a.comparecimento;
  into.abstencoes += a.abstencoes;
  into.naoInstaladas += a.naoInstaladas;
  into.brancos += a.brancos;
  into.nulos += a.nulos;
  for (const [n, v] of a.votes) into.votes.set(n, (into.votes.get(n) ?? 0) + v);
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { HistoryCandidate, HistoryFile, HistoryMunicipalities, HistoryRound, HistoryTotals } from "@apuracao/contracts";
import { historyQuery, historyUfQuery, isHistoryUf } from "@/history/queries";
import { displayName } from "@/lib/format";
import { setUrlParams } from "./use-url-state";

// The presidential archive's business rules, in one place (global frontend rules;
// TASK-historical-presidential.md §2.3). Every percentage here is ours: the TSE's archive
// files hold counts only. Components format and render.

/** `?historico` switches the page to the archive (no routes on the plan-B bucket). */
export function useHistoryMode(): boolean {
  return useSearchParams().has("historico");
}

/**
 * The PT and its main rival are the two poles of every election since 1994 (the rival's map
 * carries over at r = 0.85–0.98 since 2006, research 05 §6.3). The rival: the best-placed
 * non-PT candidate of that year's 1st round.
 */
export type Pole = "pt" | "rival" | "other";

export interface HistoryModel {
  file: HistoryFile;
  years: number[];
  /** Rounds of a year, 1st first. */
  roundsOf(year: number): HistoryRound[];
  first(year: number): HistoryRound;
  decisive(year: number): HistoryRound;
  pole(round: HistoryRound, candidate: number): Pole;
  /** Index of a municipality by IBGE code. */
  indexOf(ibge: string): number;
}

export const POLE_COLOR: Record<Pole, string> = {
  pt: "var(--pt)",
  rival: "var(--pl)",
  other: "var(--party-other)",
};

/** "Lula", "Fernando Henrique": the ballot name, title-cased. */
export const candidateName = (c: HistoryCandidate) => displayName(c.name);

export const validOf = (t: Pick<HistoryTotals, "votes">) => t.votes.reduce((a, b) => a + b, 0);

/** A candidate's share of valid votes (ours), 0–1; null without valid votes. */
export function shareOf(t: Pick<HistoryTotals, "votes">, candidate: number): number | null {
  const v = validOf(t);
  return v ? t.votes[candidate]! / v : null;
}

/** Our percentages: one decimal, comma ("46,4"). */
const pctFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const pct = (x: number) => `${pctFmt.format(x * 100)}%`;
/** Percentage points with a sign ("+12,3 p.p.", "−4,0 p.p."). */
export const pp = (x: number) => `${x >= 0 ? "+" : "−"}${pctFmt.format(Math.abs(x * 100))} p.p.`;
export const perMille = (x: number) => x / 1000;
const rFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const formatR = (r: number) => rFmt.format(r);

function model(file: HistoryFile): HistoryModel {
  const index = new Map(file.ids.map((id, i) => [id, i]));
  const rounds = (year: number) => file.rounds.filter((r) => r.year === year).sort((a, b) => a.round - b.round);
  const rivalNumber = new Map(
    file.years.map((y) => {
      const r1 = rounds(y)[0]!;
      return [y, r1.candidates.find((c) => c.party !== "PT")!.n];
    }),
  );
  return {
    file,
    years: file.years,
    roundsOf: rounds,
    first: (y) => rounds(y)[0]!,
    decisive: (y) => rounds(y).find((r) => r.decisive)!,
    pole: (r, c) => {
      const cand = r.candidates[c];
      if (!cand) return "other";
      if (cand.party === "PT") return "pt";
      return cand.n === rivalNumber.get(r.year) ? "rival" : "other";
    },
    indexOf: (ibge) => index.get(ibge) ?? -1,
  };
}

/** The archive (one file, ~420 KB gzip), with its rules. */
export function useHistory() {
  return useQuery({ ...historyQuery(), select: model });
}

/** `?mun=` (IBGE code), shared with the live page's selection. */
export function useHistoryMunicipality(): [string | null, (ibge: string | null) => void] {
  const v = useSearchParams().get("mun");
  return [v && /^\d{7}$/.test(v) ? v : null, (ibge) => setUrlParams({ mun: ibge })];
}

/** `?ano=` for the year view; the latest election when absent or unknown. */
export function useHistoryYear(years: readonly number[]): [number, (year: number) => void] {
  const v = Number(useSearchParams().get("ano"));
  const latest = years.at(-1) ?? 2022;
  return [years.includes(v) ? v : latest, (y) => setUrlParams({ ano: y === latest ? null : String(y) })];
}

/** One election of one municipality, every number the TSE published for it. */
export interface TownRound {
  year: number;
  round: 1 | 2;
  decisive: boolean;
  /** null: not a municipality in that election (invariant 6). */
  aptos: number | null;
  comparecimento: number | null;
  brancos: number | null;
  nulos: number | null;
  /** Candidates by their votes here, most first (ours: the share). */
  candidates: {
    c: HistoryCandidate;
    pole: Pole;
    votes: number;
    share: number;
  }[];
  /** Brazil's share for the town's winner, to compare. */
  nationalShareOfWinner: number | null;
  /** The town chose the national winner (decisive rounds only). */
  pickedWinner: boolean | null;
}

/** A municipality's whole history, from its UF's file (loaded on demand). */
export function useTownHistory(m: HistoryModel | undefined, ibge: string | null) {
  const i = m && ibge ? m.indexOf(ibge) : -1;
  const uf = i >= 0 ? m!.file.uf[i]! : null;
  const q = useQuery({
    ...historyUfQuery(uf && isHistoryUf(uf) ? uf : "SP"),
    enabled: !!uf && isHistoryUf(uf),
  });
  if (!m || i < 0 || !q.data)
    return {
      data: null,
      error: q.error,
      isLoading: q.isLoading || (!!ibge && !m),
    };
  return {
    data: townRounds(m, q.data, ibge!),
    error: q.error,
    isLoading: false,
  };
}

function townRounds(m: HistoryModel, ufFile: HistoryMunicipalities, ibge: string): TownRound[] {
  const j = ufFile.ids.indexOf(ibge);
  return ufFile.rounds.map((mr) => {
    const r = m.file.rounds.find((x) => x.year === mr.year && x.round === mr.round)!;
    const votes = mr.votes.map((c) => c[j] ?? null);
    const present = mr.aptos[j] !== null && votes.every((v) => v !== null);
    const valid = present ? (votes as number[]).reduce((a, b) => a + b, 0) : 0;
    const candidates = present
      ? (votes as number[])
          .map((v, k) => ({
            c: r.candidates[k]!,
            pole: m.pole(r, k),
            votes: v,
            share: valid ? v / valid : 0,
            k,
          }))
          .sort((a, b) => b.votes - a.votes || a.k - b.k)
          .map(({ k: _k, ...rest }) => rest)
      : [];
    const top = candidates[0];
    const tie = candidates.length > 1 && candidates[0]!.votes === candidates[1]!.votes;
    const winnerIndex = top ? r.candidates.indexOf(top.c) : -1;
    return {
      year: mr.year,
      round: mr.round,
      decisive: r.decisive,
      aptos: mr.aptos[j] ?? null,
      comparecimento: mr.comparecimento[j] ?? null,
      brancos: mr.brancos[j] ?? null,
      nulos: mr.nulos[j] ?? null,
      candidates,
      nationalShareOfWinner: top ? shareOf(r.national, winnerIndex) : null,
      pickedWinner: r.decisive && present && !tie ? winnerIndex === 0 : null,
    };
  });
}

/** Accent- and case-insensitive key for the municipality search. */
export const searchKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The IBGE Nordeste (packages/views/src/regions.ts; the web build doesn't import views). */
export const NORDESTE: ReadonlySet<string> = new Set(["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"]);

const milFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
/** "7,1 milhões", "695 mil": a rounded count, ours. */
export function millions(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${milFmt.format(a / 1e6)} milhões` : a >= 1e3 ? `${Math.round(a / 1e3)} mil` : String(a);
  return n < 0 ? `−${s}` : s;
}

/** Correlation across municipalities (ours), for pairs the archive doesn't precompute. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n,
    my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx,
      dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** A 1st-round leader's share per municipality, as 0–1 (null: absent), from the archive's per-mille arrays. */
export function leaderShares(m: HistoryModel, year: number, leader: number): (number | null)[] {
  const k = m.years.indexOf(year);
  return m.file.insights.leaders1t[k]![leader]!.map((v) => (v === null ? null : v / 1000));
}

/** Pairs of shares present in both lists, as scatter points. */
export function pairs(xs: (number | null)[], ys: (number | null)[]) {
  const out: { x: number; y: number; i: number }[] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (x !== null && y !== null && y !== undefined) out.push({ x, y, i });
  });
  return out;
}

/** The PT's position among a year's three 1st-round leaders (it was 1st or 2nd every time). */
export const ptLeader = (m: HistoryModel, year: number) =>
  m
    .first(year)
    .candidates.slice(0, 3)
    .findIndex((c) => c.party === "PT");

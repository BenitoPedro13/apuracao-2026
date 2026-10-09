import type { ResultStatus, ResultView, TsePct } from "@apuracao/contracts";
import { ELECTIONS } from "@apuracao/tse/codes";
import { areaName } from "@/lib/places";
import { byVotes, difference, hasNumbers, type Difference } from "./rules";

// Governor races (TASK-visual-pass-2.md §2.3). Pure, so they're tested on the real views.
// The outcome is the TSE's own `situation` ("Eleito", "2º turno"), never our inference.

type Candidate = ResultView["candidates"][number];

/**
 * - `eleito`: a candidate's situation is "Eleito".
 * - `2turno`: the top two go to a runoff ("2º turno").
 * - `apurando`: numbers, no decision yet.
 * - `sem-dados`: the view has no numbers (status says why).
 * - `sem-disputa`: this round has no race in the UF (the manifest has no view).
 * - `carregando`: not loaded yet.
 */
export type GovernorOutcome = "eleito" | "2turno" | "apurando" | "sem-dados" | "sem-disputa" | "carregando";

export interface GovernorRace {
  uf: string;
  name: string;
  status: ResultStatus | undefined;
  failingSince: string | null;
  outcome: GovernorOutcome;
  first: Candidate | null;
  second: Candidate | null;
  /** Ours: first − second over vvc. */
  difference: Difference | null;
  countedPct: TsePct | null;
}

export function governorRace(uf: string, view: ResultView | undefined, absent: boolean): GovernorRace {
  const base = { uf, name: areaName(uf), status: view?.status, failingSince: view?.failingSince ?? null, countedPct: view?.sections?.countedPct ?? null };
  if (absent) return { ...base, outcome: "sem-disputa", first: null, second: null, difference: null };
  if (!view) return { ...base, outcome: "carregando", first: null, second: null, difference: null };
  if (!hasNumbers(view)) return { ...base, outcome: "sem-dados", first: null, second: null, difference: null };
  const [first, second] = byVotes(view.candidates);
  const lead = first && first.votes > 0 ? first : null;
  const outcome: GovernorOutcome = view.candidates.some((c) => c.situation === "Eleito")
    ? "eleito"
    : view.candidates.some((c) => c.situation === "2º turno")
      ? "2turno"
      : "apurando";
  return {
    ...base,
    outcome,
    first: lead,
    second: lead && second ? second : null,
    difference: lead && second && view.votes ? difference(lead, second, view.votes.validWithSubJudice) : null,
  };
}

export interface GovernorSummary {
  /** UFs with a race this round. */
  races: number;
  elected: number;
  runoff: number;
  counting: number;
}

/** Counts of the TSE's own outcomes (the counting is ours, the outcomes are the TSE's). */
export function governorSummary(races: readonly GovernorRace[]): GovernorSummary {
  const n = (o: GovernorOutcome) => races.filter((r) => r.outcome === o).length;
  return {
    races: races.filter((r) => r.outcome !== "sem-disputa").length,
    elected: n("eleito"),
    runoff: n("2turno"),
    counting: n("apurando") + n("sem-dados") + n("carregando"),
  };
}

/** Smallest difference between the top two first; races without one are left out. */
export function closestRaces(races: readonly GovernorRace[]): GovernorRace[] {
  return races
    .filter((r) => r.difference !== null)
    .sort((a, b) => a.difference!.bp - b.difference!.bp || a.name.localeCompare(b.name, "pt-BR"));
}

/** Whether a view is the runoff's (the 2nd-round state election). */
export const isRunoff = (view: { election: string } | undefined) => view?.election === ELECTIONS.state2;

export function outcomeLabel(outcome: GovernorOutcome, runoff: boolean): string {
  switch (outcome) {
    case "eleito":
      return runoff ? "Eleito" : "Eleito no 1º turno";
    case "2turno":
      return "Vai ao 2º turno";
    case "apurando":
      return "Apurando";
    case "sem-dados":
      return "Sem números ainda";
    case "sem-disputa":
      return "Sem 2º turno neste estado";
    case "carregando":
      return "Carregando…";
  }
}

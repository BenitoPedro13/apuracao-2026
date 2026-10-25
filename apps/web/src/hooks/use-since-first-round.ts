"use client";

import type { TsePct } from "@apuracao/contracts";
import { ELECTIONS, UFS } from "@apuracao/tse/codes";
import { byVotes, hasNumbers, marginShift } from "@/data/rules";
import { areaName } from "@/lib/places";
import { useFirstRoundResults, useManifest, useResult, useResults, useSelectedRound } from "./use-data";

export interface ShiftCandidate {
  n: string;
  name: string;
  party: string;
}

export interface ShiftRow {
  uf: string;
  name: string;
  /** Percentage points of valid votes the margin moved toward `toward`. */
  points: number;
  countedPct: TsePct | null;
}

export interface SinceFirstRound {
  /** The 2nd round's two candidates, in the national file's order. */
  candidates: [ShiftCandidate, ShiftCandidate];
  /** One list per candidate: the UFs whose margin moved their way, biggest move first. */
  toward: [ShiftRow[], ShiftRow[]];
  /** UFs without 2nd-round numbers yet (missing, not zero). */
  waiting: number;
}

/**
 * "Desde o 1º turno" (TASK-night-copy-and-shift.md §2.3): per UF, how the margin between the
 * 2nd round's two candidates moved since the 1st round. null when the live round isn't the
 * 2nd, or before the national file names the candidates.
 */
export function useSinceFirstRound(): { data: SinceFirstRound | null; isLoading: boolean } {
  const { selected } = useSelectedRound();
  const manifest = useManifest();
  const national = useResult("president", "br");
  const round2 = useResults("president", UFS);
  const round1 = useFirstRoundResults("president", UFS);

  const isSecond = !!selected?.live && manifest.data?.elections.president === ELECTIONS.federal2;
  const pair = national.data?.candidates;
  if (!isSecond || !pair || pair.length !== 2) return { data: null, isLoading: national.isLoading };
  // The national order once there are votes; the TSE's own order before.
  const [a, b] = (hasNumbers(national.data!) ? byVotes(pair) : pair).map((c) => ({ n: c.n, name: c.name, party: c.party }));

  const toward: [ShiftRow[], ShiftRow[]] = [[], []];
  let waiting = 0;
  UFS.forEach((uf, i) => {
    const v2 = round2[i]!.data;
    const v1 = round1[i]!.data;
    const points = v1 && v2 ? marginShift(a!.n, b!.n, v1, v2) : null;
    if (points === null) {
      waiting++;
      return;
    }
    if (points === 0) return;
    const row = { uf, name: areaName(uf), points: Math.abs(points), countedPct: v2!.sections?.countedPct ?? null };
    toward[points > 0 ? 0 : 1].push(row);
  });
  for (const list of toward) list.sort((x, y) => y.points - x.points);
  return {
    data: { candidates: [a!, b!], toward, waiting },
    isLoading: round2.some((r) => r.isLoading) || round1.some((r) => r.isLoading),
  };
}

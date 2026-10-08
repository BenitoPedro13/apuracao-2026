"use client";

import type { Office, RegionsView, ResultView } from "@apuracao/contracts";
import { byVotes, difference, hasNumbers } from "@/data/rules";
import { useRegions, useResult, type ViewState } from "./use-data";

type Candidate = ResultView["candidates"][number];

export interface Headline {
  view: ResultView;
  /** Only when the status has numbers (counting/final); otherwise the status says why not. */
  ranked: Candidate[] | null;
  difference: ReturnType<typeof difference>;
}

/** The national (or a UF's) headline: leaders by votes, and our computed difference. */
export function useHeadline(office: Office, area = "br"): ViewState<Headline> {
  const result = useResult(office, area);
  const view = result.data;
  let data: Headline | undefined;
  if (view) {
    const ranked = hasNumbers(view) ? byVotes(view.candidates) : null;
    const [first, second] = ranked ?? [];
    data = {
      view,
      ranked,
      difference: first && second && view.votes ? difference(first, second, view.votes.validWithSubJudice) : null,
    };
  }
  return { ...result, data };
}

export interface RegionRow {
  code: RegionsView["regions"][number]["code"];
  name: string;
  complete: boolean;
  /** null: no UF of the region has data yet. */
  leader: { name: string; party: string; n: string; pctBp: number } | null;
  countedBp: number | null;
}

/** The 5 regions as our own sums (architecture.md §7.4), leader first. */
export function useRegionRows(): ViewState<RegionRow[]> {
  const regions = useRegions();
  const view = regions.data;
  const data = view?.regions.map((r): RegionRow => {
    const calc = r.calc;
    let leader: RegionRow["leader"] = null;
    if (calc?.pctBpCalc) {
      let best = -1;
      calc.votes.forEach((v, i) => {
        if (best < 0 || v > calc.votes[best]!) best = i;
      });
      const c = view.candidates[best];
      if (c && calc.votes[best]! > 0) leader = { name: c.name, party: c.party, n: c.n, pctBp: calc.pctBpCalc[best]! };
    }
    return { code: r.code, name: r.name, complete: r.complete, leader, countedBp: calc?.countedBpCalc ?? null };
  });
  return { ...regions, data };
}

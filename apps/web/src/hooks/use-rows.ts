"use client";

import type { MunicipalityView, ResultStatus, TsePct } from "@apuracao/contracts";
import { ABROAD } from "@apuracao/tse";
import { byVotes, hasNumbers } from "@/data/rules";
import { AREAS, areaName } from "@/lib/places";
import { useMunicipalities, useResults, type ViewState } from "./use-data";
import { useShowExterior } from "./use-url-state";

export interface LeaderCell {
  name: string;
  party: string;
  n: string;
  /** The TSE's own string. */
  pct: TsePct;
}

export interface AreaRow {
  area: string;
  name: string;
  /** undefined while loading or on error with nothing cached. */
  status: ResultStatus | undefined;
  failingSince: string | null;
  countedPct: TsePct | null;
  leader: LeaderCell | null;
  error: Error | null;
}

/** The UF table: 27 UFs + Exterior (unless hidden), from each UF's TSE file. */
export function useAreaRows(): { rows: AreaRow[]; isLoading: boolean } {
  const [showExterior] = useShowExterior();
  const areas = showExterior ? AREAS : AREAS.filter((a) => a !== ABROAD);
  const results = useResults("president", areas);
  const rows = areas.map((area, i): AreaRow => {
    const r = results[i]!;
    const v = r.data;
    const top = v && hasNumbers(v) ? byVotes(v.candidates)[0] : undefined;
    return {
      area,
      name: areaName(area),
      status: v?.status,
      failingSince: v?.failingSince ?? null,
      countedPct: v?.sections?.countedPct ?? null,
      leader: top && top.votes > 0 ? { name: top.name, party: top.party, n: top.n, pct: top.pct } : null,
      error: r.error,
    };
  });
  return { rows, isLoading: results.some((r) => r.isLoading) };
}

export interface MunicipalityRowView {
  mu: string;
  name: string;
  capital: boolean;
  status: ResultStatus;
  failingSince: string | null;
  countedPct: TsePct | null;
  leader: LeaderCell | null;
  /** -1 in the view with votes: an exact tie (architecture.md §6.3), not missing data. */
  tie: boolean;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");

function toRow(view: MunicipalityView, r: MunicipalityView["rows"][number]): MunicipalityRowView {
  const c = r.leader >= 0 ? view.candidates[r.leader] : undefined;
  const pct = r.leader >= 0 ? r.pct?.[r.leader] : null;
  const shown = hasNumbers({ status: r.status, votes: r.votes });
  return {
    mu: r.mu,
    name: r.name,
    capital: r.capital,
    status: r.status,
    failingSince: r.failingSince,
    countedPct: r.sections?.countedPct ?? null,
    leader: shown && c && pct ? { name: c.name, party: c.party, n: c.n, pct } : null,
    tie: shown && r.leader === -1 && (r.validWithSubJudice ?? 0) > 0,
  };
}

/** The table alternative to the map for one UF (invariant 7), searchable without accents. */
export function useMunicipalityRows(area: string | null, search: string): ViewState<MunicipalityRowView[]> {
  const view = useMunicipalities("president", area);
  const q = fold(search.trim());
  const data = view.data?.rows.filter((r) => !q || fold(r.name).includes(q)).map((r) => toRow(view.data!, r));
  return { ...view, data };
}

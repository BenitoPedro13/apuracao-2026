"use client";

import type { LegislativeBrView, LegislativeOffice, LegislativeUfView } from "@apuracao/contracts";
import { areaName } from "@/lib/places";
import { useLegislativeBr, useLegislativeUf, type ViewState } from "./use-data";
import { useCargo, type Cargo } from "./use-url-state";

// Senate and deputies, 1st round only (TASK-legislative-archive.md §2.4). Labels and the
// rows the components draw live here once; the components only render.

export interface Chamber {
  office: LegislativeOffice;
  /** Panel titles. */
  title: string;
  /** "senadores eleitos", for the national total. */
  electedNoun: string;
  /** Whether lists, legenda votes and the electoral quotient apply (proportional vote). */
  proportional: boolean;
}

export const CHAMBERS: Record<Exclude<Cargo, "presidente">, Chamber> = {
  senado: { office: "senate", title: "Senado", electedNoun: "senadores eleitos", proportional: false },
  camara: { office: "federal-deputy", title: "Câmara dos Deputados", electedNoun: "deputados federais eleitos", proportional: true },
  assembleias: {
    office: "state-deputy",
    title: "Assembleias Legislativas e Câmara Legislativa do DF",
    electedNoun: "deputados estaduais e distritais eleitos",
    proportional: true,
  },
};

/** The chamber the page shows, or null on the president's page. */
export function useChamber(): Chamber | null {
  const cargo = useCargo();
  return cargo === "presidente" ? null : CHAMBERS[cargo];
}

export interface SeatRow {
  party: string;
  /** Our sum over the UF files. */
  seats: number;
}

export interface UfSeatsRow {
  uf: string;
  name: string;
  /** nv, from the UF's file; null while missing. */
  seats: number | null;
  /** "PL 19 · PT 11 · …" by seats, from the TSE's elected flags. */
  parties: { party: string; seats: number }[];
}

export interface NationalSeats {
  view: ViewState<LegislativeBrView>;
  bars: SeatRow[];
  /** For the bar scale. */
  maxSeats: number;
  ufRows: UfSeatsRow[];
}

export function useNationalSeats(office: LegislativeOffice): NationalSeats {
  const view = useLegislativeBr(office);
  const v = view.data;
  const bars = v?.parties.map((p) => ({ party: p.party, seats: p.seatsCalc })) ?? [];
  const ufRows =
    v?.ufs
      .map((u, i) => ({
        uf: u.uf,
        name: areaName(u.uf),
        seats: u.seats,
        parties: v.parties
          .map((p) => ({ party: p.party, seats: p.byUf[i] ?? 0 }))
          .filter((p) => p.seats > 0)
          .sort((a, b) => b.seats - a.seats || a.party.localeCompare(b.party, "pt-BR")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) ?? [];
  return { view, bars, maxSeats: Math.max(1, ...bars.map((b) => b.seats)), ufRows };
}

export interface PartyRow {
  party: string;
  name: string;
  seats: number;
  nominal: number;
  /** null for the senate. */
  label: number | null;
  /** nominal + legenda: ours (a sum of two TSE fields). */
  totalCalc: number;
}

export interface UfRace {
  view: ViewState<LegislativeUfView>;
  name: string | null;
  parties: PartyRow[];
  candidates: LegislativeUfView["candidates"];
}

export function useUfRace(office: LegislativeOffice, uf: string | null): UfRace {
  const view = useLegislativeUf(office, uf);
  const v = view.data;
  return {
    view,
    name: uf ? areaName(uf) : null,
    parties:
      v?.parties
        .filter((p) => p.seats > 0 || p.nominal + (p.label ?? 0) > 0)
        .map((p) => ({ party: p.party, name: p.name, seats: p.seats, nominal: p.nominal, label: p.label, totalCalc: p.nominal + (p.label ?? 0) })) ?? [],
    candidates: v?.candidates ?? [],
  };
}

/** "1º suplente", "2º suplente": the TSE's vs[].tp codes. */
export const alternateRole = (role: string) => (role === "s1" ? "1º suplente" : role === "s2" ? "2º suplente" : role);

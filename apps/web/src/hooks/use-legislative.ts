"use client";

import type { LegislativeBrView, LegislativeOffice, LegislativeUfView } from "@apuracao/contracts";
import { UFS } from "@apuracao/tse/codes";
import { hemicycleGroups, senateClosest, SHARE_BREAKS, topVoted, ufBenches, type Group, type SenateClose, type TopVoted } from "@/data/chambers";
import { partyKey } from "@/lib/party";
import { areaName } from "@/lib/places";
import { partyToken } from "@/map/style";
import { benchCell, partyShareCell, senateCell, SHARE_LEGEND, ufListSummary, type LegendItem } from "@/map/uf-style";
import { useLegislativeBr, useLegislativeUf, useLegislativeUfs, type ViewState } from "./use-data";
import { buildUfMap, geometryState, useMapGeometry, type UfMapState } from "./use-uf-map";
import { useCargo, useChamberMapMode, useFocusParty, type Cargo } from "./use-url-state";

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

export const CHAMBERS: Record<Exclude<Cargo, "presidente" | "governador">, Chamber> = {
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
  return cargo === "presidente" || cargo === "governador" ? null : CHAMBERS[cargo];
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

// --- Maps, the hemicycle and the highlights (TASK-visual-pass-2.md §2.4) -----------------

const BY_STATE_NOTE = "Por estado: para estes cargos guardamos o arquivo de cada estado, não o de cada município.";

/** The senate map: each UF in its two elected's parties. */
export function useSenateMap(): UfMapState {
  const geometry = useMapGeometry();
  const views = useLegislativeUfs("senate", UFS);
  const waiting = geometryState(geometry);
  if (waiting) return waiting;
  const cells = Object.fromEntries(UFS.map((uf, i) => [uf, senateCell(uf, views[i]!.data)]));
  const parties = new Map<string, number>();
  for (const v of views) for (const c of v.data?.candidates ?? []) if (c.elected) parties.set(c.party, (parties.get(c.party) ?? 0) + 1);
  const legend: LegendItem[] = [...parties]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([party, seats]) => ({ token: partyToken(partyKey(party), 4), label: `${party} ${seats}` }));
  return {
    kind: "ready",
    model: buildUfMap(geometry.data!, cells, {
      legend,
      note: `Cada estado nas cores dos partidos dos dois eleitos; número: senadores eleitos pelo partido (contagem nossa). ${BY_STATE_NOTE}`,
      summary: ufListSummary("Senado, eleitos por estado", Object.values(cells)),
    }),
  };
}

export interface ChamberMap {
  state: UfMapState;
  mode: "bancada" | "partido";
  setMode(mode: "bancada" | "partido"): void;
  /** The party the "Um partido" map shows. */
  party: string | null;
  setParty(party: string): void;
  /** Parties with seats, most first: the picker's options. */
  parties: string[];
}

export function useChamberMap(office: LegislativeOffice): ChamberMap {
  const geometry = useMapGeometry();
  const br = useLegislativeBr(office);
  const [mode, setMode] = useChamberMapMode();
  const [requested, setParty] = useFocusParty();
  const parties = br.data?.parties.map((p) => p.party) ?? [];
  const party = requested && parties.includes(requested) ? requested : (parties[0] ?? null);
  const base = { mode, setMode, party, setParty: (p: string) => setParty(p), parties };

  const waiting = geometryState(geometry);
  if (waiting) return { ...base, state: waiting };
  if (!br.data) {
    return {
      ...base,
      state: br.error ? { kind: "error", message: "Os dados do mapa não carregaram.", retry: () => undefined } : { kind: "loading" },
    };
  }
  const benches = ufBenches(br.data);
  const cells = Object.fromEntries(
    benches.map((b) => [b.uf, mode === "partido" && party ? partyShareCell(b, party) : benchCell(b)]),
  );
  let legend: LegendItem[];
  let note: string;
  if (mode === "partido" && party) {
    const key = partyKey(party);
    legend = [
      { token: "empty", label: "nenhum eleito" },
      ...SHARE_LEGEND.map((label, i) => ({ token: partyToken(key, (i + 1) as 1 | 2 | 3 | 4), label })),
    ];
    note = `${party}: eleitos sobre as vagas de cada estado (calculado; ${SHARE_BREAKS.map((b) => `${b * 100}%`).join(", ")}). ${BY_STATE_NOTE}`;
  } else {
    const n = new Map<string, number>();
    for (const b of benches) if (b.largest.length === 1) n.set(b.largest[0]!, (n.get(b.largest[0]!) ?? 0) + 1);
    legend = [...n]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
      .map(([p, k]) => ({ token: partyToken(partyKey(p), 4), label: `${p} ${k}` }));
    if (benches.some((b) => b.largest.length === 2)) legend.push({ token: "party-other-4", split: "none", label: "empate entre dois partidos (as duas cores)" });
    if (benches.some((b) => b.largest.length > 2)) legend.push({ token: "tie", label: "empate entre três ou mais" });
    note = `Cada estado na cor do partido com mais eleitos; número: estados em que é a maior bancada (contagem nossa). ${BY_STATE_NOTE}`;
  }
  return {
    ...base,
    state: {
      kind: "ready",
      model: buildUfMap(geometry.data!, cells, {
        legend,
        note,
        summary: ufListSummary(mode === "partido" && party ? `${party}, eleitos por estado` : "Maior bancada por estado", Object.values(cells)),
      }),
    },
  };
}

export interface Hemicycle {
  groups: Group[];
  total: number;
}

/** Palette parties in seat order, the rest as "Outros". */
export function useHemicycle(office: LegislativeOffice): Hemicycle | null {
  const { view, bars } = useNationalSeats(office);
  if (!view.data) return null;
  const groups = hemicycleGroups(bars);
  return { groups, total: groups.reduce((t, g) => t + g.seats, 0) };
}

export function useTopVoted(office: LegislativeOffice, n = 10): { rows: TopVoted[]; complete: boolean; loading: boolean } {
  const views = useLegislativeUfs(office, UFS);
  const data = views.map((v) => v.data);
  return { rows: topVoted(data, n), complete: data.every((d) => d !== undefined), loading: views.some((v) => v.isLoading) };
}

export function useSenateClosest(n = 5): { rows: SenateClose[]; loading: boolean } {
  const views = useLegislativeUfs("senate", UFS);
  return { rows: senateClosest(views.map((v) => v.data)).slice(0, n), loading: views.some((v) => v.isLoading) };
}

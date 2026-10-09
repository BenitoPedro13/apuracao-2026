"use client";

import { UFS } from "@apuracao/tse/codes";
import { closestRaces, governorRace, governorSummary, isRunoff, type GovernorRace, type GovernorSummary } from "@/data/governors";
import { formatInt } from "@/lib/format";
import { partyKey } from "@/lib/party";
import { partyToken } from "@/map/style";
import { governorCell, municipalOverlay, ufListSummary, type LegendItem, type UfCell } from "@/map/uf-style";
import { useManifest, useMunicipalities, useResults } from "./use-data";
import { buildUfMap, geometryState, useMapGeometry, type UfMapState } from "./use-uf-map";
import { useSelectedUf } from "./use-url-state";

// Governadores (TASK-visual-pass-2.md §2.3): the rules once, the components render.

export interface GovernorRaces {
  races: GovernorRace[];
  summary: GovernorSummary;
  closest: GovernorRace[];
  /** The 2nd-round state election ("Eleito" instead of "Eleito no 1º turno"). */
  runoff: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useGovernorRaces(): GovernorRaces {
  const results = useResults("governor", UFS);
  const races = UFS.map((uf, i) => governorRace(uf, results[i]!.data, results[i]!.absent));
  return {
    races,
    summary: governorSummary(races),
    closest: closestRaces(races),
    runoff: isRunoff(results.find((r) => r.data)?.data),
    isLoading: results.some((r) => r.isLoading),
    error: results.find((r) => r.error && !r.data)?.error ?? null,
  };
}

/** The UF the right column shows: the selected one if it has a race, else the closest race. */
export function useGovernorFocus(races: GovernorRaces): { uf: string | null; isDefault: boolean } {
  const [selected] = useSelectedUf();
  const race = races.races.find((r) => r.uf === selected && r.outcome !== "sem-disputa");
  if (race) return { uf: race.uf, isDefault: false };
  return { uf: races.closest[0]?.uf ?? null, isDefault: true };
}

export function useGovernorMap(): UfMapState {
  const geometry = useMapGeometry();
  const g = useGovernorRaces();
  const [selected] = useSelectedUf();
  const manifest = useManifest();
  const overlayUf = g.races.some((r) => r.uf === selected && r.outcome !== "sem-disputa") ? selected : null;
  const municipalities = useMunicipalities("governor", overlayUf);
  const waiting = geometryState(geometry);
  if (waiting) return waiting;
  const geo = geometry.data!;

  const cells: Record<string, UfCell> = {};
  for (const r of g.races) cells[r.uf] = governorCell(r, g.runoff);

  const leads = new Map<string, number>();
  for (const r of g.races) if (r.first) leads.set(r.first.party, (leads.get(r.first.party) ?? 0) + 1);
  const legend: LegendItem[] = [...leads]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))
    .map(([party, n]) => ({ token: partyToken(partyKey(party), 4), label: `${party} ${n}` }));
  if (g.races.some((r) => r.outcome === "sem-disputa")) legend.push({ token: "none", label: "Sem 2º turno neste estado" });
  if (g.races.some((r) => !r.first && r.outcome !== "sem-disputa")) legend.push({ token: "waiting", label: "Aguardando dados do TSE" });

  const overlay = overlayUf && municipalities.data ? municipalOverlay(geo, municipalities.data) : null;
  const notes = [
    g.runoff ? "Cor forte: eleito; clara: ainda apurando." : "Cor forte: eleito no 1º turno; clara: vai ao 2º turno.",
    "Número: estados em que o partido lidera (contagem nossa).",
  ];
  if (overlay) notes.push(`Em ${cells[overlay.uf] ? overlayUf!.toUpperCase() : ""}, cada município na cor de quem lidera; intensidade pela vantagem: até 10, 10–25, 25–45 e mais de 45 pontos (calculada).`);

  return {
    kind: "ready",
    model: buildUfMap(geo, cells, {
      legend,
      note: notes.join(" "),
      summary: ufListSummary(`Mapa de governador por estado, ${formatInt(g.summary.races)} disputas`, Object.values(cells)),
      overlay,
      overlayKey: overlayUf ? (manifest.data?.views[`municipalities/governor/${overlayUf}`] ?? "") : "",
    }),
  };
}

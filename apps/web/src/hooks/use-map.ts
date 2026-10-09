"use client";

import { useQuery } from "@tanstack/react-query";
import { RESULT_STATUS_CODE, type MapIndexView, type MapView, type ResultStatus, type TsePct } from "@apuracao/contracts";
import { ABROAD, UFS } from "@apuracao/tse/codes";
import { byVotes, difference, hasNumbers } from "@/data/rules";
import { displayName, formatInt } from "@/lib/format";
import { areaName } from "@/lib/places";
import type { Geometry } from "@/map/geometry";
import { geometryQuery } from "@/map/queries";
import { leaderCounts, styleFrame, tieCount, type MapMode, type MapStyle, type UfLeader } from "@/map/style";
import { useMapFrame, useMapIndex, useManifest, useResult, useResults } from "./use-data";

// The map's business rules in one place (global frontend rules): which colour, which
// label, what the legend counts and what a municipality's card says. Components render.

const STATUS_BY_CODE = Object.fromEntries(Object.entries(RESULT_STATUS_CODE).map(([k, v]) => [v, k])) as Record<
  number,
  ResultStatus
>;

export interface Leader {
  name: string;
  party: string;
  n: string;
}

export interface UfSummary {
  uf: string;
  name: string;
  status: ResultStatus | undefined;
  /** With its TSE percentage string; null without numbers. */
  leader: (Leader & { pct: TsePct }) | null;
  /** Ours: (first − second) / validWithSubJudice, basis points. */
  marginBp: number | null;
  countedPct: TsePct | null;
}

export interface MunicipalityInfo {
  i: number;
  cdi: string;
  name: string;
  uf: string;
  ufName: string;
  status: ResultStatus;
  leader: Leader | null;
  tie: boolean;
  marginBp: number | null;
  countedBp: number | null;
}

export interface MapModel {
  geo: Geometry;
  frame: MapView;
  style: MapStyle;
  /** Changes exactly when the colours do: the renderer skips a redundant restyle. */
  styleKey: string;
  ufs: UfSummary[];
  exterior: UfSummary | null;
  leaders: (Leader & { count: number })[];
  ties: number;
  /** Municipalities fully counted (100% of sections). */
  fullyCounted: number;
  /** One sentence for the canvas's accessible name. */
  summary: string;
  describe(i: number): MunicipalityInfo;
}

export type MapState =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: () => void }
  | { kind: "ready"; model: MapModel };

export function useGeometry() {
  return useQuery(geometryQuery());
}

function ufSummary(area: string, view: ReturnType<typeof useResults>[number]["data"]): UfSummary {
  const ranked = view && hasNumbers(view) ? byVotes(view.candidates) : null;
  const [first, second] = ranked ?? [];
  const lead = first && first.votes > 0 ? first : undefined;
  return {
    uf: area,
    name: areaName(area),
    status: view?.status,
    leader: lead ? { name: lead.name, party: lead.party, n: lead.n, pct: lead.pct } : null,
    marginBp: lead && second && view?.votes ? (difference(lead, second, view.votes.validWithSubJudice)?.bp ?? null) : null,
    countedPct: view?.sections?.countedPct ?? null,
  };
}

export function useMapModel(mode: MapMode): MapState {
  const geometry = useGeometry();
  const frame = useMapFrame();
  const index = useMapIndex();
  const manifest = useManifest();
  const results = useResults("president", UFS);
  const zz = useResult("president", ABROAD);

  const error = geometry.error ?? frame.error ?? index.error;
  if (error && !(geometry.data && frame.data && index.data)) {
    return {
      kind: "error",
      message: geometry.error ? "O mapa não carregou." : "Os dados do mapa não carregaram.",
      retry: () => void (geometry.error ? geometry.refetch() : manifest.refetch()),
    };
  }
  if (frame.absent || index.absent) return { kind: "error", message: "Esta apuração ainda não tem mapa.", retry: () => void manifest.refetch() };
  if (!geometry.data || !frame.data || !index.data) return { kind: "loading" };

  const geo = geometry.data;
  const f = frame.data;
  const mismatch = alignment(geo, f, index.data);
  if (mismatch) {
    console.error(`map: ${mismatch}`);
    return { kind: "error", message: "O mapa e os dados não correspondem.", retry: () => void manifest.refetch() };
  }

  const ufs = UFS.map((uf, i) => ufSummary(uf, results[i]!.data));
  const ufLeaders: Record<string, UfLeader | null> = {};
  for (const u of ufs) ufLeaders[u.uf] = u.leader && u.marginBp !== null ? { party: u.leader.party, marginBp: u.marginBp } : null;
  const style = styleFrame(mode, f, geo.ufs, ufLeaders);
  const frameSha = manifest.data?.views["map/president"] ?? "";
  const styleKey = `${mode}|${frameSha}|${mode === "estados" ? JSON.stringify(ufLeaders) : ""}`;

  const leaders = leaderCounts(f).map((l) => ({ ...l, name: displayName(l.name) }));
  const ties = tieCount(f);
  const fullyCounted = f.countedBp.filter((bp) => bp === 10_000).length;
  const names = index.data.name;

  return {
    kind: "ready",
    model: {
      geo,
      frame: f,
      style,
      styleKey,
      ufs,
      exterior: zz.data ? ufSummary(ABROAD, zz.data) : null,
      leaders,
      ties,
      fullyCounted,
      summary: summarize(mode, leaders, ties, fullyCounted, f.count),
      describe: (i) => {
        const leader = f.leader[i]!;
        const c = leader >= 0 ? f.candidates[leader] : undefined;
        const margin = f.marginBpCalc[i] ?? null;
        return {
          i,
          cdi: geo.ids[i]!,
          name: names[i]!,
          uf: geo.ufs[i]!,
          ufName: areaName(geo.ufs[i]!),
          status: STATUS_BY_CODE[f.status[i]!] ?? "not_published",
          leader: c ? { name: displayName(c.name), party: c.party, n: c.n } : null,
          tie: leader === -1 && margin === 0,
          marginBp: margin,
          countedBp: f.countedBp[i] ?? null,
        };
      },
    },
  };
}

/** Why the frame can't be drawn on this geometry, or null when it can. */
export function alignment(geo: Geometry, frame: MapView, index: MapIndexView): string | null {
  if (frame.index !== geo.index) return `frame index ${frame.index} ≠ geometry index ${geo.index}`;
  if (frame.count !== geo.count || frame.leader.length !== geo.count) return `frame has ${frame.count} municipalities, geometry ${geo.count}`;
  if (index.cdi.length !== geo.count) return `map-index has ${index.cdi.length} municipalities, geometry ${geo.count}`;
  return null;
}

function summarize(mode: MapMode, leaders: MapModel["leaders"], ties: number, fullyCounted: number, total: number): string {
  if (mode === "apurado") return `Mapa por município, seções apuradas: 100% em ${formatInt(fullyCounted)} de ${formatInt(total)} municípios.`;
  if (leaders.length === 0) return "Mapa por município: nenhum município com votos apurados ainda.";
  const parts = leaders.map((l) => `${l.name} (${l.party}) lidera em ${formatInt(l.count)}`);
  if (ties) parts.push(`${ties} ${ties === 1 ? "empate" : "empates"}`);
  return `Mapa por município: ${parts.join(", ")} de ${formatInt(total)} municípios.`;
}

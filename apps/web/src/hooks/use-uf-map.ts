"use client";

import { useQuery } from "@tanstack/react-query";
import type { MapStyle } from "@/map/style";
import type { Geometry } from "@/map/geometry";
import { geometryQuery } from "@/map/queries";
import { styleCells, type LegendItem, type Overlay, type UfCell } from "@/map/uf-style";

// The per-UF maps' shared model (TASK-visual-pass-2.md §2.2). The office hooks build the
// cells; this turns them into what UfMapStage draws.

export interface UfMapModel {
  geo: Geometry;
  style: MapStyle;
  /** Changes exactly when the colours do. */
  styleKey: string;
  cells: Record<string, UfCell>;
  legend: LegendItem[];
  /** One sentence under the legend: what the intensity means, where the data stops. */
  note: string | null;
  /** For the canvas's accessible name. */
  summary: string;
  overlay: Overlay | null;
}

export type UfMapState = { kind: "loading" } | { kind: "error"; message: string; retry: () => void } | { kind: "ready"; model: UfMapModel };

export function useMapGeometry() {
  return useQuery(geometryQuery());
}

export function buildUfMap(
  geo: Geometry,
  cells: Record<string, UfCell>,
  extra: { legend: LegendItem[]; note: string | null; summary: string; overlay?: Overlay | null; overlayKey?: string },
): UfMapModel {
  const overlay = extra.overlay ?? null;
  const style = styleCells(geo, cells, overlay);
  const styleKey = `${Object.values(cells)
    .map((c) => `${c.uf}:${c.token}:${c.split ?? ""}`)
    .join(",")}|${overlay ? `${overlay.uf}:${extra.overlayKey ?? ""}` : ""}`;
  return { geo, style, styleKey, cells, legend: extra.legend, note: extra.note, summary: extra.summary, overlay };
}

/** The geometry's own loading and error states, before any office data is needed. */
export function geometryState(geometry: ReturnType<typeof useMapGeometry>): UfMapState | null {
  if (geometry.error && !geometry.data) return { kind: "error", message: "O mapa não carregou.", retry: () => void geometry.refetch() };
  if (!geometry.data) return { kind: "loading" };
  return null;
}

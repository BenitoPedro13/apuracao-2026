"use client";

import { RotateCw } from "lucide-react";
import { UFS } from "@apuracao/tse/codes";
import { Button } from "@/components/ui/button";
import { useMapModel } from "@/hooks/use-map";
import { setUrlParams, useMapMode, useSelectedUf } from "@/hooks/use-url-state";
import { areaName } from "@/lib/places";
import { MAP_MODE_LABEL, MAP_MODES } from "@/map/style";
import { MapLegend } from "./map-legend";
import { MapSkeleton } from "./map-skeleton";
import { MapStage } from "./map-stage";

// The map panel (TASK-map.md): mode, "go to a state", legend, the map, and its states.
// Loaded lazily (map-section.tsx), so none of this is in the first load.

const BY_NAME = [...UFS].sort((a, b) => areaName(a).localeCompare(areaName(b), "pt-BR"));

export default function MapPanel() {
  const [mode, setMode] = useMapMode();
  const [selectedUf] = useSelectedUf();
  const state = useMapModel(mode);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="O que o mapa mostra" className="flex rounded-md border border-line p-0.5">
          {MAP_MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="h-7 rounded-[5px] px-2.5 text-sm text-ink-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none aria-pressed:bg-ink aria-pressed:text-paper"
            >
              {MAP_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-2">Ir para o estado</span>
          <select
            value={selectedUf && (UFS as readonly string[]).includes(selectedUf) ? selectedUf : ""}
            onChange={(e) => setUrlParams({ uf: e.target.value || null, mun: null })}
            className="h-8 rounded-md border border-line bg-panel px-2 text-sm focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
          >
            <option value="">Brasil</option>
            {BY_NAME.map((uf) => (
              <option key={uf} value={uf}>
                {areaName(uf)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.kind === "ready" && <MapLegend model={state.model} mode={mode} />}

      <a href="#estados" className="sr-only focus:not-sr-only focus:self-start focus:rounded-sm focus:underline">
        Pular o mapa
      </a>
      {state.kind === "loading" && <MapSkeleton />}
      {state.kind === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line p-6 text-sm">
          <p>
            {state.message} Os mesmos resultados estão nas tabelas{" "}
            <a href="#estados" className="underline underline-offset-4">
              por estado
            </a>{" "}
            e{" "}
            <a href="#municipios" className="underline underline-offset-4">
              por município
            </a>
            .
          </p>
          <Button variant="outline" size="sm" onClick={state.retry}>
            <RotateCw aria-hidden />
            Tentar de novo
          </Button>
        </div>
      )}
      {state.kind === "ready" && <MapStage model={state.model} mode={mode} />}
    </div>
  );
}

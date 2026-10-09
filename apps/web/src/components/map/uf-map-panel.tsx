"use client";

import { RotateCw } from "lucide-react";
import type { LegislativeOffice } from "@apuracao/contracts";
import { Button } from "@/components/ui/button";
import { useGovernorMap } from "@/hooks/use-governors";
import { useChamberMap, useSenateMap } from "@/hooks/use-legislative";
import type { UfMapState } from "@/hooks/use-uf-map";
import { UfLegend } from "./map-legend";
import { MapSkeleton } from "./map-skeleton";
import { UfMapStage } from "./uf-map-stage";

// The per-UF map panels (TASK-visual-pass-2.md §2.3–2.4). Loaded lazily with the map's
// chunk (uf-map-section.tsx); each office's hook builds the model.

export type UfMapKind = "governor" | "senate" | Exclude<LegislativeOffice, "senate">;

export default function UfMapPanel({ kind, tableId }: { kind: UfMapKind; tableId: string }) {
  if (kind === "governor") return <GovernorMap tableId={tableId} />;
  if (kind === "senate") return <SenateMap tableId={tableId} />;
  return <ChamberMap office={kind} tableId={tableId} />;
}

function GovernorMap({ tableId }: { tableId: string }) {
  return <Body state={useGovernorMap()} tableId={tableId} />;
}

function SenateMap({ tableId }: { tableId: string }) {
  return <Body state={useSenateMap()} tableId={tableId} />;
}

function ChamberMap({ office, tableId }: { office: LegislativeOffice; tableId: string }) {
  const m = useChamberMap(office);
  return (
    <Body
      state={m.state}
      tableId={tableId}
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="O que o mapa mostra" className="flex rounded-md border border-line p-0.5">
            {(["bancada", "partido"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={m.mode === mode}
                onClick={() => m.setMode(mode)}
                className="h-7 rounded-[5px] px-2.5 text-sm text-ink-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none aria-pressed:bg-ink aria-pressed:text-paper"
              >
                {mode === "bancada" ? "Maior bancada" : "Um partido"}
              </button>
            ))}
          </div>
          {m.mode === "partido" && m.parties.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-2">Partido</span>
              <select
                value={m.party ?? ""}
                onChange={(e) => m.setParty(e.target.value)}
                className="h-8 rounded-md border border-line bg-panel px-2 text-sm focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
              >
                {m.parties.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      }
    />
  );
}

function Body({ state, tableId, controls }: { state: UfMapState; tableId: string; controls?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {controls}
      {state.kind === "ready" && <UfLegend items={state.model.legend} note={state.model.note} />}
      <a href={`#${tableId}`} className="sr-only focus:not-sr-only focus:self-start focus:rounded-sm focus:underline">
        Pular o mapa
      </a>
      {state.kind === "loading" && <MapSkeleton />}
      {state.kind === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line p-6 text-sm">
          <p>
            {state.message} Os mesmos resultados estão na{" "}
            <a href={`#${tableId}`} className="underline underline-offset-4">
              tabela por estado
            </a>
            .
          </p>
          <Button variant="outline" size="sm" onClick={state.retry}>
            <RotateCw aria-hidden />
            Tentar de novo
          </Button>
        </div>
      )}
      {state.kind === "ready" && <UfMapStage model={state.model} />}
    </div>
  );
}

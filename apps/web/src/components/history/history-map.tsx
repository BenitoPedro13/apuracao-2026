"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverStore, useHover, useMapRenderer } from "@/hooks/use-map-renderer";
import type { HistoryModel } from "@/hooks/use-history";
import { WIDTH, type Geometry } from "@/map/geometry";
import { geometryQuery } from "@/map/queries";
import type { FillToken, MapStyle } from "@/map/style";

// A municipality map for the archive (TASK-historical-presidential.md §2.3): the live map's
// renderer and geometry, coloured by a token per municipality. A municipality with no
// numbers in that election is `absent` (hatched), never a colour (invariant 6).

// Written out in full: the CSS build keeps only the custom properties the sources name.
const SWATCH: Partial<Record<FillToken, string>> = {
  "pt-1": "var(--map-pt-1)",
  "pt-2": "var(--map-pt-2)",
  "pt-3": "var(--map-pt-3)",
  "pt-4": "var(--map-pt-4)",
  "pl-1": "var(--map-pl-1)",
  "pl-2": "var(--map-pl-2)",
  "pl-3": "var(--map-pl-3)",
  "pl-4": "var(--map-pl-4)",
  "other-1": "var(--map-other-1)",
  "other-2": "var(--map-other-2)",
  "other-3": "var(--map-other-3)",
  "other-4": "var(--map-other-4)",
  "counted-1": "var(--map-counted-1)",
  "counted-2": "var(--map-counted-2)",
  "counted-3": "var(--map-counted-3)",
  "counted-4": "var(--map-counted-4)",
  "counted-5": "var(--map-counted-5)",
};

export interface LegendItem {
  token: FillToken;
  label: string;
}

export function HistoryMap({
  m,
  tokenOf,
  styleKey,
  describe,
  legend,
  summary,
}: {
  m: HistoryModel;
  /** Token for a municipality (index into the history), or null: absent. */
  tokenOf: (i: number) => FillToken | null;
  /** Changes exactly when the colours do. */
  styleKey: string;
  describe: (i: number) => string;
  legend: LegendItem[];
  /** What the map shows, for screen readers (the panel's table has the numbers). */
  summary: string;
}) {
  const geo = useQuery(geometryQuery());
  if (!geo.data) return <Skeleton className="aspect-square w-full" aria-label="Carregando o mapa" />;
  return <Stage geo={geo.data} m={m} tokenOf={tokenOf} styleKey={styleKey} describe={describe} legend={legend} summary={summary} />;
}

function Stage({ geo, m, tokenOf, styleKey, describe, legend, summary }: { geo: Geometry } & Parameters<typeof HistoryMap>[0]) {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => new HoverStore());
  const [zoomed, setZoomed] = useState(false);

  // geometry index → history index (the mesh has one municipality the archive never saw)
  const hist = geo.ids.map((id) => m.indexOf(id));
  const tokens: FillToken[] = hist.map((h) => (h < 0 ? "absent" : (tokenOf(h) ?? "absent")));
  const buckets = new Map<FillToken, number[]>();
  tokens.forEach((t, i) => {
    const b = buckets.get(t);
    if (b) b.push(i);
    else buckets.set(t, [i]);
  });
  const style: MapStyle = { buckets, failed: [], tokenOf: tokens };

  const controls = useMapRenderer(
    { box, base, over },
    geo,
    { style, styleKey, selectedUf: null },
    {
      onHover(i, clientX, clientY) {
        const r = box.current?.getBoundingClientRect();
        if (r)
          store.set({
            i,
            x: clientX - r.left,
            y: clientY - r.top,
            pinned: false,
          });
      },
      onPick(i) {
        const r = store.get();
        store.set({ ...r, i, pinned: true });
      },
      onTransform(t) {
        setZoomed(t.k > 1.001);
      },
      onHint() {},
    },
    false,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="@container">
        <div
          ref={box}
          className="map-box relative w-full overflow-hidden"
          style={{
            ["--map-aspect" as string]: String(geo.height / WIDTH),
            ["--map-gutter" as string]: "0px",
          }}
        >
          <p className="sr-only">{summary}</p>
          <canvas ref={base} aria-hidden className="absolute inset-0 size-full" />
          <canvas ref={over} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
          <div className="absolute bottom-2 left-2 flex flex-col gap-1">
            <Button variant="outline" size="icon" aria-label="Ampliar o mapa" onClick={() => controls.zoomBy(2)}>
              <Plus aria-hidden />
            </Button>
            <Button variant="outline" size="icon" aria-label="Reduzir o mapa" onClick={() => controls.zoomBy(0.5)} disabled={!zoomed}>
              <Minus aria-hidden />
            </Button>
            {zoomed && (
              <Button variant="outline" size="sm" onClick={() => controls.reset()}>
                <RotateCcw aria-hidden />
                Brasil
              </Button>
            )}
          </div>
          <Tip store={store} hist={hist} describe={describe} />
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legenda">
        {legend.map((l) => (
          <li key={l.token} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={l.token === "absent" ? "legend-absent size-3.5 rounded-sm border" : "size-3.5 rounded-sm border"}
              style={l.token === "absent" ? undefined : { background: SWATCH[l.token] }}
            />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The hovered municipality's line; re-renders alone at pointer speed. */
function Tip({ store, hist, describe }: { store: HoverStore; hist: number[]; describe: (i: number) => string }) {
  const h = useHover(store);
  if (h.i === null) return null;
  const i = hist[h.i]!;
  return (
    <div
      role={h.pinned ? "status" : undefined}
      className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-pre-line shadow-sm"
      style={{
        left: h.x,
        top: h.y + 16,
        transform: h.x > 220 ? "translateX(-100%)" : undefined,
      }}
    >
      {i < 0 ? "Sem dados do TSE: não era município nessas eleições" : describe(i)}
    </div>
  );
}

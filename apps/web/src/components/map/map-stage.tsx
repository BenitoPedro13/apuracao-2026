"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Minus, Plus, RotateCcw } from "lucide-react";
import { ABROAD } from "@apuracao/tse/codes";
import { Button } from "@/components/ui/button";
import type { MapModel, UfSummary } from "@/hooks/use-map";
import { CALLOUT_GUTTER_PX, HoverStore, NARROW_PX, useMapRenderer } from "@/hooks/use-map-renderer";
import { setUrlParams, useSelectedUf, useShowExterior } from "@/hooks/use-url-state";
import { partyColor } from "@/lib/party";
import { cn } from "@/lib/utils";
import { WIDTH } from "@/map/geometry";
import type { Fit } from "@/map/renderer";
import type { MapMode } from "@/map/style";
import { anchorOf, CALLOUT_GAP_PX, CALLOUTS, placeCallouts } from "./callouts";
import { MapTooltip } from "./map-tooltip";

// The map itself (TASK-map.md §2.4): canvas, state labels, the small states' call-outs,
// zoom buttons, the gesture hint and the municipality card.

const HINT_MS = 1500;

function labelValue(u: UfSummary, mode: MapMode): string {
  if (u.status === undefined) return ""; // still loading: no value yet, not "no data"
  if (mode === "apurado") return u.countedPct ? `${u.countedPct.raw}%` : "—";
  return u.leader ? `${u.leader.party} ${u.leader.pct.raw}%` : "—";
}

function labelColor(u: UfSummary, mode: MapMode): string | undefined {
  return mode !== "apurado" && u.leader ? partyColor(u.leader.party) : undefined;
}

export function MapStage({ model, mode }: { model: MapModel; mode: MapMode }) {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [store] = useState(() => new HoverStore());
  const [fit, setFit] = useState<Fit | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [selectedUf] = useSelectedUf();
  const [showExterior] = useShowExterior();

  const controls = useMapRenderer({ box, base, over }, model.geo, { style: model.style, styleKey: model.styleKey, selectedUf }, {
    onHover(i, clientX, clientY) {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      store.set({ i, x: clientX - r.left, y: clientY - r.top, pinned: false });
    },
    onPick(i, touch) {
      const info = model.describe(i);
      setUrlParams({ uf: info.uf, mun: info.cdi });
      if (touch) store.set({ ...store.get(), i, pinned: true });
    },
    onTransform(t, f) {
      const el = layer.current;
      if (el) {
        el.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
        el.style.setProperty("--k", String(t.k));
      }
      setFit((prev) => (prev && prev.s === f.s && prev.ox === f.ox && prev.oy === f.oy && prev.width === f.width ? prev : f));
      setZoomed(t.k > 1.001);
      if (!store.get().pinned) store.set({ i: null, x: 0, y: 0, pinned: false });
    },
    onHint(kind) {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      setHint(
        kind === "wheel"
          ? `Use ${mac ? "⌘" : "Ctrl"} + rolagem para ampliar o mapa`
          : "Toque num município para ampliar o estado",
      );
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
    },
  });

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const narrow = fit !== null && fit.width < NARROW_PX;
  const showCallouts = fit !== null && !narrow && !zoomed;
  const at = (uf: string) => anchorOf(model.geo, fit, uf);
  const compact = fit !== null && fit.width < 640;
  const pick = (uf: string) => setUrlParams({ uf, mun: null });
  const closeCard = () => store.set({ i: null, x: 0, y: 0, pinned: false });

  const callouts = showCallouts
    ? placeCallouts(model.geo, fit, (uf) => model.ufs.some((x) => x.uf === uf)).map((c) => ({ ...c, u: model.ufs.find((x) => x.uf === c.uf)! }))
    : [];
  const calloutX = fit ? fit.width - CALLOUT_GUTTER_PX + 10 : 0;
  const exterior = showExterior ? model.exterior : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="@container">
        <div
          ref={box}
          className="map-box relative w-full overflow-hidden"
          style={{ ["--map-aspect" as string]: String(model.geo.height / WIDTH) }}
        >
          {/* The canvas is a picture of the tables below; screen readers get its summary. */}
          <p className="sr-only">{model.summary}</p>
          <canvas ref={base} aria-hidden className="absolute inset-0 size-full" />
          <canvas ref={over} aria-hidden className="pointer-events-none absolute inset-0 size-full" />

          {/* State labels: real text over the canvas, moved with the zoom, never scaled. */}
          <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 origin-top-left">
            {fit &&
              model.ufs.map((u) => {
                if (CALLOUTS.includes(u.uf) && !zoomed) return null;
                const a = at(u.uf);
                if (!a) return null;
                return (
                  <button
                    key={u.uf}
                    type="button"
                    tabIndex={-1}
                    onClick={() => pick(u.uf)}
                    className={cn(
                      "map-label pointer-events-auto absolute flex flex-col items-center rounded leading-none",
                      selectedUf === u.uf && "map-label-selected",
                    )}
                    style={{ left: a[0], top: a[1] }}
                  >
                    <span className="text-[11px] font-bold tracking-wide">{u.uf.toUpperCase()}</span>
                    {!compact && labelValue(u, mode) && (
                      <span className="mt-0.5 font-mono text-[10px] whitespace-nowrap">{labelValue(u, mode)}</span>
                    )}
                  </button>
                );
              })}
          </div>

          {showCallouts && (
            <>
              <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
                {callouts.map(({ u, y, anchor }) => (
                  <polyline
                    key={u.uf}
                    points={`${anchor[0]},${anchor[1]} ${calloutX - 8},${y} ${calloutX},${y}`}
                    fill="none"
                    className="stroke-ink-2"
                    strokeWidth={0.75}
                  />
                ))}
              </svg>
              {callouts.map(({ u, y }) => (
                <Chip key={u.uf} u={u} mode={mode} selected={selectedUf === u.uf} onClick={() => pick(u.uf)} style={{ left: calloutX, top: y }} />
              ))}
              {exterior && (
                <Chip
                  u={exterior}
                  mode={mode}
                  selected={selectedUf === ABROAD}
                  onClick={() => pick(ABROAD)}
                  style={{ left: calloutX, top: (callouts.at(-1)?.y ?? 0) + CALLOUT_GAP_PX * 1.6 }}
                />
              )}
            </>
          )}

          <div className="absolute bottom-2 left-2 flex flex-col gap-1">
            <Button variant="outline" size="icon" aria-label="Ampliar o mapa" onClick={() => controls.zoomBy(2)}>
              <Plus aria-hidden />
            </Button>
            <Button variant="outline" size="icon" aria-label="Reduzir o mapa" onClick={() => controls.zoomBy(0.5)} disabled={!zoomed}>
              <Minus aria-hidden />
            </Button>
            {zoomed && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUrlParams({ uf: null, mun: null });
                  controls.reset();
                }}
              >
                <RotateCcw aria-hidden />
                Brasil
              </Button>
            )}
          </div>

          <p
            aria-live="polite"
            className={cn(
              "pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-ink/85 px-3 py-2 text-sm text-paper transition-opacity",
              hint ? "opacity-100" : "opacity-0",
            )}
          >
            {hint}
          </p>

          {fit && <MapTooltip store={store} model={model} size={fit} onClose={closeCard} />}
        </div>
      </div>

      {narrow && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Estados pequenos">
          {[...CALLOUTS.map((uf) => model.ufs.find((u) => u.uf === uf)!).filter(Boolean), ...(exterior ? [exterior] : [])].map((u) => (
            <li key={u.uf}>
              <Chip u={u} mode={mode} selected={selectedUf === u.uf} onClick={() => pick(u.uf)} static />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A small state's (or Exterior's) chip: sigla, leader party and TSE %, selectable. */
function Chip({
  u,
  mode,
  selected,
  onClick,
  style,
  static: inFlow = false,
}: {
  u: UfSummary;
  mode: MapMode;
  selected: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
  static?: boolean;
}) {
  const value = labelValue(u, mode);
  return (
    <button
      type="button"
      tabIndex={inFlow ? 0 : -1}
      aria-hidden={inFlow ? undefined : true}
      aria-label={inFlow ? `${u.name}: ${value}` : undefined}
      onClick={onClick}
      className={cn(
        "map-chip flex h-6 items-center gap-1.5 rounded border border-line bg-panel pr-2 pl-2 text-[11px] leading-none whitespace-nowrap",
        !inFlow && "absolute -translate-y-1/2",
        selected && "border-ink",
      )}
      style={{ ...style, boxShadow: `inset 3px 0 0 ${labelColor(u, mode) ?? "var(--line)"}` }}
    >
      {u.uf === ABROAD ? (
        <Globe aria-hidden className="size-3.5" />
      ) : (
        <span className="font-bold tracking-wide">{u.uf.toUpperCase()}</span>
      )}
      <span className="font-mono">{value || "…"}</span>
    </button>
  );
}

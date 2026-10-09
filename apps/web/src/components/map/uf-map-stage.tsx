"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UfMapModel } from "@/hooks/use-uf-map";
import { CALLOUT_GUTTER_PX, HoverStore, NARROW_PX, useHover, useMapRenderer } from "@/hooks/use-map-renderer";
import { setUrlParams, useSelectedUf } from "@/hooks/use-url-state";
import { partyColor } from "@/lib/party";
import { areaName } from "@/lib/places";
import { cn } from "@/lib/utils";
import { WIDTH } from "@/map/geometry";
import type { Fit } from "@/map/renderer";
import type { FillToken } from "@/map/style";
import type { UfCell } from "@/map/uf-style";
import { anchorOf, CALLOUTS, placeCallouts } from "./callouts";
import { Swatch } from "./map-legend";

// A map whose unit is the UF (TASK-visual-pass-2.md §2.2): governor, senate, deputies.
// The same canvas renderer as the president's map; labels, call-outs and the card are
// drawn from the model's cells. Picking a UF selects it (?uf=), so the map is the picker.

const HINT_MS = 1500;

export function UfMapStage({ model }: { model: UfMapModel }) {
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
  const selected = selectedUf && model.cells[selectedUf] ? selectedUf : null;

  const pick = (uf: string) => setUrlParams({ uf, mun: null });
  const controls = useMapRenderer({ box, base, over }, model.geo, { style: model.style, styleKey: model.styleKey, selectedUf: selected, outline: model.overlay?.uf !== selected }, {
    onHover(i, clientX, clientY) {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      store.set({ i, x: clientX - r.left, y: clientY - r.top, pinned: false });
    },
    onPick(i, touch) {
      const uf = model.geo.ufs[i]!;
      // Inside the drawn state, a pick is a municipality: keep the state, show its card.
      if (model.overlay?.uf === uf && selected === uf) {
        if (touch) store.set({ ...store.get(), i, pinned: true });
        return;
      }
      pick(uf);
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
      setHint(kind === "wheel" ? `Use ${mac ? "⌘" : "Ctrl"} + rolagem para ampliar o mapa` : "Toque num estado para escolhê-lo");
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
    },
  });
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const narrow = fit !== null && fit.width < NARROW_PX;
  const compact = fit !== null && fit.width < 640;
  const showCallouts = fit !== null && !narrow && !zoomed;
  const callouts = showCallouts ? placeCallouts(model.geo, fit, (uf) => !!model.cells[uf]) : [];
  const calloutX = fit ? fit.width - CALLOUT_GUTTER_PX + 10 : 0;
  const cells = Object.values(model.cells);

  return (
    <div className="flex flex-col gap-2">
      <div className="@container">
        <div ref={box} className="map-box relative w-full overflow-hidden" style={{ ["--map-aspect" as string]: String(model.geo.height / WIDTH) }}>
          <p className="sr-only">{model.summary}</p>
          <canvas ref={base} aria-hidden className="absolute inset-0 size-full" />
          <canvas ref={over} aria-hidden className="pointer-events-none absolute inset-0 size-full" />

          <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 origin-top-left">
            {fit &&
              cells.map((c) => {
                if (CALLOUTS.includes(c.uf) && !zoomed) return null;
                // Inside the drawn state the municipalities speak for themselves.
                if (zoomed && model.overlay?.uf === c.uf) return null;
                const a = anchorOf(model.geo, fit, c.uf);
                if (!a) return null;
                return (
                  <button
                    key={c.uf}
                    type="button"
                    tabIndex={-1}
                    onClick={() => pick(c.uf)}
                    className={cn("map-label pointer-events-auto absolute flex flex-col items-center rounded leading-none", selected === c.uf && "map-label-selected")}
                    style={{ left: a[0], top: a[1] }}
                  >
                    <span className="text-[11px] font-bold tracking-wide">{c.uf.toUpperCase()}</span>
                    {!compact && c.label && <span className="mt-0.5 font-mono text-[10px] whitespace-nowrap">{c.label}</span>}
                  </button>
                );
              })}
          </div>

          {showCallouts && (
            <>
              <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
                {callouts.map(({ uf, y, anchor }) => (
                  <polyline key={uf} points={`${anchor[0]},${anchor[1]} ${calloutX - 8},${y} ${calloutX},${y}`} fill="none" className="stroke-ink-2" strokeWidth={0.75} />
                ))}
              </svg>
              {callouts.map(({ uf, y }) => (
                <Chip key={uf} cell={model.cells[uf]!} selected={selected === uf} onClick={() => pick(uf)} style={{ left: calloutX, top: y }} />
              ))}
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

          {fit && <Card store={store} model={model} size={fit} onClose={() => store.set({ i: null, x: 0, y: 0, pinned: false })} />}
        </div>
      </div>

      {narrow && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Estados pequenos">
          {CALLOUTS.filter((uf) => model.cells[uf]).map((uf) => (
            <li key={uf}>
              <Chip cell={model.cells[uf]!} selected={selected === uf} onClick={() => pick(uf)} static />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chip({
  cell,
  selected,
  onClick,
  style,
  static: inFlow = false,
}: {
  cell: UfCell;
  selected: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
  static?: boolean;
}) {
  return (
    <button
      type="button"
      tabIndex={inFlow ? 0 : -1}
      aria-hidden={inFlow ? undefined : true}
      aria-label={inFlow ? `${areaName(cell.uf)}: ${cell.label || cell.lines[0]}` : undefined}
      onClick={onClick}
      className={cn(
        "map-chip flex h-6 items-center gap-1.5 rounded border border-line bg-panel pr-2 pl-2 text-[11px] leading-none whitespace-nowrap",
        !inFlow && "absolute -translate-y-1/2",
        selected && "border-ink",
      )}
      style={{ ...style, boxShadow: `inset 3px 0 0 ${cell.party ? partyColor(cell.party) : "var(--line)"}` }}
    >
      <span className="font-bold tracking-wide">{cell.uf.toUpperCase()}</span>
      {cell.label && <span className="font-mono">{cell.label}</span>}
    </button>
  );
}

const CARD_W = 248;
const OFFSET = 14;

/** The hovered (or tapped) state's card, or a municipality's inside the drawn state. */
function Card({ store, model, size, onClose }: { store: HoverStore; model: UfMapModel; size: { width: number; height: number }; onClose: () => void }) {
  const hover = useHover(store);
  if (hover.i === null) return null;
  const uf = model.geo.ufs[hover.i]!;
  const mun = model.overlay?.uf === uf ? model.overlay.describe(hover.i) : null;
  const cell = model.cells[uf];
  const content: { title: string; token: FillToken; split?: FillToken; lines: string[] } | null = mun
    ? { title: `${mun.name} · ${uf.toUpperCase()}`, token: mun.token, lines: mun.lines }
    : cell
      ? { title: areaName(uf), token: cell.token, split: cell.split, lines: cell.lines }
      : null;
  if (!content) return null;
  const { x, y } = hover;
  const flip = x + OFFSET + CARD_W > size.width;
  const left = Math.max(4, Math.min(size.width - CARD_W - 4, flip ? x - CARD_W - OFFSET : x + OFFSET));
  const top = Math.max(4, Math.min(size.height - 140, y + OFFSET));
  return (
    <div
      role={hover.pinned ? "dialog" : "tooltip"}
      aria-label={hover.pinned ? content.title : undefined}
      className="absolute z-20 flex flex-col gap-1.5 rounded-md border border-line bg-panel p-3 text-sm shadow-lg"
      style={hover.pinned ? { left: 8, right: 8, bottom: 8, maxWidth: 360 } : { left, top, width: CARD_W, pointerEvents: "none" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 leading-tight font-semibold">
          <Swatch token={content.token} split={content.split} />
          {content.title}
        </p>
        {hover.pinned && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="-m-1 rounded-sm p-1 text-ink-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {content.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

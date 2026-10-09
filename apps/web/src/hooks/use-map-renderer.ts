"use client";

import { useEffect, useEffectEvent, useRef, useSyncExternalStore, type RefObject } from "react";
import { ABROAD } from "@apuracao/tse/codes";
import type { Geometry } from "@/map/geometry";
import { MapRenderer, type MapEvents } from "@/map/renderer";
import type { MapStyle } from "@/map/style";

// The canvas renderer is an external system (an imperative canvas, a ResizeObserver, two
// media queries), so it lives in an Effect with a cleanup (global frontend rules).

/** Phones get the call-outs as a row of chips under the map instead of a right gutter. */
export const CALLOUT_GUTTER_PX = 116;
export const NARROW_PX = 480;

export interface MapControls {
  zoomBy(factor: number): void;
  reset(): void;
}

/**
 * Creates the renderer for the map's box and keeps it in sync with React: the frame's
 * colours (`styleKey` changes exactly when they do), the selected UF (zooming to it when
 * it changes). Returns the zoom buttons' controls.
 */
export function useMapRenderer(
  refs: { box: RefObject<HTMLDivElement | null>; base: RefObject<HTMLCanvasElement | null>; over: RefObject<HTMLCanvasElement | null> },
  geo: Geometry,
  sync: { style: MapStyle; styleKey: string; selectedUf: string | null },
  events: MapEvents,
): MapControls {
  const renderer = useRef<MapRenderer | null>(null);
  const onHover = useEffectEvent(events.onHover);
  const onPick = useEffectEvent(events.onPick);
  const onTransform = useEffectEvent(events.onTransform);
  const onHint = useEffectEvent(events.onHint);

  useEffect(() => {
    const box = refs.box.current;
    const base = refs.base.current;
    const over = refs.over.current;
    if (!box || !base || !over) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const r = new MapRenderer(
      base,
      over,
      geo,
      {
        onHover: (i, x, y) => onHover(i, x, y),
        onPick: (i, touch) => onPick(i, touch),
        onTransform: (t, fit) => onTransform(t, fit),
        onHint: (kind) => onHint(kind),
      },
      reduced.matches,
    );
    r.setTheme();
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      r.resize(width, height, width < NARROW_PX ? 0 : CALLOUT_GUTTER_PX);
    });
    ro.observe(box);
    const onTheme = () => r.setTheme();
    const onMotion = () => r.setReducedMotion(reduced.matches);
    dark.addEventListener("change", onTheme);
    reduced.addEventListener("change", onMotion);
    renderer.current = r;
    return () => {
      ro.disconnect();
      dark.removeEventListener("change", onTheme);
      reduced.removeEventListener("change", onMotion);
      r.destroy();
      renderer.current = null;
    };
  }, [refs.box, refs.base, refs.over, geo]);

  // `geo` is in both lists so a new renderer gets the current colours and selection.
  useEffect(() => {
    renderer.current?.setStyle(sync.style, sync.styleKey);
  }, [geo, sync.style, sync.styleKey]);
  useEffect(() => {
    const r = renderer.current;
    if (!r) return;
    r.setSelectedUf(sync.selectedUf);
    if (sync.selectedUf && sync.selectedUf !== ABROAD) r.zoomToUf(sync.selectedUf);
  }, [geo, sync.selectedUf]);

  return {
    zoomBy: (factor) => renderer.current?.zoomBy(factor),
    reset: () => renderer.current?.reset(),
  };
}

// --- The hovered or tapped municipality, outside React state ----------------------------
// The pointer moves 60 times a second; only the tooltip should re-render for it.

export interface HoverState {
  i: number | null;
  /** CSS px relative to the map's box. */
  x: number;
  y: number;
  /** Tapped or clicked: stays until closed or another pick. */
  pinned: boolean;
}

export class HoverStore {
  private state: HoverState = { i: null, x: 0, y: 0, pinned: false };
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  get = () => this.state;
  set(next: HoverState) {
    const s = this.state;
    if (s.i === next.i && s.x === next.x && s.y === next.y && s.pinned === next.pinned) return;
    this.state = next;
    for (const fn of this.listeners) fn();
  }
}

const EMPTY: HoverState = { i: null, x: 0, y: 0, pinned: false };

export function useHover(store: HoverStore): HoverState {
  return useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
}

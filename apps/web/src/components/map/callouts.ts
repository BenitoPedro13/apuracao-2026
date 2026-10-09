import type { Geometry } from "@/map/geometry";
import type { Fit } from "@/map/renderer";

// The small states' call-outs, shared by the president's map and the per-UF maps
// (TASK-map.md §2.4, TASK-visual-pass-2.md §2.2).

/** States too small for an in-place label at the national fit, north to south. */
export const CALLOUTS = ["rn", "pb", "pe", "al", "se", "df", "es", "rj"];
export const CALLOUT_GAP_PX = 30;

/** A UF's label anchor in CSS px at the current fit (before zoom), or null. */
export function anchorOf(geo: Geometry, fit: Fit | null, uf: string): [number, number] | null {
  const p = geo.labels[uf];
  return p && fit ? [fit.ox + p[0] * fit.s, fit.oy + p[1] * fit.s] : null;
}

/** Call-outs stacked beside the coast in the anchors' north-to-south order, never overlapping. */
export function placeCallouts(geo: Geometry, fit: Fit | null, has: (uf: string) => boolean) {
  const out: { uf: string; y: number; anchor: [number, number] }[] = [];
  let last = -Infinity;
  for (const uf of CALLOUTS) {
    const a = anchorOf(geo, fit, uf);
    if (!has(uf) || !a) continue;
    const y = Math.max(a[1], last + CALLOUT_GAP_PX);
    out.push({ uf, y, anchor: a });
    last = y;
  }
  return out;
}

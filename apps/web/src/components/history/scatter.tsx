"use client";

import { useEffect, useRef, useState } from "react";

// Every municipality as a dot, one election against another (TASK-historical-presidential.md
// §2.3). Canvas 2D: 5,570 points. The canvas is an external system (a ResizeObserver, a
// theme media query), so it is drawn from an Effect; the panel's table carries the numbers.

export interface ScatterPoint {
  x: number;
  y: number;
  /** Index into the history's municipalities, for the tooltip. */
  i: number;
}

const M = { l: 40, r: 22, t: 10, b: 30 };

export function Scatter({
  label,
  points,
  xLabel,
  yLabel,
  describe,
  highlight,
}: {
  label: string;
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  describe: (i: number) => string;
  /** Municipalities drawn on top in the accent colour (e.g. a region, a searched town). */
  highlight?: ReadonlySet<number>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const draw = () => {
      const { width: w, height: h } = cv.getBoundingClientRect();
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cs = getComputedStyle(cv);
      const v = (n: string) => cs.getPropertyValue(n).trim();
      const W = w - M.l - M.r,
        H = h - M.t - M.b;
      const X = (t: number) => M.l + t * W,
        Y = (t: number) => M.t + (1 - t) * H;
      ctx.clearRect(0, 0, w, h);
      ctx.font = `11px ${v("--font-mono") || "monospace"}`;
      ctx.lineWidth = 1;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        ctx.strokeStyle = v("--line");
        ctx.beginPath();
        ctx.moveTo(X(0), Y(t));
        ctx.lineTo(X(1), Y(t));
        ctx.moveTo(X(t), Y(0));
        ctx.lineTo(X(t), Y(1));
        ctx.stroke();
        ctx.fillStyle = v("--ink-2");
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(`${t * 100}%`, M.l - 6, Y(t));
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${t * 100}%`, X(t), M.t + H + 8);
      }
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = v("--ink-2");
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      ctx.lineTo(X(1), Y(1));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = v("--ink");
      for (const p of points) if (!highlight?.has(p.i)) ctx.fillRect(X(p.x) - 1.25, Y(p.y) - 1.25, 2.5, 2.5);
      ctx.globalAlpha = 1;
      if (highlight?.size) {
        // Small and translucent, so the highlighted cloud keeps its shape and the rest stays visible.
        ctx.fillStyle = v("--pt");
        ctx.globalAlpha = 0.55;
        for (const p of points) {
          if (!highlight.has(p.i)) continue;
          ctx.beginPath();
          ctx.arc(X(p.x), Y(p.y), 2.25, 0, 2 * Math.PI);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    dark.addEventListener("change", draw);
    return () => {
      ro.disconnect();
      dark.removeEventListener("change", draw);
    };
  }, [points, highlight]);

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const W = r.width - M.l - M.r,
      H = r.height - M.t - M.b;
    let best: ScatterPoint | null = null,
      bd = 64;
    for (const p of points) {
      const d = (M.l + p.x * W - mx) ** 2 + (M.t + (1 - p.y) * H - my) ** 2;
      if (d < bd) ((bd = d), (best = p));
    }
    setTip(best ? { x: mx, y: my, text: describe(best.i) } : null);
  };

  return (
    <figure className="relative m-0 flex flex-col gap-1">
      <p aria-hidden className="font-mono text-xs text-ink-2">
        ↑ {yLabel}
      </p>
      <p className="sr-only">{label}</p>
      <canvas ref={canvas} aria-hidden
        className="aspect-square w-full"
        onPointerMove={onMove}
        onPointerLeave={() => setTip(null)}
      />
      <p aria-hidden className="text-right font-mono text-xs text-ink-2">
        {xLabel} →
      </p>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs whitespace-pre-line shadow-sm"
          style={{
            left: tip.x,
            top: tip.y + 16,
            transform: tip.x > 200 ? "translateX(-100%)" : undefined,
          }}
        >
          {tip.text}
        </div>
      )}
    </figure>
  );
}

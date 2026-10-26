"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { valueAt, type CountSeries } from "@/hooks/use-count-timeline";

// "Ao longo da apuração" (TASK-over-the-count.md §2.3): hand-written SVG like
// history/line-chart.tsx, with a numeric x (% of sections). Lines step from one TSE file to the
// next (no interpolation), break at gaps, and end at the last file. The crosshair is a slider:
// arrow keys move it by 1% (Shift: 10%), Home/End jump to the ends, and its value text reads
// every series at that point. The table under the chart is the non-visual alternative.

const W = 360,
  H = 200;
const M = { l: 40, r: 92, t: 10, b: 26 };
const X_TICKS = [0, 50, 100];

const pctFmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const sharePct = (y: number) => `${pctFmt.format(y * 100)}%`;
const intPct = (y: number) => `${Math.round(y * 100)}%`;

/** A symmetric y range around 50% fitting every point past 5% of sections, in steps of 4 points; earlier points are clipped (the table and crosshair still read them). */
function yRange(series: CountSeries[]): [number, number] {
  let d = 0.04;
  for (const s of series) for (const p of s.points) if (p.x >= 5) d = Math.max(d, Math.abs(p.y - 0.5));
  d = Math.ceil(d / 0.04 - 1e-9) * 0.04;
  return [0.5 - d, 0.5 + d];
}

export function CountChart({ label, series, leadChanges, until }: { label: string; series: CountSeries[]; leadChanges: number[]; until: number }) {
  const id = useId();
  const [at, setAt] = useState<number | null>(null);
  const [yMin, yMax] = yRange(series);
  const ticks = [yMin, (yMin + 0.5) / 2, 0.5, (yMax + 0.5) / 2, yMax];
  const px = (x: number) => M.l + (x / 100) * (W - M.l - M.r);
  const py = (y: number) => M.t + (1 - (y - yMin) / (yMax - yMin)) * (H - M.t - M.b);

  const path = (s: CountSeries) => {
    let d = "";
    s.points.forEach((p, i) => {
      const prev = s.points[i - 1];
      if (!prev || p.breakBefore) d += `M${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`;
      else d += `H${px(p.x).toFixed(1)}V${py(p.y).toFixed(1)}`;
    });
    return d;
  };

  const current = series.filter((s) => !s.dashed);
  const ends = current
    .flatMap((s) => {
      const last = s.points.at(-1);
      return last ? [{ s, last, y: py(last.y) }] : [];
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;

  const describe = (x: number) =>
    `${pctFmt.format(x)}% das seções: ` +
    series
      .map((s) => {
        const v = valueAt(s, x);
        return `${s.name} (${s.year}) ${v === null ? "sem dado" : sharePct(v)}`;
      })
      .join(", ");

  const move = (x: number) => setAt(Math.max(0, Math.min(100, Math.round(x * 10) / 10)));
  const onKey = (e: KeyboardEvent) => {
    const base = at ?? until;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") move(base + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") move(base - step);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(until);
    else if (e.key === "Escape") setAt(null);
    else return;
    e.preventDefault();
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (((e.clientX - r.left) / r.width) * W - M.l) / (W - M.l - M.r);
    if (x >= 0 && x <= 1) move(x * 100);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${label}: mova para ler os percentuais em cada ponto da apuração`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={at ?? until}
      aria-valuetext={describe(at ?? until)}
      onKeyDown={onKey}
      onBlur={() => setAt(null)}
      className="relative rounded-md outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="h-auto w-full touch-pan-y overflow-visible" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setAt(null)}>
        <defs>
          <clipPath id={`${id}-plot`}>
            <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} className="stroke-line" strokeWidth={1} />
            <text x={M.l - 6} y={py(t) + 4} textAnchor="end" className="fill-ink-2 font-mono text-[10px]">
              {intPct(t)}
            </text>
          </g>
        ))}
        {X_TICKS.map((x) => (
          <text key={x} x={px(x)} y={H - 6} textAnchor={x === 0 ? "start" : x === 100 ? "end" : "middle"} className="fill-ink-2 font-mono text-[10px]">
            {x === 0 ? "0% das seções" : `${x}%`}
          </text>
        ))}
        <g clipPath={`url(#${id}-plot)`}>
          {[...series].reverse().map((s) => (
            <path
              key={s.key}
              d={path(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1.25 : 2}
              strokeOpacity={s.dashed ? 0.75 : 1}
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? "4 3" : undefined}
            />
          ))}
          {leadChanges.map((x) => (
            <circle key={x} cx={px(x)} cy={py(0.5)} r={4.5} className="fill-card stroke-ink" strokeWidth={1.75} />
          ))}
        </g>
        {ends.map(({ s, last, y }) => (
          <g key={s.key}>
            <circle cx={px(last.x)} cy={py(last.y)} r={3.5} fill={s.color} className="stroke-card" strokeWidth={1.5} />
            <text x={px(last.x) + 8} y={y + 4} className="text-[11px] font-semibold" fill={s.color}>
              {s.name.split(" ")[0]} {sharePct(last.y)}
            </text>
          </g>
        ))}
        {at !== null && <line x1={px(at)} x2={px(at)} y1={M.t} y2={H - M.b} className="stroke-ink-2" strokeWidth={1} />}
      </svg>
      {at !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1 text-[11px] leading-snug shadow-sm sm:px-2.5 sm:py-1.5 sm:text-xs"
          style={{ left: `${(px(at) / W) * 100}%`, transform: px(at) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
        >
          <p className="font-mono font-semibold">{pctFmt.format(at)}% das seções</p>
          {series.map((s) => {
            const v = valueAt(s, at);
            return (
              <p key={s.key} className="whitespace-nowrap">
                <span aria-hidden style={{ color: s.color }}>
                  {s.dashed ? "┄" : "●"}
                </span>{" "}
                {s.dashed ? `${s.name} ${s.year}` : s.name}: <span className="calc font-mono">{v === null ? "—" : sharePct(v)}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

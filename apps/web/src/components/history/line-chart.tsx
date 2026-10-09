"use client";

import { useId, useState } from "react";

// A small multi-series line chart over the elections (TASK-historical-presidential.md §2.3):
// hand-written SVG like the seat bars, one y-scale, end labels so colour is never the only
// cue, a crosshair with every series' value on hover or keyboard focus.

export interface Series {
  name: string;
  /** A CSS colour, e.g. "var(--pt)". */
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

const W = 560,
  H = 240;
const M = { l: 48, r: 112, t: 12, b: 30 };

export function LineChart({
  label,
  x,
  series,
  yMin = 0,
  yMax,
  ticks,
  format,
  tip = format,
  marker,
}: {
  label: string;
  x: readonly string[];
  series: Series[];
  yMin?: number;
  yMax: number;
  ticks: number[];
  format: (v: number) => string;
  /** The tooltip's format, more precise than the axis's. */
  tip?: (v: number, i: number) => string;
  /** An x index to mark with a dashed rule (the event a panel is about). */
  marker?: number;
}) {
  const id = useId();
  const [at, setAt] = useState<number | null>(null);
  const px = (i: number) => M.l + (x.length === 1 ? 0 : (i / (x.length - 1)) * (W - M.l - M.r));
  const py = (v: number) => M.t + (1 - (v - yMin) / (yMax - yMin)) * (H - M.t - M.b);
  const step = (W - M.l - M.r) / Math.max(1, x.length - 1);

  // End labels, nudged apart so they never overlap.
  const ends = series
    .map((s) => {
      const last = s.values.findLastIndex((v) => v !== null);
      return { s, y: last >= 0 ? py(s.values[last]!) : 0, ok: last >= 0 };
    })
    .filter((e) => e.ok)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 14) ends[i]!.y = ends[i - 1]!.y + 14;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={`${id}-t`}
        className="h-auto w-full overflow-visible"
        onPointerLeave={() => setAt(null)}
      >
        <title id={`${id}-t`}>{label}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} className="stroke-line" strokeWidth={1} />
            <text x={M.l - 8} y={py(t) + 4} textAnchor="end" className="fill-ink-2 font-mono text-[11px]">
              {format(t)}
            </text>
          </g>
        ))}
        {x.map((l, i) => (
          <text key={l} x={px(i)} y={H - 8} textAnchor="middle" className="fill-ink-2 font-mono text-[11px]">
            {l}
          </text>
        ))}
        {marker !== undefined && <line x1={px(marker)} x2={px(marker)} y1={M.t} y2={H - M.b} className="stroke-ink-2" strokeDasharray="3 4" />}
        {series.map((s) => {
          let d = "";
          s.values.forEach((v, i) => {
            if (v === null) return;
            d += `${d && s.values[i - 1] !== null ? "L" : "M"}${px(i).toFixed(1)} ${py(v).toFixed(1)}`;
          });
          return (
            <g key={s.name}>
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "5 4" : undefined}
              />
              {s.values.map((v, i) =>
                v === null ? null : (
                  <circle key={i} cx={px(i)} cy={py(v)} r={at === i ? 4.5 : 3} fill={s.color} className="stroke-card" strokeWidth={2} />
                ),
              )}
            </g>
          );
        })}
        {ends.map(({ s, y }) => (
          <text key={s.name} x={W - M.r + 10} y={y + 4} className="fill-ink text-[12px] font-semibold">
            {s.name}
          </text>
        ))}
        {at !== null && <line x1={px(at)} x2={px(at)} y1={M.t} y2={H - M.b} className="stroke-ink-2" strokeWidth={1} />}
        {x.map((l, i) => (
          <rect
            key={l}
            x={px(i) - step / 2}
            y={M.t}
            width={step}
            height={H - M.t - M.b}
            fill="transparent"
            onPointerEnter={() => setAt(i)}
            onPointerMove={() => setAt(i)}
          />
        ))}
      </svg>
      {at !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm"
          style={{
            left: `${(px(at) / W) * 100}%`,
            transform: px(at) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
          }}
        >
          <p className="font-mono font-semibold">{x[at]}</p>
          {series.map((s) => (
            <p key={s.name} className="whitespace-nowrap">
              <span aria-hidden style={{ color: s.color }}>
                ●
              </span>{" "}
              {s.name}: <span className="calc font-mono">{s.values[at] === null ? "—" : tip(s.values[at]!, at)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

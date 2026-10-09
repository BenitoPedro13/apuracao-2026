"use client";

import { hemicycle } from "@/data/chambers";
import { useHemicycle } from "@/hooks/use-legislative";
import type { LegislativeOffice } from "@apuracao/contracts";
import { partyColor } from "@/lib/party";

/**
 * The chamber as dots (TASK-visual-pass-2.md §2.4): palette parties in seat order, the
 * rest as "Outros". A picture of the table under it, so hidden from screen readers; the
 * legend under it carries the numbers in text.
 */
export function Hemicycle({ office }: { office: LegislativeOffice }) {
  const h = useHemicycle(office);
  if (!h || h.total === 0) return null;
  const { seats, r } = hemicycle(h.total);
  const colours: string[] = [];
  for (const g of h.groups) for (let i = 0; i < g.seats; i++) colours.push(g.party ? partyColor(g.party) : "var(--party-other)");
  return (
    <div className="flex flex-col gap-2">
      <svg aria-hidden viewBox={`${-r} ${-r} ${2 + 2 * r} ${1 + 2 * r}`} className="mx-auto w-full max-w-md">
        {seats.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={r} fill={colours[i]} />
        ))}
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs" aria-label="Cadeiras por partido no gráfico">
        {h.groups.map((g) => (
          <li key={g.party ?? "outros"} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: g.party ? partyColor(g.party) : "var(--party-other)" }} />
            {g.party ?? "Outros"} <span className="font-mono">{g.seats}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

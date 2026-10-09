"use client";

import { Calc, Num } from "@/components/num";
import { Skeleton } from "@/components/ui/skeleton";
import { useChamber, useSenateClosest, useTopVoted } from "@/hooks/use-legislative";
import { setUrlParams } from "@/hooks/use-url-state";
import { displayName, formatInt, formatTsePct } from "@/lib/format";
import { Confirma } from "./confirma";
import { UrnaNumber } from "./urna-number";
import { areaName } from "@/lib/places";

// What the right column shows with no state picked (TASK-visual-pass-2.md §2.4).

const open = (uf: string) => {
  setUrlParams({ uf, mun: null });
  requestAnimationFrame(() => document.getElementById("disputa")?.scrollIntoView({ block: "nearest" }));
};

export function LegislativeHighlights() {
  const chamber = useChamber();
  if (!chamber) return null;
  return chamber.office === "senate" ? <SenateClosest /> : <TopVoted office={chamber.office} />;
}

function TopVoted({ office }: { office: "federal-deputy" | "state-deputy" }) {
  const { rows, complete, loading } = useTopVoted(office);
  if (rows.length === 0) return loading ? <Skeleton className="h-96" aria-label="Carregando os mais votados" /> : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-2">
        Entre os eleitos, pelos votos de cada um no arquivo do TSE do seu estado; a ordem entre estados é nossa
        {complete ? "" : " (parcial: faltam estados)"}.
      </p>
      <ol className="flex flex-col">
        {rows.map((c, i) => (
          <li key={`${c.uf}-${c.n}`} className="flex items-center gap-3 border-b border-line py-1.5 text-sm last:border-0">
            <span className="w-5 text-right font-mono text-xs text-ink-2">{i + 1}</span>
            <UrnaNumber n={c.n} party={c.party} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{displayName(c.name)}</span>
              <span className="text-xs text-ink-2">
                {c.party} ·{" "}
                <button type="button" onClick={() => open(c.uf)} className="rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                  {c.uf.toUpperCase()}
                  <span className="sr-only">: ver a disputa em {areaName(c.uf)}</span>
                </button>
              </span>
            </span>
            <Num className="text-sm">{formatInt(c.votes)}</Num>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SenateClosest() {
  const { rows, loading } = useSenateClosest();
  if (rows.length === 0) return loading ? <Skeleton className="h-96" aria-label="Carregando as disputas" /> : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-2">O último eleito contra o mais votado que ficou de fora, em cada estado; a diferença é calculada.</p>
      <ol className="flex flex-col">
        {rows.map((r) => (
          <li key={r.uf} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => open(r.uf)}
              className="flex w-full flex-col gap-1 rounded-sm py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="font-semibold underline-offset-4 hover:underline">{areaName(r.uf)}</span>
              {(
                [
                  ["eleito", r.lastElected],
                  ["não eleito", r.firstOut],
                ] as const
              ).map(([tag, c]) => (
                <span key={c.n} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <UrnaNumber n={c.n} party={c.party} />
                    <span className="min-w-0">
                      {displayName(c.name)} <span className="text-xs text-ink-2">{c.party}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {tag === "eleito" ? <Confirma /> : <span className="sr-only">não eleito</span>}
                    <Num>{formatTsePct(c.pct)}</Num>
                  </span>
                </span>
              ))}
              <span className="text-xs text-ink-2">
                Diferença de <Calc how="Votos do último eleito menos os do mais votado não eleito, no arquivo do TSE do estado.">{formatInt(r.votes)}</Calc> votos
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

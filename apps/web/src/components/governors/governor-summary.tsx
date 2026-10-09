"use client";

import { Confirma } from "@/components/confirma";
import { Calc, Num } from "@/components/num";
import { UrnaNumber } from "@/components/urna-number";
import { ViewError } from "@/components/view-error";
import { Skeleton } from "@/components/ui/skeleton";
import { outcomeLabel, type GovernorRace } from "@/data/governors";
import { useGovernorRaces } from "@/hooks/use-governors";
import { setUrlParams, useSelectedUf } from "@/hooks/use-url-state";
import { displayName, formatBp, formatTsePct } from "@/lib/format";
import { partyColor } from "@/lib/party";
import { cn } from "@/lib/utils";

const SHOWN = 6;
const COUNT_HOW = "Contagem nossa das disputas, pela situação que o TSE publica para cada candidato.";
const DIFF_HOW = "Percentual do primeiro menos o do segundo, sobre os votos válidos do arquivo do TSE para o estado.";

const select = (uf: string) => {
  setUrlParams({ uf, mun: null });
  document.getElementById("governador-uf")?.scrollIntoView({ block: "nearest" });
};

/** The night at a glance (TASK-visual-pass-2.md §2.3): counts, one tile per UF, the closest races. */
export function GovernorSummary() {
  const g = useGovernorRaces();
  const [selected] = useSelectedUf();
  if (g.isLoading && g.races.every((r) => r.outcome === "carregando")) return <Skeleton className="h-96" aria-label="Carregando as disputas" />;
  if (g.error && g.races.every((r) => r.outcome === "carregando")) return <ViewError what="as disputas de governador" error={g.error} stale={false} />;
  const { summary: s } = g;
  const shown = g.races.filter((r) => r.outcome !== "sem-disputa");

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm">
        <Calc how={COUNT_HOW} className="text-2xl font-semibold">
          {s.races}
        </Calc>{" "}
        {s.races === 1 ? "disputa" : "disputas"}
        {s.elected > 0 && (
          <>
            {" · "}
            <Calc how={COUNT_HOW}>{s.elected}</Calc> {s.elected === 1 ? "eleito" : "eleitos"}
            {g.runoff ? "" : " no 1º turno"}
          </>
        )}
        {s.runoff > 0 && (
          <>
            {" · "}
            <Calc how={COUNT_HOW}>{s.runoff}</Calc> no 2º turno
          </>
        )}
        {s.counting > 0 && (
          <>
            {" · "}
            <Calc how={COUNT_HOW}>{s.counting}</Calc> apurando
          </>
        )}
      </p>

      <ul aria-label="Estados" className="grid grid-cols-[repeat(auto-fill,minmax(3.6rem,1fr))] gap-1.5">
        {shown.map((r) => (
          <li key={r.uf}>
            <Tile race={r} runoff={g.runoff} selected={selected === r.uf} />
          </li>
        ))}
      </ul>

      {g.closest.length > 0 && (
        <section aria-labelledby="mais-apertadas" className="flex flex-col gap-2 border-t pt-4">
          <h3 id="mais-apertadas" className="text-sm font-semibold">
            Disputas mais apertadas
          </h3>
          <p className="text-xs text-ink-2">Pela diferença entre os dois mais votados (calculada).</p>
          <ol className="flex flex-col">
            {g.closest.slice(0, SHOWN).map((r) => (
              <Close key={r.uf} race={r} runoff={g.runoff} />
            ))}
          </ol>
          {g.closest.length > SHOWN && (
            <details>
              <summary className="cursor-pointer rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                Ver todas as {g.closest.length}
              </summary>
              <ol className="mt-1 flex flex-col">
                {g.closest.slice(SHOWN).map((r) => (
                  <Close key={r.uf} race={r} runoff={g.runoff} />
                ))}
              </ol>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

/** A UF: solid in the leader's colour when decided, outlined when it goes on or is counting. */
function Tile({ race: r, runoff, selected }: { race: GovernorRace; runoff: boolean; selected: boolean }) {
  const decided = r.outcome === "eleito";
  const colour = r.first ? partyColor(r.first.party) : undefined;
  const label = r.first
    ? `${r.name}: ${displayName(r.first.name)} (${r.first.party}) ${decided ? "eleito" : "lidera"} com ${formatTsePct(r.first.pct)}. ${outcomeLabel(r.outcome, runoff)}.`
    : `${r.name}: ${outcomeLabel(r.outcome, runoff)}.`;
  return (
    <button
      type="button"
      onClick={() => select(r.uf)}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-11 w-full flex-col items-center justify-center rounded-md border-2 text-xs leading-tight focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none",
        !colour && "border-dashed border-line text-ink-2",
        selected && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
      )}
      style={colour ? (decided ? { background: colour, borderColor: colour, color: "var(--panel)" } : { borderColor: colour }) : undefined}
    >
      <span className="font-bold tracking-wide">{r.uf.toUpperCase()}</span>
      {r.first ? (
        <span className="mt-0.5 flex items-center gap-1 text-[10px]">
          <UrnaNumber n={r.first.n} party={r.first.party} />
          {!decided && <span className="text-ink-2">{r.outcome === "2turno" ? "2º t." : "…"}</span>}
        </span>
      ) : (
        <span className="text-[10px]">—</span>
      )}
    </button>
  );
}

function Close({ race: r, runoff }: { race: GovernorRace; runoff: boolean }) {
  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => select(r.uf)}
        className="flex w-full flex-col gap-1 rounded-sm py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold underline-offset-4 hover:underline">{r.name}</span>
          {r.outcome === "eleito" ? <Confirma>{outcomeLabel(r.outcome, runoff)}</Confirma> : <span className="text-xs text-ink-2">{outcomeLabel(r.outcome, runoff)}</span>}
        </span>
        {[r.first, r.second].map(
          (c) =>
            c && (
              <span key={c.n} className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <UrnaNumber n={c.n} party={c.party} />
                  {displayName(c.name)} <span className="text-xs text-ink-2">{c.party}</span>
                </span>
                <Num>{formatTsePct(c.pct)}</Num>
              </span>
            ),
        )}
        {r.difference && (
          <span className="text-xs text-ink-2">
            Diferença de <Calc how={DIFF_HOW}>{formatBp(r.difference.bp)}</Calc> pontos
          </span>
        )}
      </button>
    </li>
  );
}

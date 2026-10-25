"use client";

import { Calc } from "@/components/num";
import { Panel } from "@/components/panel";
import { UrnaNumber } from "@/components/urna-number";
import { Skeleton } from "@/components/ui/skeleton";
import { useSinceFirstRound, type ShiftRow } from "@/hooks/use-since-first-round";
import { displayName } from "@/lib/format";
import { partyColor } from "@/lib/party";

const SHOWN = 5;
const HOW =
  "Variação da diferença entre os dois candidatos, em pontos percentuais dos votos válidos: a diferença no 2º turno (apuração em andamento) menos a do resultado final do 1º turno, nos percentuais do TSE para o estado.";

/** "Desde o 1º turno" (TASK-night-copy-and-shift.md §2.3). Renders nothing outside the 2nd round. */
export function SinceFirstRound({ className }: { className?: string }) {
  const { data, isLoading } = useSinceFirstRound();
  if (!data && !isLoading) return null;
  return (
    <Panel id="desde-1-turno" title="Desde o 1º turno" className={className}>
      {data ? <Shifts data={data} /> : <Skeleton className="h-48" />}
    </Panel>
  );
}

function Shifts({ data }: { data: NonNullable<ReturnType<typeof useSinceFirstRound>["data"]> }) {
  const { candidates, toward, waiting } = data;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-ink-2">
        Onde a diferença entre os dois mudou em relação ao 1º turno, em pontos, nos estados que já têm seções apuradas.
        Com poucas seções apuradas, a variação ainda diz pouco.
      </p>
      {candidates.map((c, i) => (
        <section key={c.n} aria-labelledby={`desde-${c.n}`} className="flex flex-col gap-2">
          <h3 id={`desde-${c.n}`} className="flex items-center gap-2 text-sm font-semibold">
            <UrnaNumber n={c.n} party={c.party} size="sm" />A favor de {displayName(c.name)}
          </h3>
          {toward[i]!.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum estado até agora.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {toward[i]!.slice(0, SHOWN).map((r) => (
                <Row key={r.uf} r={r} color={partyColor(c.party)} max={toward[i]![0]!.points} />
              ))}
            </ul>
          )}
        </section>
      ))}
      {waiting > 0 && (
        <p className="text-xs text-muted-foreground">
          {waiting} {waiting === 1 ? "estado ainda sem seções apuradas" : "estados ainda sem seções apuradas"}.
        </p>
      )}
    </div>
  );
}

function Row({ r, color, max }: { r: ShiftRow; color: string; max: number }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 text-sm">
      <abbr title={r.name} className="font-medium no-underline">
        {r.uf.toUpperCase()}
      </abbr>
      <span aria-hidden className="h-1.5 rounded-full" style={{ width: `${Math.max(4, (r.points / max) * 100)}%`, background: color }} />
      <span className="text-right">
        <Calc how={HOW}>+{r.points.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</Calc>
        <span className="ml-1.5 text-xs text-muted-foreground">{r.countedPct ? `${r.countedPct.raw}% apurado` : ""}</span>
      </span>
    </li>
  );
}

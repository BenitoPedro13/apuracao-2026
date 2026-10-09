"use client";

import { CandidateMark } from "@/components/candidate-mark";
import { Calc, Num } from "@/components/num";
import { UnitStatus } from "@/components/unit-status";
import { ViewError } from "@/components/view-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useHeadline } from "@/hooks/use-headline";
import { useSelectedRound } from "@/hooks/use-data";
import { displayName, formatBp, formatInt, formatTsePct, pctNumber } from "@/lib/format";
import { partyColor } from "@/lib/party";
import { cn } from "@/lib/utils";

const SHOWN_OTHERS = 3;

/** The national president headline (TASK-web-shell-and-data-hooks.md §2.4). */
export function Headline() {
  const { data, error, isLoading } = useHeadline("president");
  const { selected } = useSelectedRound();

  if (isLoading) return <HeadlineSkeleton />;
  if (!data) return error ? <ViewError what="o resultado nacional" error={error} stale={false} /> : null;

  const { view, ranked, difference } = data;
  const [first, second, ...others] = ranked ?? [];

  return (
    <section aria-labelledby="headline-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="headline-title" className="text-sm text-muted-foreground">
          Presidente · Brasil{selected ? ` · ${selected.label}` : ""}
        </h2>
        <UnitStatus status={view.status} countedPct={view.sections?.countedPct} failingSince={view.failingSince} />
      </div>
      {error && <ViewError what="o resultado nacional" error={error} stale />}

      {!first || !second ? (
        <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground">
          <UnitStatus status={view.status} countedPct={view.sections?.countedPct} failingSince={view.failingSince} className="text-base" />
        </p>
      ) : (
        <div className={cn("flex flex-col gap-5", view.status === "fetch_failed" && "opacity-70")}>
          <div className="grid grid-cols-2 gap-4">
            {[first, second].map((c, i) => (
              <div key={c.n} className={cn("flex flex-col gap-2", i === 1 && "items-end text-right")}>
                <div className={cn("flex items-center gap-3", i === 1 && "flex-row-reverse")}>
                  <CandidateMark name={c.name} party={c.party} />
                  <div>
                    <p className="font-semibold leading-tight">{displayName(c.name)}</p>
                    <p className="text-sm font-medium" style={{ color: partyColor(c.party) }}>
                      {c.party} {c.n}
                    </p>
                  </div>
                </div>
                <p className="font-mono text-[2.5rem] leading-none font-semibold tracking-tight">
                  {c.pct.raw}
                  <span className="ml-0.5 align-top text-[0.45em] leading-none font-medium">%</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  <Num>{formatInt(c.votes)}</Num> votos
                </p>
                {c.situation && <p className="text-xs text-muted-foreground">Situação no TSE: {c.situation}</p>}
              </div>
            ))}
          </div>

          <LeadersBar first={first} second={second} />

          {difference && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Diferença</dt>
              <dd className="text-right">
                <Calc how="Percentual do primeiro menos o do segundo, sobre os votos válidos do arquivo nacional do TSE.">
                  {formatBp(difference.bp)}
                </Calc>{" "}
                pontos ·{" "}
                <Calc how="Votos do primeiro menos os do segundo, no arquivo nacional do TSE.">{formatInt(difference.votes)}</Calc> votos
              </dd>
            </dl>
          )}

          {others.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <ul className="flex flex-col gap-2">
                {others.slice(0, SHOWN_OTHERS).map((c) => (
                  <OtherCandidate key={c.n} c={c} />
                ))}
              </ul>
              {others.length > SHOWN_OTHERS && (
                <details className="group">
                  <summary className="cursor-pointer rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    Todos os {ranked!.length} candidatos
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {others.slice(SHOWN_OTHERS).map((c) => (
                      <OtherCandidate key={c.n} c={c} />
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {view.votes && view.electorate && (
            <dl className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
              <Stat label="Votos válidos" value={formatInt(view.votes.valid)} />
              <Stat label="Comparecimento" value={formatTsePct(view.electorate.turnoutPct)} sub={formatInt(view.electorate.turnout)} unit="eleitores" />
              <Stat label="Brancos" value={formatTsePct(view.votes.blankPct)} sub={formatInt(view.votes.blank)} />
              <Stat label="Nulos" value={formatTsePct(view.votes.nullPct)} sub={formatInt(view.votes.null)} />
            </dl>
          )}
        </div>
      )}
    </section>
  );
}

type Candidate = NonNullable<ReturnType<typeof useHeadline>["data"]>["view"]["candidates"][number];

function LeadersBar({ first, second }: { first: Candidate; second: Candidate }) {
  // Widths from the TSE's own percentages; the 50% tick marks a majority of valid votes.
  return (
    <div aria-hidden className="relative flex h-2.5 gap-1 overflow-hidden rounded-full bg-muted">
      <div style={{ width: `${pctNumber(first.pct)}%`, background: partyColor(first.party) }} />
      <div className="flex-1" />
      <div style={{ width: `${pctNumber(second.pct)}%`, background: partyColor(second.party) }} />
      <div className="absolute inset-y-[-2px] left-1/2 w-0.5 -translate-x-1/2 bg-foreground" />
    </div>
  );
}

function OtherCandidate({ c }: { c: Candidate }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span>
        <span className="font-medium">{displayName(c.name)}</span>{" "}
        <span className="text-muted-foreground">
          {c.party} {c.n}
        </span>
      </span>
      <Num>{formatTsePct(c.pct)}</Num>
    </li>
  );
}

function Stat({ label, value, sub, unit }: { label: string; value: string; sub?: string; unit?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold">{value}</dd>
      {sub && (
        <dd className="text-xs text-muted-foreground">
          <Num>{sub}</Num>
          {unit && ` ${unit}`}
        </dd>
      )}
    </div>
  );
}

function HeadlineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando o resultado nacional" className="flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-2.5" />
      <Skeleton className="h-24" />
    </div>
  );
}

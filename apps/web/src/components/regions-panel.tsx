"use client";

import { ViewError } from "@/components/view-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useHeadline, useRegionRows } from "@/hooks/use-headline";
import { useShowExterior } from "@/hooks/use-url-state";
import { displayName, formatBp, formatTsePct } from "@/lib/format";
import { partyColor } from "@/lib/party";

/** The 5 regions, our own sums of the UF files (architecture.md §7.4), so labelled "calculado". */
export function RegionsPanel() {
  const { data, error, isLoading } = useRegionRows();
  if (isLoading) return <Skeleton className="h-64" aria-label="Carregando as regiões" />;
  if (!data) return error ? <ViewError what="as regiões" error={error} stale={false} /> : null;
  return (
    <div className="flex flex-col gap-2">
      {error && <ViewError what="as regiões" error={error} stale />}
      <ul className="flex flex-col divide-y">
        {data.map((r) => (
          <li key={r.code} className="flex items-center justify-between gap-3 py-2.5">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                {r.countedBp === null ? "Aguardando dados" : `${formatBp(r.countedBp)}% das seções`}
                {!r.complete && r.countedBp !== null && " · faltam estados"}
              </p>
            </div>
            {r.leader ? (
              <p className="text-right text-sm">
                <span className="font-medium">{displayName(r.leader.name)}</span>{" "}
                <span className="text-xs font-medium" style={{ color: partyColor(r.leader.party) }}>
                  {r.leader.party} {r.leader.n}
                </span>
                <br />
                <span className="tabular-nums">{formatBp(r.leader.pctBp)}%</span>
              </p>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </li>
        ))}
        <ExteriorRow />
      </ul>
      <p className="text-xs text-muted-foreground">
        Regiões: calculado por nós, somando os arquivos de cada estado publicados pelo TSE (o TSE não publica totais
        por região). Exterior: o arquivo do próprio TSE.
      </p>
    </div>
  );
}

/** Abroad comes straight from the TSE's own `zz` file, not a sum. */
function ExteriorRow() {
  const [show] = useShowExterior();
  const { data } = useHeadline("president", "zz");
  if (!show || !data) return null;
  const top = data.ranked?.[0];
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <p className="font-medium">Exterior</p>
        <p className="text-xs text-muted-foreground">
          {data.view.sections ? `${formatTsePct(data.view.sections.countedPct)} das seções` : "Aguardando dados do TSE"}
        </p>
      </div>
      {top ? (
        <p className="text-right text-sm">
          <span className="font-medium">{displayName(top.name)}</span>{" "}
          <span className="text-xs font-medium" style={{ color: partyColor(top.party) }}>
            {top.party} {top.n}
          </span>
          <br />
          <span className="tabular-nums">{formatTsePct(top.pct)}</span>
        </p>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </li>
  );
}

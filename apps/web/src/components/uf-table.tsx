"use client";

import { DataTable, type DataColumn } from "@/components/data-table";
import { LeaderCell, leaderPct } from "@/components/leader-cell";
import { UnitStatus } from "@/components/unit-status";
import { Skeleton } from "@/components/ui/skeleton";
import { useAreaRows, type AreaRow } from "@/hooks/use-rows";
import { useSelectedUf } from "@/hooks/use-url-state";
import { pctNumber } from "@/lib/format";

const COLUMNS: DataColumn<AreaRow>[] = [
  { id: "name", header: "Estado", cell: (r) => r.name, sortValue: (r) => r.name },
  {
    id: "leader",
    header: "Lidera",
    cell: (r) =>
      r.leader ? (
        <LeaderCell leader={r.leader} />
      ) : r.status ? (
        <UnitStatus status={r.status} failingSince={r.failingSince} />
      ) : r.error ? (
        <span className="text-xs text-warn">Erro ao carregar</span>
      ) : (
        <span className="text-xs text-muted-foreground">Carregando…</span>
      ),
    sortValue: (r) => r.leader?.name,
  },
  { id: "pct", header: "%", cell: (r) => leaderPct(r.leader), sortValue: (r) => (r.leader ? pctNumber(r.leader.pct) : undefined), numeric: true },
  {
    id: "counted",
    header: "Apurado",
    cell: (r) => (r.status && r.countedPct ? `${r.countedPct.raw}%` : "—"),
    sortValue: (r) => (r.countedPct ? pctNumber(r.countedPct) : undefined),
    numeric: true,
  },
];

/** Every UF + Exterior; choosing one opens its municipalities below. */
export function UfTable() {
  const { rows, isLoading } = useAreaRows();
  const [, setUf] = useSelectedUf();
  if (isLoading && rows.every((r) => !r.status)) return <Skeleton className="h-96" aria-label="Carregando os estados" />;
  return (
    <DataTable
      rows={rows}
      columns={COLUMNS}
      caption="Resultado para presidente por estado. Escolha um estado para ver os municípios."
      rowId={(r) => r.area}
      onRowClick={(r) => {
        setUf(r.area);
        document.getElementById("municipios")?.scrollIntoView({ block: "start" });
      }}
      rowLabel={(r) => `${r.name}: ver municípios`}
    />
  );
}

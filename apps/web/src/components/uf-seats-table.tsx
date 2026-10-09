"use client";

import { DataTable, type DataColumn } from "@/components/data-table";
import { Calc } from "@/components/num";
import { Skeleton } from "@/components/ui/skeleton";
import { useChamber, useNationalSeats, type UfSeatsRow } from "@/hooks/use-legislative";
import { useSelectedUf } from "@/hooks/use-url-state";
import { formatInt } from "@/lib/format";

const COUNT_HOW = "Contagem dos candidatos do partido marcados como eleitos no arquivo da UF.";

const COLUMNS: DataColumn<UfSeatsRow>[] = [
  { id: "name", header: "Estado", cell: (r) => r.name, sortValue: (r) => r.name },
  {
    id: "seats",
    header: "Vagas",
    cell: (r) => (r.seats === null ? <span className="text-xs text-muted-foreground">Aguardando dados do TSE</span> : formatInt(r.seats)),
    sortValue: (r) => r.seats ?? undefined,
    numeric: true,
  },
  {
    id: "parties",
    header: "Eleitos por partido",
    cell: (r) => (
      <span className="text-sm">
        {r.parties.map((p, i) => (
          <span key={p.party} className="whitespace-nowrap">
            {i > 0 && <span aria-hidden className="text-ink-2"> · </span>}
            {p.party} <Calc how={COUNT_HOW}>{p.seats}</Calc>
            {i < r.parties.length - 1 && <span className="sr-only">,</span>}
          </span>
        ))}
      </span>
    ),
  },
];

/** Every UF: its seats and who won them; choosing one opens its race. */
export function UfSeatsTable() {
  const chamber = useChamber();
  const { view, ufRows } = useNationalSeats(chamber?.office ?? "federal-deputy");
  const [, setUf] = useSelectedUf();
  if (!chamber) return null;
  if (!view.data) return view.absent ? null : <Skeleton className="h-96" aria-label="Carregando os estados" />;
  return (
    <DataTable
      rows={ufRows}
      columns={COLUMNS}
      caption={`${chamber.title}: vagas e eleitos por partido em cada estado. Escolha um estado para ver a disputa.`}
      rowId={(r) => r.uf}
      onRowClick={(r) => {
        setUf(r.uf);
        document.getElementById("disputa")?.scrollIntoView({ block: "start" });
      }}
      rowLabel={(r) => `${r.name}: ver a disputa`}
    />
  );
}

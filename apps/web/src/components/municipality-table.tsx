"use client";

import { useState } from "react";
import { DataTable, type DataColumn } from "@/components/data-table";
import { LeaderCell, leaderPct } from "@/components/leader-cell";
import { UnitStatus } from "@/components/unit-status";
import { ViewError } from "@/components/view-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useMunicipalityRows, type MunicipalityRowView } from "@/hooks/use-rows";
import { useSelectedUf, useShowExterior } from "@/hooks/use-url-state";
import { pctNumber } from "@/lib/format";
import { AREAS, areaName } from "@/lib/places";
import { ABROAD } from "@apuracao/tse/codes";

const COLUMNS: DataColumn<MunicipalityRowView>[] = [
  {
    id: "name",
    header: "Município",
    cell: (r) => (
      <>
        {r.name}
        {r.capital && <span className="ml-1 text-xs text-muted-foreground">(capital)</span>}
      </>
    ),
    sortValue: (r) => r.name,
  },
  {
    id: "leader",
    header: "Lidera",
    cell: (r) =>
      r.leader ? (
        <LeaderCell leader={r.leader} />
      ) : r.tie ? (
        <span className="text-xs">Empate</span>
      ) : (
        <UnitStatus status={r.status} failingSince={r.failingSince} />
      ),
    sortValue: (r) => r.leader?.name ?? (r.tie ? "Empate" : undefined),
  },
  { id: "pct", header: "%", cell: (r) => leaderPct(r.leader), sortValue: (r) => (r.leader ? pctNumber(r.leader.pct) : undefined), numeric: true },
  {
    id: "counted",
    header: "Seções apuradas",
    cell: (r) => (r.countedPct ? `${r.countedPct.raw}%` : "—"),
    sortValue: (r) => (r.countedPct ? pctNumber(r.countedPct) : undefined),
    numeric: true,
  },
];

const DEFAULT_UF = "sp";

/** The map's table alternative (invariant 7): one UF at a time, searchable, sortable. */
export function MunicipalityTable() {
  const [selectedUf, setUf] = useSelectedUf();
  const [showExterior] = useShowExterior();
  const [search, setSearch] = useState("");
  const uf = selectedUf ?? DEFAULT_UF;
  const { data, error, isLoading } = useMunicipalityRows(uf, search);
  const areas = showExterior ? AREAS : AREAS.filter((a) => a !== ABROAD);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="mun-uf" className="text-sm font-medium">
            Estado
          </label>
          <select
            id="mun-uf"
            value={uf}
            onChange={(e) => setUf(e.target.value)}
            className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {areas.map((a) => (
              <option key={a} value={a}>
                {areaName(a)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="mun-search" className="text-sm font-medium">
            Buscar município
          </label>
          <input
            id="mun-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ex.: Sao Jose"
            className="h-8 w-56 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        {data && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {data.length} {data.length === 1 ? "município" : "municípios"}
          </p>
        )}
      </div>
      {error && <ViewError what={`os municípios de ${areaName(uf)}`} error={error} stale={!!data} />}
      {isLoading ? (
        <Skeleton className="h-96" aria-label="Carregando os municípios" />
      ) : data ? (
        <div className="max-h-[36rem] overflow-y-auto rounded-md border">
          <DataTable
            rows={data}
            columns={COLUMNS}
            caption={`Resultado para presidente nos municípios de ${areaName(uf)}`}
            rowId={(r) => r.mu}
            initialSort={[{ id: "name", desc: false }]}
          />
        </div>
      ) : null}
    </div>
  );
}

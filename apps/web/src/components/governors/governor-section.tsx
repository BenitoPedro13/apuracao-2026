"use client";

import { DataTable, type DataColumn } from "@/components/data-table";
import { Headline } from "@/components/headline";
import { LeaderCell, leaderPct } from "@/components/leader-cell";
import { UfMapSection } from "@/components/map/uf-map-section";
import { MunicipalityTable } from "@/components/municipality-table";
import { Panel } from "@/components/panel";
import { UnitStatus } from "@/components/unit-status";
import { Skeleton } from "@/components/ui/skeleton";
import { outcomeLabel, type GovernorRace } from "@/data/governors";
import { useGovernorFocus, useGovernorRaces } from "@/hooks/use-governors";
import { setUrlParams } from "@/hooks/use-url-state";
import { pctNumber } from "@/lib/format";
import { areaName } from "@/lib/places";
import { GovernorSummary } from "./governor-summary";

// Governadores (TASK-visual-pass-2.md §2.3): summary, map, the selected race, tables.

export function GovernorSection() {
  const g = useGovernorRaces();
  const focus = useGovernorFocus(g);
  const raceUfs = g.races.filter((r) => r.outcome !== "sem-disputa").map((r) => r.uf);
  return (
    <main
      id="conteudo"
      className="mx-auto grid w-full max-w-[96rem] flex-1 grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,22rem)]"
    >
      <Panel id="governadores" title="Governadores" className="min-w-0 lg:row-span-2 xl:row-span-1">
        <GovernorSummary />
      </Panel>

      <Panel id="mapa" title="Mapa por estado" className="min-w-0 lg:row-span-2 xl:row-span-1">
        <UfMapSection kind="governor" tableId="estados" />
      </Panel>

      <section id="governador-uf" aria-label="Disputa no estado" className="min-w-0 scroll-mt-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
        {focus.uf ? (
          <Headline
            key={focus.uf}
            office="governor"
            area={focus.uf}
            title={`Governador · ${areaName(focus.uf)}`}
            note={focus.isDefault ? "A disputa mais apertada. Escolha outro estado no mapa ou na lista." : undefined}
          />
        ) : (
          <Skeleton className="h-96" aria-label="Carregando a disputa" />
        )}
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:col-span-2 xl:col-span-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Panel id="estados" title="Por estado" className="min-w-0">
          <GovernorTable races={g.races.filter((r) => r.outcome !== "sem-disputa")} runoff={g.runoff} loading={g.isLoading} />
        </Panel>
        <Panel id="municipios" title="Por município" className="min-w-0">
          {focus.uf && <MunicipalityTable office="governor" areas={raceUfs} fallbackUf={focus.uf} />}
        </Panel>
      </div>
    </main>
  );
}

function GovernorTable({ races, runoff, loading }: { races: GovernorRace[]; runoff: boolean; loading: boolean }) {
  if (loading && races.every((r) => r.outcome === "carregando")) return <Skeleton className="h-96" aria-label="Carregando os estados" />;
  const columns: DataColumn<GovernorRace>[] = [
    { id: "name", header: "Estado", cell: (r) => r.name, sortValue: (r) => r.name },
    {
      id: "leader",
      header: "Lidera",
      cell: (r) =>
        r.first ? (
          <LeaderCell leader={r.first} />
        ) : r.status ? (
          <UnitStatus status={r.status} failingSince={r.failingSince} />
        ) : (
          <span className="text-xs text-muted-foreground">Carregando…</span>
        ),
      sortValue: (r) => r.first?.name,
    },
    { id: "pct", header: "%", cell: (r) => leaderPct(r.first), sortValue: (r) => (r.first ? pctNumber(r.first.pct) : undefined), numeric: true },
    { id: "outcome", header: "Situação", cell: (r) => tableOutcome(r, runoff), sortValue: (r) => tableOutcome(r, runoff) },
    {
      id: "counted",
      header: "Apurado",
      cell: (r) => (r.countedPct ? `${r.countedPct.raw}%` : "—"),
      sortValue: (r) => (r.countedPct ? pctNumber(r.countedPct) : undefined),
      numeric: true,
    },
  ];
  return (
    <DataTable
      rows={races}
      columns={columns}
      caption="Resultado para governador por estado. Escolha um estado para ver a disputa e os municípios."
      rowId={(r) => r.uf}
      onRowClick={(r) => {
        setUrlParams({ uf: r.uf, mun: null });
        document.getElementById("governador-uf")?.scrollIntoView({ block: "start" });
      }}
      rowLabel={(r) => `${r.name}: ver a disputa`}
    />
  );
}

/** Short enough for a column: the TSE's own words where it has them. */
function tableOutcome(r: GovernorRace, runoff: boolean): string {
  if (r.outcome === "eleito") return "Eleito";
  if (r.outcome === "2turno") return "2º turno";
  return outcomeLabel(r.outcome, runoff);
}

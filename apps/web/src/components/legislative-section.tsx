"use client";

import { Hemicycle } from "@/components/hemicycle";
import { LegislativeHighlights } from "@/components/legislative-highlights";
import { UfMapSection } from "@/components/map/uf-map-section";
import { Panel } from "@/components/panel";
import { SeatBars } from "@/components/seat-bars";
import { UfRace } from "@/components/uf-race";
import { UfSeatsTable } from "@/components/uf-seats-table";
import { useChamber } from "@/hooks/use-legislative";
import { useSelectedUf } from "@/hooks/use-url-state";
import { AREAS } from "@/lib/places";

/**
 * Senate and deputies: the 1st round's final result (TASK-legislative-archive.md §2.4),
 * laid out like the president's page (TASK-visual-pass-2.md §2.4): composition, map,
 * highlights; the picked state's race under them, then every state.
 */
export function LegislativeSection() {
  const chamber = useChamber();
  const [uf] = useSelectedUf();
  if (!chamber) return null;
  const picked = uf && AREAS.includes(uf) && uf !== "zz";
  return (
    <main
      id="conteudo"
      className="mx-auto grid w-full max-w-[96rem] flex-1 grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)_minmax(0,22rem)]"
    >
      <Panel id="composicao" title={`${chamber.title}: eleitos por partido`} className="min-w-0 lg:row-span-2 xl:row-span-1">
        <div className="flex flex-col gap-4">
          {chamber.office !== "state-deputy" && <Hemicycle office={chamber.office} />}
          <SeatBars />
        </div>
      </Panel>
      <Panel id="mapa" title="Mapa por estado" className="min-w-0">
        <UfMapSection kind={chamber.office} tableId="estados" />
      </Panel>
      <Panel
        id="destaques"
        title={chamber.office === "senate" ? "Disputas mais apertadas" : "Eleitos mais votados do Brasil"}
        className="min-w-0"
      >
        <LegislativeHighlights />
      </Panel>
      {picked && (
        <Panel id="disputa" title="Disputa por estado" className="min-w-0 lg:col-span-2 xl:col-span-3">
          <UfRace />
        </Panel>
      )}
      <Panel id="estados" title="Por estado" className="min-w-0 overflow-x-auto lg:col-span-2 xl:col-span-3">
        <UfSeatsTable />
      </Panel>
    </main>
  );
}

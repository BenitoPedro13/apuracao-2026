"use client";

import { Panel } from "@/components/panel";
import { SeatBars } from "@/components/seat-bars";
import { UfRace } from "@/components/uf-race";
import { UfSeatsTable } from "@/components/uf-seats-table";
import { useChamber } from "@/hooks/use-legislative";

/** Senate and deputies: the 1st round's final result (TASK-legislative-archive.md §2.4). */
export function LegislativeSection() {
  const chamber = useChamber();
  if (!chamber) return null;
  return (
    <main
      id="conteudo"
      className="mx-auto grid w-full max-w-[96rem] flex-1 grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
    >
      <Panel id="composicao" title={`${chamber.title}: eleitos por partido`} className="min-w-0">
        <SeatBars />
      </Panel>
      <Panel id="disputa" title="Disputa por estado" className="min-w-0">
        <UfRace />
      </Panel>
      <Panel id="estados" title="Por estado" className="min-w-0 overflow-x-auto lg:col-span-2">
        <UfSeatsTable />
      </Panel>
    </main>
  );
}

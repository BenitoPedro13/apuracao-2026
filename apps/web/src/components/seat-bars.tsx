"use client";

import { Calc } from "@/components/num";
import { ViewError } from "@/components/view-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useChamber, useNationalSeats } from "@/hooks/use-legislative";
import { formatInt } from "@/lib/format";
import { partyColor } from "@/lib/party";

const HOW = "Soma, por partido, dos eleitos marcados pelo TSE nos arquivos das 27 UFs.";

/**
 * The national composition as labelled bars, one row per party (TASK-legislative-archive.md
 * §2.4). A table underneath, so screen readers get party and seats as cells; the sigla is
 * printed on every row, so colour is never the only cue (invariant 7).
 */
export function SeatBars() {
  const chamber = useChamber();
  const { view, bars, maxSeats } = useNationalSeats(chamber?.office ?? "federal-deputy");
  if (!chamber) return null;
  if (view.error && !view.data) return <ViewError what="a composição" error={view.error} stale={false} />;
  if (!view.data) {
    return view.absent ? (
      <p className="text-sm text-ink-2">Ainda não publicado.</p>
    ) : (
      <Skeleton className="h-96" aria-label="Carregando a composição" />
    );
  }
  const v = view.data;
  const missing = v.ufs.filter((u) => u.seats === null).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        <Calc how={HOW} className="text-2xl font-semibold">
          {formatInt(v.seatsCalc)}
        </Calc>{" "}
        {chamber.electedNoun}
        {v.complete ? ` nas ${v.ufs.length} UFs` : ` em ${v.ufs.length - missing} de ${v.ufs.length} UFs (faltam ${missing}: soma parcial)`}
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">Eleitos por partido, soma das UFs</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Partido</th>
            <th scope="col">Eleitos</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.party}>
              <th scope="row" className="w-28 py-0.5 pr-2 text-left font-medium whitespace-nowrap">
                {b.party}
              </th>
              <td className="py-0.5">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-3.5 rounded-sm"
                    style={{ width: `${(b.seats / maxSeats) * 100}%`, minWidth: "2px", background: partyColor(b.party) }}
                  />
                  <Calc how={HOW}>{formatInt(b.seats)}</Calc>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { Calc } from "@/components/num";
import { Panel } from "@/components/panel";
import { CountChart, sharePct } from "@/components/count-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverTheCount, valueAt, type OverTheCount as Model } from "@/hooks/use-count-timeline";
import { formatTime } from "@/lib/format";

const STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const HOW =
  "Votos do candidato sobre os votos válidos, em cada arquivo publicado pelo TSE: o último arquivo com até essa porcentagem de seções apuradas.";

/** "Ao longo da apuração" (TASK-over-the-count.md §2.3). Renders nothing for a round without a series. */
export function OverTheCount({ className }: { className?: string }) {
  const { data, isLoading } = useOverTheCount();
  if (!data && !isLoading) return null;
  return (
    <Panel id="ao-longo" title="Ao longo da apuração" className={className}>
      {data ? <Body data={data} /> : <Skeleton className="h-56" />}
    </Panel>
  );
}

function Body({ data }: { data: Model }) {
  const current = data.series.filter((s) => s.year === data.year);
  const past = data.series.filter((s) => s.year !== data.year);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Legenda">
        {current.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 font-medium">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
        {data.pastYear !== null && (
          <li className="flex items-center gap-1.5 text-ink-2">
            <span aria-hidden className="w-4 border-t border-dashed border-ink-2" />
            {data.pastYear}: {past.map((s) => s.name).join(" × ")}
          </li>
        )}
      </ul>
      <CountChart label={`Percentual dos votos válidos ao longo da apuração, ${data.year}`} series={data.series} leadChanges={data.leadChanges} until={data.until.x} />
      <p className="text-xs text-ink-2">
        Percentuais dos votos válidos <Calc how={HOW}>calculados por nós</Calc> sobre cada arquivo nacional do TSE, na ordem em
        que foram publicados; a linha só muda quando sai um arquivo novo.
        {data.leadChanges.length > 0 && " O círculo marca onde a liderança mudou."} Até {formatTime(data.until.at)} (horário de
        Brasília), {sharePct(data.until.x / 100)} das seções.
        {data.pastYear !== null && ` ${data.pastYear}: histórico de totalização publicado pelo TSE.`}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium underline underline-offset-4">Ver em tabela</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-right text-xs">
            <caption className="sr-only">Percentual dos votos válidos a cada 10% das seções apuradas</caption>
            <thead>
              <tr className="text-ink-2">
                <th scope="col" className="py-1 text-left font-medium">
                  Seções
                </th>
                {data.series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pl-2 font-medium">
                    {s.name.split(" ")[0]} {s.year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STEPS.map((x) => (
                <tr key={x} className="border-t border-line">
                  <th scope="row" className="py-1 text-left font-mono font-normal">
                    {x}%
                  </th>
                  {data.series.map((s) => {
                    const v = valueAt(s, x);
                    return (
                      <td key={s.key} className="py-1 pl-2">
                        {v === null ? <span className="text-muted-foreground">—</span> : <Calc how={HOW}>{sharePct(v)}</Calc>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

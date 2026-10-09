import { Calc } from "@/components/num";
import type { MapModel } from "@/hooks/use-map";
import { formatInt } from "@/lib/format";
import { partyKey, type FillToken, type MapMode } from "@/map/style";

// What each colour means, in words (invariant 7: colour is never the only carrier).

export function Swatch({ token, failed = false }: { token: FillToken; failed?: boolean }) {
  const hatched = token === "waiting" || token === "tie" || failed;
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-[3px] ring-1 ring-line ring-inset"
      style={{
        backgroundColor: `var(--map-${token})`,
        backgroundImage: hatched
          ? "repeating-linear-gradient(-45deg, var(--map-hatch) 0 1.25px, transparent 1.25px 5px)"
          : undefined,
      }}
    />
  );
}

function Ramp({ party }: { party: string }) {
  const p = partyKey(party);
  return (
    <span aria-hidden className="flex gap-px">
      {([1, 2, 3, 4] as const).map((s) => (
        <Swatch key={s} token={`${p}-${s}`} />
      ))}
    </span>
  );
}

const COUNTED_STEPS: [FillToken, string][] = [
  ["counted-1", "menos de 25%"],
  ["counted-2", "25–50%"],
  ["counted-3", "50–75%"],
  ["counted-4", "75–99%"],
  ["counted-5", "100%"],
];

export function MapLegend({ model, mode }: { model: MapModel; mode: MapMode }) {
  const count = (t: FillToken) => model.style.buckets.get(t)?.length ?? 0;
  const specials: [FillToken, string, number][] = [
    ["tie", "Empate exato", mode === "lider" ? count("tie") : 0],
    ["empty", "Nenhuma seção apurada", count("empty")],
    ["waiting", "Aguardando dados do TSE", count("waiting")],
  ];

  const ufLeads = new Map<string, number>();
  for (const u of model.ufs) if (u.leader) ufLeads.set(u.leader.party, (ufLeads.get(u.leader.party) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-2 text-xs">
      {mode === "lider" && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {model.leaders.map((l) => (
            <li key={l.n} className="flex items-center gap-2">
              <Ramp party={l.party} />
              <span>
                {l.party} lidera em{" "}
                <Calc how="Contagem nossa dos municípios em que o candidato tem mais votos, nos arquivos do TSE.">
                  {formatInt(l.count)}
                </Calc>
              </span>
            </li>
          ))}
        </ul>
      )}
      {mode === "estados" && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {[...ufLeads].map(([party, n]) => (
            <li key={party} className="flex items-center gap-2">
              <Ramp party={party} />
              <span>
                {party} lidera em <span className="font-mono">{n}</span> {n === 1 ? "estado" : "estados"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mode === "apurado" ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Seções apuradas">
          {COUNTED_STEPS.map(([t, label]) => (
            <li key={t} className="flex items-center gap-1.5">
              <Swatch token={t} />
              {label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-2">
          Intensidade: vantagem de até 10, 10–25, 25–45 e mais de 45 pontos
          {mode === "estados" ? " no estado" : ""} (calculada).
        </p>
      )}
      {specials.some(([, , n]) => n > 0) || model.style.failed.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {specials
            .filter(([, , n]) => n > 0)
            .map(([t, label, n]) => (
              <li key={t} className="flex items-center gap-1.5">
                <Swatch token={t} />
                {label} <span className="font-mono text-ink-2">({formatInt(n)})</span>
              </li>
            ))}
          {model.style.failed.length > 0 && (
            <li className="flex items-center gap-1.5">
              <Swatch token="empty" failed />
              Falha ao atualizar: último resultado recebido{" "}
              <span className="font-mono text-ink-2">({formatInt(model.style.failed.length)})</span>
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

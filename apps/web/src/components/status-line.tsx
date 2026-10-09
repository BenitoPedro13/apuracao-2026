"use client";

import { useFreshness } from "@/hooks/use-freshness";
import { formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT = {
  ok: "bg-emerald-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  final: "bg-muted-foreground",
  past: "bg-muted-foreground",
  pending: "bg-muted-foreground",
} as const;

/** "Atualizado às hh:mm · TSE hh:mm", amber/red when the pipeline stalls (architecture.md §6.4). */
export function StatusLine() {
  const f = useFreshness();
  if (!f) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const tse = f.tseTotalizedAt ? `TSE ${formatDateTime(f.tseTotalizedAt)}` : "TSE: ainda não publicado";
  let text: string;
  if (f.level === "pending") text = `Atualizado às ${formatTime(f.refreshedAt)}`;
  else if (f.level === "final") text = `Apuração encerrada · ${tse}`;
  else if (f.level === "past") text = `Resultado final · ${tse}`;
  else text = `Atualizado às ${formatTime(f.refreshedAt)} · ${tse}`;
  const warn = f.level === "amber" || f.level === "red";

  return (
    // A live region: a stall announces itself to screen readers too.
    <div role="status" aria-live="polite" className="flex flex-col items-start gap-1 text-sm sm:items-end">
      <p className="flex items-center gap-2">
        <span aria-hidden className={cn("size-2 rounded-full", DOT[f.level])} />
        <span>{text}</span>
      </p>
      {warn && (
        <p className={cn("rounded px-2 py-0.5 text-xs font-medium", f.level === "red" ? "bg-destructive/15 text-destructive" : "bg-warn-bg text-warn")}>
          {f.level === "red" ? "Atualização interrompida" : "Atualização atrasada"}: {f.reason} há{" "}
          {Math.round(Math.max(f.ageMs, f.recorderAgeMs ?? 0) / 60_000)} min.
        </p>
      )}
      {f.pointerError && (
        <p className="rounded bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn">
          Sem conexão com os dados; mostrando os últimos recebidos.
        </p>
      )}
    </div>
  );
}

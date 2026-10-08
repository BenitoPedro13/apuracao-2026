import type { ResultStatus, TsePct } from "@apuracao/contracts";
import { formatTime, formatTsePct } from "@/lib/format";
import { cn } from "@/lib/utils";

// How each status reads (architecture.md §7.2). Missing, zero and failed never look alike.

export function statusText(status: ResultStatus, countedPct: TsePct | null | undefined, failingSince: string | null): string {
  switch (status) {
    case "not_published":
      return "Aguardando dados do TSE";
    case "no_sections":
      return "0 seções apuradas";
    case "counting":
      return countedPct ? `${formatTsePct(countedPct)} das seções` : "Apurando";
    case "final":
      return "Apuração encerrada";
    case "fetch_failed":
      return failingSince ? `Falha ao atualizar desde ${formatTime(failingSince)}` : "Falha ao atualizar";
  }
}

export function UnitStatus({
  status,
  countedPct,
  failingSince = null,
  className,
}: {
  status: ResultStatus;
  countedPct?: TsePct | null;
  failingSince?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-xs",
        status === "fetch_failed" ? "font-medium text-warn" : "text-muted-foreground",
        className,
      )}
    >
      {statusText(status, countedPct, failingSince)}
    </span>
  );
}

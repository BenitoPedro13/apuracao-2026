import { cn } from "@/lib/utils";

// The TSE's "Eleito" as the urna's CONFIRMA key (TASK-urna-number.md §2.2): only for the
// TSE's own flag, never for our inference. The green stays reserved for this.

/** Whether a TSE situation means elected ("Eleito", "Eleito por QP", "Eleito por média"). */
export const isElectedSituation = (situation: string) => situation.startsWith("Eleito");

export function Confirma({ children = "Eleito", className }: { children?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 w-fit items-center rounded-[4px] bg-confirma px-1.5 text-[11px] leading-none font-bold tracking-wide text-panel uppercase shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

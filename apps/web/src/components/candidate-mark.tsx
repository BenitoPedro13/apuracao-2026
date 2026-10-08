import { initials } from "@/lib/format";
import { partyColor } from "@/lib/party";
import { cn } from "@/lib/utils";

/** Initials in a party-coloured ring. Decorative: the name is always written next to it. */
export function CandidateMark({ name, party, className }: { name: string; party: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full border-2 bg-muted text-sm font-semibold", className)}
      style={{ borderColor: partyColor(party), color: partyColor(party) }}
    >
      {initials(name)}
    </span>
  );
}

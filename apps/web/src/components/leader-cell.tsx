import type { LeaderCell as Leader } from "@/hooks/use-rows";
import { displayName, formatTsePct } from "@/lib/format";
import { partyColor } from "@/lib/party";

/** Leader name + party/number in its colour, never colour alone. */
export function LeaderCell({ leader }: { leader: Leader }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: partyColor(leader.party) }} />
      <span>
        {displayName(leader.name)}{" "}
        <span className="text-xs font-medium" style={{ color: partyColor(leader.party) }}>
          {leader.party} {leader.n}
        </span>
      </span>
    </span>
  );
}

export const leaderPct = (leader: Leader | null) => (leader ? formatTsePct(leader.pct) : "—");

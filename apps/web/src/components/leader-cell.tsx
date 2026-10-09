import type { LeaderCell as Leader } from "@/hooks/use-rows";
import { displayName, formatTsePct } from "@/lib/format";
import { partyColor } from "@/lib/party";
import { Changed } from "./changed";
import { UrnaNumber } from "./urna-number";

/** Leader name + party/number in its colour, never colour alone. */
export function LeaderCell({ leader }: { leader: Leader }) {
  return (
    <span className="inline-flex items-center gap-2">
      <UrnaNumber n={leader.n} party={leader.party} />
      <span>
        {displayName(leader.name)}{" "}
        <span className="text-xs font-medium" style={{ color: partyColor(leader.party) }}>
          {leader.party} {leader.n}
        </span>
      </span>
    </span>
  );
}

export const leaderPct = (leader: Leader | null) => (leader ? <Changed value={formatTsePct(leader.pct)} /> : "—");

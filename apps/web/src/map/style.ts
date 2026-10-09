import { RESULT_STATUS_CODE, type MapView } from "@apuracao/contracts";

// What colour each municipality gets, per mode (TASK-map.md §2.4). Pure: buckets of
// municipality indexes keyed by a palette token, so the renderer fills ~12 combined paths
// and the tests count municipalities per bucket on the real frame. Colours themselves are
// CSS variables (globals.css), resolved by the renderer for the current theme.

export const MAP_MODES = ["lider", "estados", "apurado"] as const;
export type MapMode = (typeof MAP_MODES)[number];
export const MAP_MODE_LABEL: Record<MapMode, string> = { lider: "Quem lidera", estados: "Por estado", apurado: "Apurado" };

export type PartyKey = "pt" | "pl" | "other";
export const partyKey = (party: string): PartyKey => (party === "PT" ? "pt" : party === "PL" ? "pl" : "other");

/**
 * Palette tokens: `--map-{token}` in globals.css. Hatched tokens are drawn as a fill plus a
 * diagonal hatch, so a missing value never looks like a lighter colour (invariant 6).
 */
export type FillToken =
  | `${PartyKey}-${1 | 2 | 3 | 4}`
  | "tie"
  | "empty"
  | "waiting"
  | `counted-${1 | 2 | 3 | 4 | 5}`;
export const HATCHED: ReadonlySet<FillToken> = new Set(["waiting", "tie"]);

/** Margin breaks in basis points (the reference site's 10/25/45 points). */
export const MARGIN_BREAKS = [1000, 2500, 4500] as const;
export const marginStep = (bp: number): 1 | 2 | 3 | 4 =>
  bp < MARGIN_BREAKS[0] ? 1 : bp < MARGIN_BREAKS[1] ? 2 : bp < MARGIN_BREAKS[2] ? 3 : 4;
/** % of sections counted, basis points: < 25, 25–50, 50–75, 75–< 100, 100. */
export const countedStep = (bp: number): 1 | 2 | 3 | 4 | 5 =>
  bp >= 10_000 ? 5 : bp >= 7500 ? 4 : bp >= 5000 ? 3 : bp >= 2500 ? 2 : 1;

/** A UF's leader for "Por estado", from its TSE file; null when it has no numbers yet. */
export interface UfLeader {
  party: string;
  /** Ours: (first − second) / validWithSubJudice. */
  marginBp: number;
}

export interface MapStyle {
  /** Token → municipality indexes, in a fixed draw order. */
  buckets: Map<FillToken, number[]>;
  /** Municipalities whose last fetch failed: drawn with their last good colour plus a hatch. */
  failed: number[];
  /** Per municipality, its token (for the tooltip's swatch and tests). */
  tokenOf: FillToken[];
}

const S = RESULT_STATUS_CODE;

/** The token for a municipality that has no colour of its own in this mode. */
function missingToken(status: number): FillToken {
  return status === S.not_published || status === S.fetch_failed ? "waiting" : "empty";
}

export function styleFrame(
  mode: MapMode,
  frame: MapView,
  ufOf: readonly string[],
  ufLeaders: Readonly<Record<string, UfLeader | null>>,
): MapStyle {
  const tokenOf: FillToken[] = new Array(frame.count);
  const failed: number[] = [];
  for (let i = 0; i < frame.count; i++) {
    const status = frame.status[i]!;
    let token: FillToken;
    if (mode === "apurado") {
      const bp = frame.countedBp[i];
      token = bp === null || bp === undefined ? missingToken(status) : bp === 0 ? "empty" : `counted-${countedStep(bp)}`;
    } else if (mode === "estados") {
      const l = ufLeaders[ufOf[i]!];
      token = l ? `${partyKey(l.party)}-${marginStep(l.marginBp)}` : missingToken(status);
    } else {
      const leader = frame.leader[i]!;
      const margin = frame.marginBpCalc[i];
      if (leader >= 0 && margin !== null && margin !== undefined) {
        token = `${partyKey(frame.candidates[leader]!.party)}-${marginStep(margin)}`;
      } else if (leader === -1 && margin === 0) {
        token = "tie"; // an exact tie, not missing data (architecture.md §6.3)
      } else {
        token = missingToken(status);
      }
    }
    tokenOf[i] = token;
    if (status === S.fetch_failed && token !== "waiting") failed.push(i);
  }
  const buckets = new Map<FillToken, number[]>();
  tokenOf.forEach((t, i) => {
    const b = buckets.get(t);
    if (b) b.push(i);
    else buckets.set(t, [i]);
  });
  return { buckets, failed, tokenOf };
}

/** Municipalities led by each party in this frame (ours: labelled "contagem nossa"). */
export function leaderCounts(frame: MapView): { party: string; n: string; name: string; count: number }[] {
  const counts = new Map<number, number>();
  for (const l of frame.leader) if (l >= 0) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts]
    .map(([i, count]) => ({ ...frame.candidates[i]!, count }))
    .sort((a, b) => b.count - a.count || a.seq - b.seq)
    .map(({ party, n, name, count }) => ({ party, n, name, count }));
}

/** Exact ties (leader −1 with a zero margin), as the map draws them. */
export const tieCount = (frame: MapView) => frame.leader.filter((l, i) => l === -1 && frame.marginBpCalc[i] === 0).length;

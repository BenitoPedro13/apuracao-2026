// The leader and margin of a municipality from its vote columns, as the projector computes
// `map/president` (packages/views render.ts `leaderOf`): margin over vvc in basis points,
// 0 for an exact tie (leader −1), leader −1 with no votes.

export function leaderOfVotes(votes: readonly (number | null)[], vvc: number): { leader: number; marginBp: number } | null {
  let first = -1;
  let best = -1;
  let second = -1;
  votes.forEach((v, i) => {
    if (v === null) return;
    if (v > best) {
      second = best;
      best = v;
      first = i;
    } else if (v > second) second = v;
  });
  if (vvc <= 0 || best <= 0) return null;
  if (best === second) return { leader: -1, marginBp: 0 };
  return { leader: first, marginBp: Math.round(((best - Math.max(second, 0)) * 10_000) / vvc) };
}

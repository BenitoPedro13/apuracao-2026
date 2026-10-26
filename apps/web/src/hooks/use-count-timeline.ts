"use client";

import { useQuery } from "@tanstack/react-query";
import type { CountTimeline } from "@apuracao/contracts";
import { ELECTIONS } from "@apuracao/tse/codes";
import { displayName } from "@/lib/format";
import { partyColor } from "@/lib/party";
import { countTimelineQuery, isCountTimelineId } from "@/timeline/queries";
import { useManifest } from "./use-data";

// "Ao longo da apuração" (TASK-over-the-count.md §2.3): the rules in one place. Every share
// here is ours (a candidate's votes over the valid votes of the same TSE file). Between two
// points the value is the earlier point's, because that's what the TSE showed until its next
// file. Nothing is interpolated, and nothing is drawn across a gap or after the last point.

export interface CountPoint {
  /** % of sections totalized, 0–100. */
  x: number;
  /** Share of valid votes, 0–1. */
  y: number;
  at: string;
  /** The line doesn't join this point to the previous one (a gap in our record). */
  breakBefore: boolean;
}

export interface CountSeries {
  key: string;
  name: string;
  year: number;
  color: string;
  dashed: boolean;
  points: CountPoint[];
}

export interface OverTheCount {
  year: number;
  /** The comparison's year, when there is one. */
  pastYear: number | null;
  /** This year's series first, then the comparison's. */
  series: CountSeries[];
  /** Where this year's lead changed: the first point after the change, on the 50% line. */
  leadChanges: number[];
  /** The last point's TSE instant and % of sections. */
  until: { at: string; x: number };
}

const yearRound = (t: CountTimeline) => `${t.year}-${t.round}t`;

function toSeries(t: CountTimeline, dashed: boolean): CountSeries[] {
  const breaks = t.at.map((at, k) => k > 0 && t.gaps.some((g) => Date.parse(g.from) < Date.parse(at) && Date.parse(g.to) > Date.parse(t.at[k - 1]!)));
  return t.candidates.map((c, i) => {
    const points: CountPoint[] = [];
    let broken = false;
    t.at.forEach((at, k) => {
      broken ||= breaks[k]!;
      // No valid votes yet: no share (missing, not zero; invariant 6).
      if (t.valid[k] === 0) return;
      points.push({ x: (t.sections[k]! / t.sectionsTotal) * 100, y: t.votes[i]![k]! / t.valid[k]!, at, breakBefore: broken && points.length > 0 });
      broken = false;
    });
    return { key: `${yearRound(t)}-${c.n}`, name: displayName(c.name), year: t.year, color: partyColor(c.party), dashed, points };
  });
}

/** The series' value at `x`% of sections: its last point at or before x; null before its first, after its last, or in a gap. */
export function valueAt(s: CountSeries, x: number): number | null {
  let k = -1;
  for (let i = 0; i < s.points.length && s.points[i]!.x <= x; i++) k = i;
  if (k < 0) return null;
  const next = s.points[k + 1];
  if (next?.breakBefore) return null;
  if (!next && x > s.points[k]!.x) return null;
  return s.points[k]!.y;
}

function leadChanges(t: CountTimeline): number[] {
  if (t.candidates.length !== 2) return [];
  const out: number[] = [];
  let lead: number | null = null;
  t.at.forEach((_, k) => {
    const [a, b] = [t.votes[0]![k]!, t.votes[1]![k]!];
    if (t.valid[k] === 0 || a === b) return;
    const now = a > b ? 0 : 1;
    if (lead !== null && now !== lead) out.push((t.sections[k]! / t.sectionsTotal) * 100);
    lead = now;
  });
  return out;
}

/**
 * The selected round's count and the 2022 round of the same number, when both ship with the
 * site. null for any round without a series (the 1st round, governors, legislative).
 */
export function useOverTheCount(): { data: OverTheCount | null; isLoading: boolean } {
  const manifest = useManifest();
  const president = manifest.data?.elections.president;
  const round = president === ELECTIONS.federal2 ? 2 : president === ELECTIONS.federal1 ? 1 : null;
  const id = round ? `2026-${round}t` : "";
  const pastId = round ? `2022-${round}t` : "";
  const current = useQuery({ ...countTimelineQuery(isCountTimelineId(id) ? id : "2022-2t"), enabled: isCountTimelineId(id) });
  const past = useQuery({ ...countTimelineQuery(isCountTimelineId(pastId) ? pastId : "2022-2t"), enabled: isCountTimelineId(pastId) });
  if (!isCountTimelineId(id)) return { data: null, isLoading: manifest.isLoading };
  const t = current.data;
  if (!t || (isCountTimelineId(pastId) && past.isPending)) return { data: null, isLoading: true };
  const p = isCountTimelineId(pastId) ? (past.data ?? null) : null;
  const last = t.at.length - 1;
  return {
    data: {
      year: t.year,
      pastYear: p?.year ?? null,
      series: [...toSeries(t, false), ...(p ? toSeries(p, true) : [])],
      leadChanges: leadChanges(t),
      until: { at: t.at[last]!, x: (t.sections[last]! / t.sectionsTotal) * 100 },
    },
    isLoading: false,
  };
}

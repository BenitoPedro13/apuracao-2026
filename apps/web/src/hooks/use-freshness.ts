"use client";

import { useEffect, useState } from "react";
import { freshness, type Freshness } from "@/data/rules";
import { usePointer, useResult, useSelectedRound } from "./use-data";

/** The clock, re-read every `intervalMs`: an Effect synchronizing with an external system. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface FreshnessState extends Freshness {
  refreshedAt: string;
  /** The TSE's own totalization time of the national file; null before it's published. */
  tseTotalizedAt: string | null;
  /** The last pointer fetch failed (the shown data is the last good one). */
  pointerError: Error | null;
}

/** "Atualizado às …" with amber/red escalation (architecture.md §6.4). null until the first pointer. */
export function useFreshness(): FreshnessState | null {
  const now = useNow(15_000);
  const pointer = usePointer();
  const { selected } = useSelectedRound();
  const national = useResult("president", "br");
  const snap = pointer.data;
  if (!snap) return null;
  const f = freshness(snap, now, { live: selected?.live ?? true, nationalStatus: national.data?.status });
  return {
    ...f,
    refreshedAt: snap.pointer.refreshedAt,
    tseTotalizedAt: national.data?.tse?.totalizedAt ?? null,
    pointerError: pointer.error,
  };
}

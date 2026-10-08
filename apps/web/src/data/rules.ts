import type { EpochsIndex, LatestPointer, ResultStatus, ResultView } from "@apuracao/contracts";
import { ELECTIONS } from "@apuracao/tse/codes";
import type { ManifestRef, PointerSnapshot } from "./queries";

// Business rules, once (global frontend rules: hooks carry them, components don't).
// Pure functions so they're tested against the real published views.

type Candidate = ResultView["candidates"][number];

/** Most votes first; the TSE's own `seq` breaks a tie. */
export function byVotes(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => b.votes - a.votes || a.seq - b.seq);
}

export interface Difference {
  votes: number;
  /** Over `validWithSubJudice` (the TSE's `pvap` denominator), basis points, rounded half up. */
  bp: number;
}

/** Ours, not the TSE's: always labelled "calculado" where shown (architecture.md §7.1). */
export function difference(first: Candidate, second: Candidate, validWithSubJudice: number): Difference | null {
  if (validWithSubJudice <= 0) return null;
  const votes = first.votes - second.votes;
  return { votes, bp: Math.round((votes * 10_000) / validWithSubJudice) };
}

/**
 * Whether a unit's numbers are shown (architecture.md §7.2, invariant 6): counting and
 * final; fetch_failed with its last good file (dimmed). Never no_sections (its zeros are
 * hidden behind "0 seções apuradas") or not_published.
 */
export function hasNumbers(unit: { status: ResultStatus; votes: unknown }): boolean {
  if (unit.votes === null) return false;
  return unit.status === "counting" || unit.status === "final" || unit.status === "fetch_failed";
}

// --- Freshness (architecture.md §6.4) --------------------------------------------------

export const AMBER_AFTER_MS = 3 * 60_000;
export const RED_AFTER_MS = 10 * 60_000;

export type FreshnessLevel = "ok" | "amber" | "red" | "final" | "past";

export interface Freshness {
  level: FreshnessLevel;
  /** Age of the pointer's last refresh (the pipeline's heartbeat), on the server's clock. */
  ageMs: number;
  /** Age of the recorder's newest segment; null if it never reported. */
  recorderAgeMs: number | null;
  /** Why it's amber/red, in Portuguese; null when ok. */
  reason: string | null;
}

/**
 * The pointer is rewritten every 60 s even when the TSE is quiet, so its `refreshedAt`
 * measures the pipeline, not the TSE: amber after 3 min, red after 10. A stale recorder
 * heartbeat escalates the same way. A final result, or a past round, has nothing left to
 * update, so it is never amber or red.
 */
export function freshness(
  snap: PointerSnapshot,
  now: number,
  opts: { live: boolean; nationalStatus: ResultStatus | undefined },
): Freshness {
  const serverNow = snap.serverNow + (now - snap.localNow);
  const ageMs = Math.max(0, serverNow - Date.parse(snap.pointer.refreshedAt));
  const seen = snap.pointer.health.recorderSeenAt;
  const recorderAgeMs = seen ? Math.max(0, serverNow - Date.parse(seen)) : null;
  if (!opts.live) return { level: "past", ageMs, recorderAgeMs, reason: null };
  if (opts.nationalStatus === "final") return { level: "final", ageMs, recorderAgeMs, reason: null };

  const worst = Math.max(ageMs, recorderAgeMs ?? 0);
  const level: FreshnessLevel = worst >= RED_AFTER_MS ? "red" : worst >= AMBER_AFTER_MS ? "amber" : "ok";
  if (level === "ok") return { level, ageMs, recorderAgeMs, reason: null };
  const reason =
    ageMs >= recorderAgeMs!
      ? "a publicação dos resultados está parada"
      : "a coleta dos arquivos do TSE está sem sinal";
  return { level, ageMs, recorderAgeMs, reason };
}

// --- Rounds (TASK-web-shell-and-data-hooks.md §2.3) -------------------------------------

export interface Round {
  epoch: string;
  label: string;
  /** Follows the pointer (vs. a past round's fixed manifest). */
  live: boolean;
  ref: ManifestRef | null;
}

/** For a pointer epoch the index doesn't list yet: from its manifest's president election. */
export function labelFor(president: string | undefined): string {
  if (president === ELECTIONS.federal1) return "1º turno";
  if (president === ELECTIONS.federal2) return "2º turno";
  return "Apuração atual";
}

/**
 * The rounds the selector offers: every listed epoch with a fixed manifest, plus the
 * pointer's epoch (live) even if the index is missing or stale. The requested epoch wins
 * when offered; otherwise the live one.
 */
export function resolveRounds(
  pointer: LatestPointer,
  index: EpochsIndex | null,
  requested: string | null,
  /** The live manifest's president election code, once loaded. */
  livePresident?: string,
): { rounds: Round[]; selected: Round } {
  const live: Round = {
    epoch: pointer.epoch,
    label: index?.epochs.find((e) => e.epoch === pointer.epoch)?.label ?? labelFor(livePresident),
    live: true,
    ref: { epoch: pointer.epoch, seq: pointer.seq, sha: pointer.manifest },
  };
  const rounds: Round[] = [];
  for (const e of index?.epochs ?? []) {
    if (e.epoch === pointer.epoch) rounds.push(live);
    else if (e.manifest) rounds.push({ epoch: e.epoch, label: e.label, live: false, ref: { epoch: e.epoch, ...e.manifest } });
  }
  if (!rounds.includes(live)) rounds.push(live);
  const selected = rounds.find((r) => r.epoch === requested) ?? live;
  return { rounds, selected };
}

import type { Observation } from '@apuracao/contracts';
import { classify, cmp, type FileData, type ViewsConfig } from './model.js';
import type { Prepared } from './prepare.js';

// The fold (architecture.md §5.3, TASK §2.2). The state depends only on the *set* of
// observations folded, never on their order: acceptance is by (idg, earliest fetchedAt,
// sha256) and fetch health by the greatest observation key. So a rebuild equals the live
// projection whatever order segments are listed in, and folding twice changes nothing.

export interface Accepted {
  idg: number;
  sha256: string;
  fetchedAt: string;
  data: FileData;
}

export interface Health {
  /** Sortable total order over observations (see healthKey). */
  key: string;
  kind: 'ok' | 'error' | 'absent';
  at: string;
}

export interface PathEntry {
  accepted?: Accepted;
  health?: Health;
}

export interface ViewState {
  v: 1;
  paths: Record<string, PathEntry>;
  /** fetchedAt of the newest observation folded (the manifest's publishedAt). */
  newestAt: string | null;
}

export const emptyState = (): ViewState => ({ v: 1, paths: {}, newestAt: null });

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Total order over observations: fetchedAt, then recorder, lease generation, cycle, position. */
export function healthKey(o: Observation): string {
  return [pad(Date.parse(o.fetchedAt), 15), o.recorder, pad(o.leaseGeneration, 10), pad(o.cycleNo, 10), pad(o.seqInCycle, 8)].join('|');
}

const HEALTH: Record<Observation['kind'], Health['kind']> = { version: 'ok', recovered: 'ok', error: 'error', absent: 'absent' };

/** Would `candidate` replace `current` as the accepted version of a path? */
function wins(candidate: Omit<Accepted, 'data'>, current: Accepted | undefined): boolean {
  if (!current) return true;
  if (candidate.idg !== current.idg) return candidate.idg > current.idg;
  if (candidate.sha256 === current.sha256) return false;
  // Same idg, different bytes (anomaly, §4.4): keep the earliest seen; sha breaks a tie.
  const t = Date.parse(candidate.fetchedAt) - Date.parse(current.fetchedAt);
  return t !== 0 ? t < 0 : candidate.sha256 < current.sha256;
}

/**
 * Does folding this observation need its blob? False for anything that can't change the
 * accepted version (not folded, not a version, same bytes, lower idg), which saves the GET.
 */
export function needsBlob(state: ViewState, o: Observation, cfg: ViewsConfig): boolean {
  if (o.kind !== 'version' || !o.sha256 || !classify(o.path, cfg)) return false;
  const cur = state.paths[o.path]?.accepted;
  if (!cur) return true;
  if (cur.sha256 === o.sha256) return false;
  return o.idg === undefined || !/^\d+$/.test(o.idg) || Number(o.idg) >= cur.idg;
}

export interface FoldResult {
  changed: boolean;
  /** A version whose blob failed re-verification or re-parsing (excluded from views). */
  rejected?: string;
}

/**
 * Fold one observation, with its prepared blob when `needsBlob` said so. Mutates `state`
 * (11k paths; copying per observation would dominate a rebuild).
 */
export function fold(state: ViewState, o: Observation, cfg: ViewsConfig, prepared?: Prepared): FoldResult {
  const role = classify(o.path, cfg);
  if (!role) return { changed: false };
  let changed = false;
  if (state.newestAt === null || Date.parse(o.fetchedAt) > Date.parse(state.newestAt)) {
    // Not a view change on its own: only the manifest reads it.
    state.newestAt = o.fetchedAt;
  }
  const entry = (state.paths[o.path] ??= {});

  const key = healthKey(o);
  if (!entry.health || cmp(key, entry.health.key) > 0) {
    const kind = HEALTH[o.kind];
    const before = entry.health;
    entry.health = { key, kind, at: o.fetchedAt };
    // Only a change of kind (or of when an error started) changes a view.
    if (!before || before.kind !== kind || (kind !== 'ok' && before.at !== o.fetchedAt)) changed = true;
  }

  if (prepared) {
    if (!prepared.ok) return { changed, rejected: prepared.reason };
    if (prepared.sha256 !== o.sha256) return { changed, rejected: 'blob sha256 does not match the observation' };
    const candidate = { idg: prepared.idg, sha256: prepared.sha256, fetchedAt: o.fetchedAt };
    if (wins(candidate, entry.accepted)) {
      entry.accepted = { ...candidate, data: prepared.data };
      changed = true;
    }
  }
  return { changed };
}

import { tseInstant, type TseCoverageFile } from '@apuracao/contracts';

// Tier-1 → tier-2 change detection (architecture.md §4.2): a municipality whose (dt, ht)
// or sections counted changed since the previous accepted coverage version is re-fetched.

export interface CoverageRowKey {
  key: string;
  /** dt/ht as ISO, the instant the -u file must at least reach. */
  instant?: string;
}

/** Municipality rows of a coverage file, by TSE municipality code. */
export function indexCoverage(file: TseCoverageFile): Record<string, CoverageRowKey> {
  const out: Record<string, CoverageRowKey> = {};
  for (const row of file.abr) {
    if (row.tpabr !== 'mun') continue;
    out[row.cdabr] = {
      key: `${row.dt ?? ''}|${row.ht ?? ''}|${row.s.st}`,
      instant: row.dt && row.ht ? tseInstant(row.dt, row.ht) : undefined,
    };
  }
  return out;
}

export function changedMunicipalities(
  previous: Record<string, CoverageRowKey> | undefined,
  next: Record<string, CoverageRowKey>,
): { mu: string; instant?: string }[] {
  return Object.entries(next)
    .filter(([mu, row]) => previous?.[mu]?.key !== row.key)
    .map(([mu, row]) => ({ mu, instant: row.instant }));
}

/**
 * The coverage index after one more signed, schema-valid version, accepted or not: each row is
 * kept from whichever version has its latest instant. On 2026-10-25 the TSE published BA's
 * 23:27 coverage with a lower idg than an earlier one, so the accepted-only index never saw
 * Salvador's 23:21 row and the municipality was never re-fetched. Rows only move forward, so
 * the order versions arrive in doesn't matter. `changed`: the rows that moved.
 */
export function mergeCoverage(
  previous: Record<string, CoverageRowKey> | undefined,
  next: Record<string, CoverageRowKey>,
): { index: Record<string, CoverageRowKey>; changed: { mu: string; instant?: string }[] } {
  const index = { ...previous };
  const changed: { mu: string; instant?: string }[] = [];
  for (const [mu, row] of Object.entries(next)) {
    const p = index[mu];
    const later = !p || (row.instant ?? '') > (p.instant ?? '') || (row.instant === p.instant && row.key !== p.key);
    if (!later) continue;
    index[mu] = row;
    changed.push({ mu, instant: row.instant });
  }
  return { index, changed };
}

/**
 * A tier-2 file still older than its trigger (TASK-recorder-stuck-municipal.md): the first
 * `fastTries` on its Expires, then every `STUCK_RETRY_S` for `slowTries` more, then give up.
 * On 2026-10-25 the CDN served 224 municipal files stale for all 5 fast tries; once a
 * municipality is final its coverage row never changes again, so dropping it lost it.
 */
export function pendingPlan(tries: number, cfg: { fastTries: number; slowTries: number }): 'fast' | 'slow' | 'give-up' {
  if (tries < cfg.fastTries) return 'fast';
  if (tries < cfg.fastTries + cfg.slowTries) return 'slow';
  return 'give-up';
}

/**
 * Municipalities whose coverage row says the TSE has totalized later than the version we
 * accepted (or we never recorded when): what a start-up sweep must re-fetch. `stateOf` maps a
 * municipality code to its file's accepted `totalizedAt` (undefined: none recorded).
 */
export function staleMunicipal(
  rows: Record<string, CoverageRowKey>,
  stateOf: (mu: string) => { totalizedAt?: string } | undefined,
): { mu: string; instant: string }[] {
  const out: { mu: string; instant: string }[] = [];
  for (const [mu, row] of Object.entries(rows)) {
    if (!row.instant) continue;
    const at = stateOf(mu)?.totalizedAt;
    if (at === undefined || at < row.instant) out.push({ mu, instant: row.instant });
  }
  return out;
}

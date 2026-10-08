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

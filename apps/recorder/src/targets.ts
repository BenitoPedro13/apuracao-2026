import { ABROAD, GOVERNOR_RUNOFF_UFS, OFFICES, UFS, coveragePath, municipalityIndexPath, resultPath, type Area } from '@apuracao/tse';
import type { Target } from './config.js';

export type Tier = 0 | 1 | 2;

export interface TrackedFile {
  path: string;
  tier: Tier;
  target: Target;
  /** Coverage files trigger tier-2 fetches of their municipalities. */
  kind: 'config' | 'coverage' | 'aggregate' | 'municipal';
  /** National files keep polling while the breaker is open. */
  national: boolean;
}

/** Areas with files for a target (research 01 §3–4, 02 §4). */
export function areasOf(target: Target): Area[] {
  if (target.office === OFFICES.president) return ['br', ...UFS, ABROAD];
  // Senate and deputies: UF files only (TASK-legislative-archive.md §1.1).
  if (target.office === OFFICES.stateDeputy) return UFS.filter((uf) => uf !== 'df');
  if (target.office === OFFICES.districtDeputy) return ['df'];
  if (target.office !== OFFICES.governor) return [...UFS];
  // Governor: all 27 UFs in the 1st round, the 7 runoff UFs in the 2nd.
  return target.election === '6260' ? [...GOVERNOR_RUNOFF_UFS] : [...UFS];
}

/** The two files whose appearance means "this election is live" (TASK-recorder.md §2.1). */
export function probePaths(target: Target): string[] {
  if (target.ufOnly) return [resultPath(target.election, target.office, target.office === OFFICES.districtDeputy ? 'df' : 'sp')];
  const area: Area = target.office === OFFICES.president ? 'br' : 'rj';
  return [resultPath(target.election, target.office, area), coveragePath(target.election, area)];
}

export function configFiles(target: Target): TrackedFile[] {
  if (target.ufOnly) return [];
  return [{ path: municipalityIndexPath(target.election), tier: 0, target, kind: 'config', national: false }];
}

export function tier1Files(target: Target): TrackedFile[] {
  return areasOf(target).flatMap((area): TrackedFile[] => [
    ...(target.ufOnly ? [] : [{ path: coveragePath(target.election, area), tier: 1 as const, target, kind: 'coverage' as const, national: area === 'br' }]),
    { path: resultPath(target.election, target.office, area), tier: 1, target, kind: 'aggregate', national: area === 'br' },
  ]);
}

export function municipalFile(target: Target, area: Area, mu: string): TrackedFile {
  return { path: resultPath(target.election, target.office, area, mu), tier: 2, target, kind: 'municipal', national: false };
}

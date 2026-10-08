import { ABROAD, GOVERNOR_RUNOFF_UFS, UFS, coveragePath, municipalityIndexPath, resultPath, type Area } from '@apuracao/tse';
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
  if (target.office === 1) return ['br', ...UFS, ABROAD];
  // Governor: all 27 UFs in the 1st round, the 7 runoff UFs in the 2nd.
  return target.election === '6260' ? [...GOVERNOR_RUNOFF_UFS] : [...UFS];
}

/** The two files whose appearance means "this election is live" (TASK-recorder.md §2.1). */
export function probePaths(target: Target): string[] {
  const area: Area = target.office === 1 ? 'br' : 'rj';
  return [resultPath(target.election, target.office, area), coveragePath(target.election, area)];
}

export function configFiles(target: Target): TrackedFile[] {
  return [{ path: municipalityIndexPath(target.election), tier: 0, target, kind: 'config', national: false }];
}

export function tier1Files(target: Target): TrackedFile[] {
  return areasOf(target).flatMap((area): TrackedFile[] => [
    { path: coveragePath(target.election, area), tier: 1, target, kind: 'coverage', national: area === 'br' },
    { path: resultPath(target.election, target.office, area), tier: 1, target, kind: 'aggregate', national: area === 'br' },
  ]);
}

export function municipalFile(target: Target, area: Area, mu: string): TrackedFile {
  return { path: resultPath(target.election, target.office, area, mu), tier: 2, target, kind: 'municipal', national: false };
}

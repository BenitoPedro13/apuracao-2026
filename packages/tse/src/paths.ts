import type { FileType, Scope } from '@apuracao/contracts';
import { ABROAD, CYCLE, ELECTION_CODES, UFS, type Election } from './codes.js';

// File paths relative to TSE_BASE_URL. Naming from research 01 §4, verified on the 1st
// round. `[VERIFY: 2nd-round files (6258/6260) use the same naming. Re-check from 10-20]`

export type Ext = 'jws' | 'json';
/** `br`, a UF, or `zz` (abroad). */
export type Area = 'br' | (typeof UFS)[number] | typeof ABROAD;

const pad = (n: number | string, width: number) => String(n).padStart(width, '0');
const e6 = (election: Election) => `e${pad(election, 6)}`;
const c4 = (office: number) => `c${pad(office, 4)}`;

export function catalogPath(ext: Ext = 'jws'): string {
  return `comum/config/ele-c.${ext}`;
}

export function municipalityIndexPath(election: Election, ext: Ext = 'jws'): string {
  return `${CYCLE}/${election}/config/mun-${e6(election)}-cm.${ext}`;
}

/** `-u` results for `area`, or for municipality `mu` (5-digit TSE code) inside it. */
export function resultPath(
  election: Election,
  office: number,
  area: Area,
  mu?: string,
  ext: Ext = 'jws',
): string {
  if (mu !== undefined && (area === 'br' || !/^\d{5}$/.test(mu))) {
    throw new Error(`invalid municipality ${area}/${mu}`);
  }
  return `${CYCLE}/${election}/dados/${area}/${area}${mu ?? ''}-${c4(office)}-${e6(election)}-u.${ext}`;
}

/** `-ab` coverage for `area`. */
export function coveragePath(election: Election, area: Area, ext: Ext = 'jws'): string {
  return `${CYCLE}/${election}/dados/${area}/${area}-${e6(election)}-ab.${ext}`;
}

export interface PathInfo {
  fileType: FileType;
  ext: Ext;
  election?: Election;
  office?: number;
  scope?: Scope;
}

const AREAS = new Set<string>(['br', ...UFS, ABROAD]);
const isElection = (s: string): s is Election => (ELECTION_CODES as readonly string[]).includes(s);

const RE_CATALOG = /^comum\/config\/ele-c\.(jws|json)$/;
const RE_INDEX = /^ele2026\/(\d{4})\/config\/mun-e(\d{6})-cm\.(jws|json)$/;
const RE_RESULT = /^ele2026\/(\d{4})\/dados\/([a-z]{2})\/([a-z]{2})(\d{5})?-c(\d{4})-e(\d{6})-u\.(jws|json)$/;
const RE_COVERAGE = /^ele2026\/(\d{4})\/dados\/([a-z]{2})\/([a-z]{2})-e(\d{6})-ab\.(jws|json)$/;

function areaScope(area: string, mu: string | undefined): Scope {
  if (mu !== undefined) return { level: 'mu', uf: area, mu };
  if (area === 'br') return { level: 'br' };
  if (area === ABROAD) return { level: 'zz', uf: ABROAD };
  return { level: 'uf', uf: area };
}

/**
 * Classify a TSE path (the identity used by Observation). Throws on anything it can't
 * classify: a query string, an unknown election, a directory/file mismatch.
 */
export function parsePath(path: string): PathInfo {
  let m: RegExpExecArray | null;
  if ((m = RE_CATALOG.exec(path))) return { fileType: 'c', ext: m[1] as Ext };

  if ((m = RE_INDEX.exec(path))) {
    const [, ele, ele6, ext] = m as unknown as [string, string, string, Ext];
    if (isElection(ele) && Number(ele6) === Number(ele)) {
      return { fileType: 'cm', ext, election: ele };
    }
  }

  if ((m = RE_RESULT.exec(path))) {
    const [, ele, dir, area, mu, office, ele6, ext] = m as unknown as [
      string, string, string, string, string | undefined, string, string, Ext,
    ];
    if (isElection(ele) && Number(ele6) === Number(ele) && dir === area && AREAS.has(area) && !(area === 'br' && mu)) {
      return { fileType: 'u', ext, election: ele, office: Number(office), scope: areaScope(area, mu) };
    }
  }

  if ((m = RE_COVERAGE.exec(path))) {
    const [, ele, dir, area, ele6, ext] = m as unknown as [string, string, string, string, string, Ext];
    if (isElection(ele) && Number(ele6) === Number(ele) && dir === area && AREAS.has(area)) {
      return { fileType: 'ab', ext, election: ele, scope: areaScope(area, undefined) };
    }
  }

  throw new Error(`unrecognised TSE path: ${path}`);
}

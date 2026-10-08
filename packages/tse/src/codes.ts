// TSE codes for 2026 (research 01 §3, from ele-c.json). Nothing here is inferred.

export const CYCLE = 'ele2026';
export const TSE_BASE_URL = 'https://resultados.tse.jus.br/oficial/';

export const ELECTIONS = {
  federal1: '6257', // president, 1st round
  federal2: '6258', // president, 2nd round
  state1: '6259', // governor, senate, deputies, 1st round
  state2: '6260', // governor, 2nd round
} as const;
export type Election = (typeof ELECTIONS)[keyof typeof ELECTIONS];
export const ELECTION_CODES: readonly Election[] = Object.values(ELECTIONS);

export const OFFICES = { president: 1, governor: 3 } as const;

export const UFS = [
  'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa',
  'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
] as const;
export type Uf = (typeof UFS)[number];
/** Abroad. Has its own `-u`/`-ab` files and municipalities (foreign cities). */
export const ABROAD = 'zz';

/** UFs with a governor 2nd round on 2026-10-25 (research 01 §1). */
export const GOVERNOR_RUNOFF_UFS = ['ac', 'am', 'df', 'es', 'rj', 'rn', 'to'] as const satisfies readonly Uf[];

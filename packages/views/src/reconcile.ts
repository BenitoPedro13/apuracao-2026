import type { Office } from '@apuracao/contracts';
import { ABROAD, OFFICES, UFS, municipalityIndexPath, resultPath, type Area, type Election } from '@apuracao/tse';
import type { PathEntry, ViewState } from './fold.js';
import type { IndexData, LegislativeData, ResultData, ViewsConfig } from './model.js';
import { statusOf } from './render.js';

// Reconciliation (architecture.md §7.4) as a pure function. It reports drift and never
// blocks a publish. The headline always comes from the TSE's national file.

export interface IdentityFailure {
  path: string;
  check: string;
}

export interface SumCheck {
  office: Office;
  /** The file the parts should add up to: 'br', a UF or 'zz'. */
  area: string;
  parts: 'ufs' | 'municipalities';
  /** Parts without an accepted file. */
  missing: number;
  /**
   * Only comparable when nothing is missing and every file is final or all share one
   * totalization instant: during the count, files are generated at different moments.
   */
  comparable: boolean;
  /** Σ |parts − whole| over the candidates and vvc. 0 = exact. */
  absDiff: number;
  /** Ballot numbers whose sum differs (and 'vvc'). */
  mismatched: string[];
}

export interface ReconcileReport {
  identityFailures: IdentityFailure[];
  sums: SumCheck[];
}

/** The identities of research 02 §8 inside one file. */
export function fileIdentities(d: ResultData): string[] {
  const failed: string[] = [];
  const sumAll = d.cand.reduce((a, c) => a + c.votes, 0);
  if (d.v.vvc !== d.v.vv + d.v.van + d.v.vansj) failed.push('vvc = vv + van + vansj');
  if (sumAll !== d.v.vvc) failed.push('Σ cand = vvc');
  if (d.cand.every((c) => c.destination !== null)) {
    const sumValid = d.cand.filter((c) => c.destination === 'Válido').reduce((a, c) => a + c.votes, 0);
    if (sumValid !== d.v.vv) failed.push('Σ cand(Válido) = vv');
  }
  if (d.v.tv !== d.v.vvc + d.v.vb + d.v.tvn) failed.push('tv = vvc + vb + tvn');
  if (d.v.tvn !== d.v.vn + d.v.vnt) failed.push('tvn = vn + vnt');
  if (d.s.st > d.s.ts) failed.push('st ≤ ts');
  return failed;
}

/** Senate and deputies (TASK-legislative-archive.md §1.1, §2.3): the seats and the party totals add up. */
export function legislativeIdentities(d: LegislativeData): string[] {
  const failed: string[] = [];
  if (d.nv !== null && d.parties.reduce((a, p) => a + p.seats, 0) !== d.nv) failed.push('Σ party seats = nv');
  if (d.parties.reduce((a, p) => a + p.nominal + (p.label ?? 0), 0) !== d.v.vv) failed.push('Σ party (tvtn + tvtl) = vv');
  if (d.vnom + (d.vl ?? 0) !== d.v.vv) failed.push('vnom + vl = vv');
  if (d.v.tv !== d.v.vvc + d.v.vb + d.v.tvn) failed.push('tv = vvc + vb + tvn');
  if (d.s.st > d.s.ts) failed.push('st ≤ ts');
  return failed;
}

const resultOf = (e: PathEntry | undefined) => (e?.accepted?.data.kind === 'result' ? (e.accepted.data as ResultData) : undefined);

function sumCheck(office: Office, area: string, parts: 'ufs' | 'municipalities', whole: PathEntry | undefined, partEntries: (PathEntry | undefined)[]): SumCheck {
  const w = resultOf(whole);
  const ps = partEntries.map(resultOf);
  const present = ps.filter((p): p is ResultData => p !== undefined);
  const missing = ps.length - present.length + (w ? 0 : 1);
  const all = [whole, ...partEntries];
  const allFinal = all.every((e) => statusOf(e) === 'final');
  const instants = new Set([w, ...present].map((d) => d?.totalizedAt));
  const comparable = missing === 0 && (allFinal || instants.size === 1);
  let absDiff = 0;
  const mismatched: string[] = [];
  if (w) {
    for (const c of w.cand) {
      const s = present.reduce((a, p) => a + (p.cand.find((x) => x.n === c.n)?.votes ?? 0), 0);
      if (s !== c.votes) {
        absDiff += Math.abs(s - c.votes);
        mismatched.push(c.n);
      }
    }
    const vvc = present.reduce((a, p) => a + p.v.vvc, 0);
    if (vvc !== w.v.vvc) {
      absDiff += Math.abs(vvc - w.v.vvc);
      mismatched.push('vvc');
    }
  }
  return { office, area, parts, missing, comparable, absDiff, mismatched };
}

export function reconcile(state: ViewState, cfg: ViewsConfig): ReconcileReport {
  const identityFailures: IdentityFailure[] = [];
  for (const path of Object.keys(state.paths).sort()) {
    const d = resultOf(state.paths[path]);
    if (d) for (const check of fileIdentities(d)) identityFailures.push({ path, check });
    const l = state.paths[path]?.accepted?.data;
    if (l?.kind === 'legislative') for (const check of legislativeIdentities(l)) identityFailures.push({ path, check });
  }

  const sums: SumCheck[] = [];
  const pres = cfg.elections.president as Election;
  const presPath = (area: string, mu?: string) => resultPath(pres, OFFICES.president, area as Area, mu);
  sums.push(sumCheck('president', 'br', 'ufs', state.paths[presPath('br')], [...UFS, ABROAD].map((a) => state.paths[presPath(a)])));

  for (const office of ['president', 'governor'] as const) {
    const election = cfg.elections[office] as Election;
    const idx = state.paths[municipalityIndexPath(election)]?.accepted?.data;
    if (idx?.kind !== 'index') continue;
    const areas = office === 'president' ? [...UFS, ABROAD] : cfg.governorUfs;
    const code = office === 'president' ? OFFICES.president : OFFICES.governor;
    for (const area of areas) {
      const munis = (idx as IndexData).areas[area] ?? [];
      const whole = state.paths[resultPath(election, code, area as Area)];
      sums.push(sumCheck(office, area, 'municipalities', whole, munis.map((m) => state.paths[resultPath(election, code, area as Area, m.mu)])));
    }
  }
  return { identityFailures, sums };
}

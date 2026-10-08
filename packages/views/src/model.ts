import { tseInstant, type Elections, type Office, type TseCoverageFile, type TseMunicipalityIndex, type TseResultFile } from '@apuracao/contracts';
import { ABROAD, OFFICES, parsePath } from '@apuracao/tse';

// What the projector keeps per TSE file: a compact extract of the fields the views read,
// not the parsed file (~11k files × ~30 KB of parsed JSON would not fit a checkpoint).

export interface ViewsConfig {
  elections: Elections;
  /** UFs that get governor views (27 in the 1st round, GOVERNOR_RUNOFF_UFS on the night). */
  governorUfs: readonly string[];
}

/** The role a path plays in the views; null = not folded (TASK §2.4 item 8). */
export type PathRole =
  | { role: 'index'; office: Office }
  | { role: 'coverage' }
  | { role: 'result'; office: Office; area: string; mu?: string };

export function classify(path: string, cfg: ViewsConfig): PathRole | null {
  let info;
  try {
    info = parsePath(path);
  } catch {
    return null;
  }
  const { president, governor } = cfg.elections;
  if (info.fileType === 'cm') {
    if (info.election === president) return { role: 'index', office: 'president' };
    if (info.election === governor) return { role: 'index', office: 'governor' };
    return null;
  }
  if (info.fileType === 'ab') {
    return info.election === president && info.scope?.level === 'br' ? { role: 'coverage' } : null;
  }
  if (info.fileType !== 'u' || !info.scope) return null;
  let office: Office;
  if (info.election === president && info.office === OFFICES.president) office = 'president';
  else if (info.election === governor && info.office === OFFICES.governor) office = 'governor';
  else return null;
  const area = info.scope.level === 'br' ? 'br' : info.scope.uf!;
  if (office === 'governor' && (area === 'br' || area === ABROAD || !cfg.governorUfs.includes(area))) return null;
  return info.scope.mu ? { role: 'result', office, area, mu: info.scope.mu } : { role: 'result', office, area };
}

export interface Pct {
  raw: string;
}

export interface CandidateData {
  n: string;
  name: string;
  party: string;
  seq: number;
  votes: number;
  pct: Pct;
  elected: boolean;
  situation: string;
  destination: string | null;
}

export interface ResultData {
  kind: 'result';
  generatedAt: string;
  totalizedAt: string | null;
  tf: 's' | 'n';
  s: { ts: number; st: number; pst: Pct };
  e: { te: number; c: number; pc: Pct; a: number; pa: Pct };
  v: { tv: number; vv: number; vvc: number; van: number; vansj: number; vb: number; pvb: Pct; tvn: number; ptvn: Pct; vn: number; vnt: number };
  /** Sorted by TSE `seq`. */
  cand: CandidateData[];
}

export interface CoverageData {
  kind: 'coverage';
  /** UF and zz rows of the br coverage file. */
  rows: Record<string, { final: number; partial: number; notStarted: number }>;
}

export interface IndexEntry {
  mu: string;
  cdi: string | null;
  name: string;
  capital: boolean;
}

export interface IndexData {
  kind: 'index';
  /** Per UF (and zz), ascending TSE code. */
  areas: Record<string, IndexEntry[]>;
}

export type FileData = ResultData | CoverageData | IndexData;

const pct = (d: { raw: string }): Pct => ({ raw: d.raw });

export function extractResult(f: TseResultFile, office: Office): ResultData {
  const code = office === 'president' ? OFFICES.president : OFFICES.governor;
  const carg = f.carg.find((c) => Number(c.cd) === code);
  if (!carg) throw new Error(`no office ${code} in the file`);
  const cand: CandidateData[] = [];
  for (const agr of carg.agr) {
    for (const par of agr.par) {
      for (const c of par.cand) {
        cand.push({
          n: c.n,
          name: c.nmu,
          party: par.sg,
          seq: c.seq,
          votes: c.vap,
          pct: pct(c.pvap),
          elected: c.e === 's',
          situation: c.st,
          destination: c.dvt ?? null,
        });
      }
    }
  }
  cand.sort((a, b) => a.seq - b.seq || cmp(a.n, b.n));
  return {
    kind: 'result',
    generatedAt: tseInstant(f.dg, f.hg),
    totalizedAt: f.dt && f.ht ? tseInstant(f.dt, f.ht) : null,
    tf: f.tf,
    s: { ts: f.s.ts, st: f.s.st, pst: pct(f.s.pst) },
    e: { te: f.e.te, c: f.e.c, pc: pct(f.e.pc), a: f.e.a, pa: pct(f.e.pa) },
    v: {
      tv: f.v.tv,
      vv: f.v.vv,
      vvc: f.v.vvc,
      van: f.v.van,
      vansj: f.v.vansj,
      vb: f.v.vb,
      pvb: pct(f.v.pvb),
      tvn: f.v.tvn,
      ptvn: pct(f.v.ptvn),
      vn: f.v.vn,
      vnt: f.v.vnt,
    },
    cand,
  };
}

export function extractCoverage(f: TseCoverageFile): CoverageData {
  const rows: CoverageData['rows'] = {};
  for (const r of f.abr) {
    if (r.tpabr !== 'uf' || r.munf === undefined || r.munpt === undefined || r.munnr === undefined) continue;
    rows[r.cdabr] = { final: r.munf, partial: r.munpt, notStarted: r.munnr };
  }
  return { kind: 'coverage', rows };
}

export function extractIndex(f: TseMunicipalityIndex): IndexData {
  const areas: IndexData['areas'] = {};
  for (const a of f.abr) {
    areas[a.cd] = a.mu
      .map((m) => ({ mu: m.cd, cdi: m.cdi === '' ? null : m.cdi, name: m.nm, capital: m.c === 's' }))
      .sort((x, y) => cmp(x.mu, y.mu));
  }
  return { kind: 'index', areas };
}

/** Code-unit string comparison: locale-independent, so every machine sorts alike. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

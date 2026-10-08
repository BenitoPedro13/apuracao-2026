import { createHash } from 'node:crypto';
import {
  RESULT_STATUS_CODE,
  type CandidateHeader,
  type MapIndexView,
  type MapView,
  type MunicipalityRow,
  type MunicipalityView,
  type Office,
  type RegionsView,
  type ResultStatus,
  type ResultUnit,
  type ResultView,
} from '@apuracao/contracts';
import { ABROAD, OFFICES, UFS, coveragePath, municipalityIndexPath, resultPath, type Area, type Election } from '@apuracao/tse';
import { canonicalJson } from './canonical.js';
import type { PathEntry, ViewState } from './fold.js';
import { cmp, type CoverageData, type IndexData, type ResultData, type ViewsConfig } from './model.js';
import { REGIONS } from './regions.js';

// render(state) → named views (TASK §2.1). Deterministic: no wall clock, no randomness,
// sorted iteration, canonical JSON. Same state → byte-identical views.

const officeCode = (office: Office) => (office === 'president' ? OFFICES.president : OFFICES.governor);
const electionOf = (cfg: ViewsConfig, office: Office) => cfg.elections[office] as Election;

/** A unit's status (architecture.md §7.2) from its accepted file and fetch health. */
export function statusOf(entry: PathEntry | undefined): ResultStatus {
  const health = entry?.health?.kind;
  if (health === 'absent') return 'not_published';
  if (health === 'error') return 'fetch_failed';
  const data = entry?.accepted?.data;
  if (!data || data.kind !== 'result') return 'not_published';
  if (data.s.st === 0) return 'no_sections';
  if (data.s.st < data.s.ts) return 'counting';
  // `[VERIFY: tf/and values during a live count, on the first 2nd-round files]`
  return data.tf === 's' ? 'final' : 'counting';
}

/** The accepted result data a view may show: none once the TSE withdrew the file. */
function shown(entry: PathEntry | undefined): { data: ResultData; sha256: string } | undefined {
  const a = entry?.accepted;
  if (!a || a.data.kind !== 'result' || entry?.health?.kind === 'absent') return undefined;
  return { data: a.data, sha256: a.sha256 };
}

function unit(entry: PathEntry | undefined): ResultUnit {
  const status = statusOf(entry);
  const failingSince = status === 'fetch_failed' ? entry!.health!.at : null;
  const s = shown(entry);
  if (!s) return { status, failingSince, tse: null, sections: null, electorate: null, votes: null, candidates: [] };
  const d = s.data;
  return {
    status,
    failingSince,
    tse: { idg: String(entry!.accepted!.idg), generatedAt: d.generatedAt, totalizedAt: d.totalizedAt },
    sections: { total: d.s.ts, counted: d.s.st, countedPct: d.s.pst },
    electorate: { total: d.e.te, turnout: d.e.c, turnoutPct: d.e.pc, abstention: d.e.a, abstentionPct: d.e.pa },
    votes: {
      total: d.v.tv,
      valid: d.v.vv,
      validWithSubJudice: d.v.vvc,
      blank: d.v.vb,
      blankPct: d.v.pvb,
      null: d.v.tvn,
      nullPct: d.v.ptvn,
      subJudice: d.v.vansj,
    },
    candidates: d.cand.map((c) => ({ ...c })),
  };
}

/** Candidate columns: every candidate seen in any of the files, in TSE `seq` order. */
function headers(units: (ResultData | undefined)[]): CandidateHeader[] {
  const byN = new Map<string, CandidateHeader>();
  for (const u of units) for (const c of u?.cand ?? []) if (!byN.has(c.n)) byN.set(c.n, { n: c.n, name: c.name, party: c.party, seq: c.seq });
  return [...byN.values()].sort((a, b) => a.seq - b.seq || cmp(a.n, b.n));
}

/** Votes per header column; null for a candidate absent from the file. */
function columns(d: ResultData, hs: CandidateHeader[]) {
  const byN = new Map(d.cand.map((c) => [c.n, c]));
  return {
    votes: hs.map((h) => byN.get(h.n)?.votes ?? null),
    pct: hs.map((h) => {
      const c = byN.get(h.n);
      return c ? { raw: c.pct.raw } : null;
    }),
  };
}

/** Leader index (-1: none) and margin in basis points of vvc (§2.4 item 4). */
export function leaderOf(votes: (number | null)[], vvc: number): { leader: number; marginBpCalc: number | null } {
  let first = -1;
  let best = -1;
  let second = -1;
  votes.forEach((v, i) => {
    if (v === null) return;
    if (v > best) {
      second = best;
      best = v;
      first = i;
    } else if (v > second) second = v;
  });
  if (vvc <= 0 || best <= 0) return { leader: -1, marginBpCalc: null };
  if (best === second) return { leader: -1, marginBpCalc: 0 };
  return { leader: first, marginBpCalc: Math.round(((best - Math.max(second, 0)) * 10_000) / vvc) };
}

/** A TSE percentage string as basis points: "47,03" → 4703. */
export const pctToBp = (raw: string): number => Math.round(Number(raw.replace(',', '.')) * 100);

const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
const uniqSorted = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort(cmp);

export interface Rendered {
  /** View name → canonical JSON bytes. */
  views: Map<string, string>;
  /** The objects, for tests and reconciliation. */
  objects: Map<string, unknown>;
}

export function render(state: ViewState, cfg: ViewsConfig): Rendered {
  const objects = new Map<string, unknown>();
  const entry = (path: string) => state.paths[path];
  const pres = electionOf(cfg, 'president');
  const brCoverage = entry(coveragePath(pres, 'br'))?.accepted;
  const coverage = brCoverage?.data.kind === 'coverage' ? (brCoverage.data as CoverageData) : undefined;

  // Result views: president br + UFs + zz, governor per configured UF.
  const areas: { office: Office; area: Area }[] = [
    ...(['br', ...UFS, ABROAD] as Area[]).map((area) => ({ office: 'president' as const, area })),
    ...cfg.governorUfs.map((area) => ({ office: 'governor' as const, area: area as Area })),
  ];
  for (const { office, area } of areas) {
    const e = entry(resultPath(electionOf(cfg, office), officeCode(office), area));
    const row = office === 'president' && area !== 'br' ? coverage?.rows[area] : undefined;
    const view: ResultView = {
      v: 1,
      kind: 'result',
      election: electionOf(cfg, office),
      office,
      area,
      sources: uniqSorted([shown(e)?.sha256, row ? brCoverage!.sha256 : undefined]),
      ...unit(e),
      municipalities: row ? { ...row } : null,
    };
    objects.set(`result/${office}/${area}`, view);
  }

  objects.set('regions/president', regions(state, pres));

  // Municipality tables and the map need the -cm index.
  for (const office of ['president', 'governor'] as const) {
    const idx = entry(municipalityIndexPath(electionOf(cfg, office)))?.accepted;
    if (!idx || idx.data.kind !== 'index') continue;
    const index = idx.data as IndexData;
    const election = electionOf(cfg, office);
    const muPath = (area: string, mu: string) => resultPath(election, officeCode(office), area as Area, mu);
    const tableAreas = office === 'president' ? Object.keys(index.areas).sort(cmp) : [...cfg.governorUfs].sort(cmp);

    const allUnits = (area: string) => (index.areas[area] ?? []).map((m) => shown(entry(muPath(area, m.mu)))?.data);
    const presHeaders = office === 'president' ? headers([shown(entry(resultPath(pres, OFFICES.president, 'br')))?.data, ...tableAreas.flatMap(allUnits)]) : [];

    for (const area of tableAreas) {
      const ufData = shown(entry(resultPath(election, officeCode(office), area as Area)))?.data;
      const hs = office === 'president' ? presHeaders : headers([ufData, ...allUnits(area)]);
      const rows: MunicipalityRow[] = (index.areas[area] ?? []).map((m) => {
        const e = entry(muPath(area, m.mu));
        const status = statusOf(e);
        const s = shown(e);
        const cols = s ? columns(s.data, hs) : undefined;
        return {
          mu: m.mu,
          cdi: m.cdi,
          name: m.name,
          capital: m.capital,
          status,
          failingSince: status === 'fetch_failed' ? e!.health!.at : null,
          source: s?.sha256 ?? null,
          totalizedAt: s?.data.totalizedAt ?? null,
          sections: s ? { total: s.data.s.ts, counted: s.data.s.st, countedPct: { raw: s.data.s.pst.raw } } : null,
          validWithSubJudice: s?.data.v.vvc ?? null,
          votes: cols?.votes ?? null,
          pct: cols?.pct ?? null,
          leader: cols ? leaderOf(cols.votes, s!.data.v.vvc).leader : -1,
        };
      });
      const view: MunicipalityView = { v: 1, kind: 'municipalities', election, office, area, candidates: hs, rows };
      objects.set(`municipalities/${office}/${area}`, view);
    }

    if (office !== 'president') continue;
    const domestic = Object.entries(index.areas)
      .filter(([area]) => area !== ABROAD)
      .flatMap(([area, ms]) => ms.filter((m) => m.cdi !== null).map((m) => ({ ...m, area, cdi: m.cdi! })))
      .sort((a, b) => cmp(a.cdi, b.cdi));
    const mapIndex: MapIndexView = {
      v: 1,
      kind: 'map-index',
      election,
      source: idx.sha256,
      cdi: domestic.map((m) => m.cdi),
      mu: domestic.map((m) => m.mu),
      uf: domestic.map((m) => m.area),
      name: domestic.map((m) => m.name),
    };
    objects.set('map-index/president', mapIndex);

    const leader: number[] = [];
    const marginBpCalc: (number | null)[] = [];
    const countedBp: (number | null)[] = [];
    const status: number[] = [];
    const sources: string[] = [];
    for (const m of domestic) {
      const e = entry(muPath(m.area, m.mu));
      const s = shown(e);
      status.push(RESULT_STATUS_CODE[statusOf(e)]);
      if (!s) {
        leader.push(-1);
        marginBpCalc.push(null);
        countedBp.push(null);
        continue;
      }
      sources.push(s.sha256);
      const l = leaderOf(columns(s.data, presHeaders).votes, s.data.v.vvc);
      leader.push(l.leader);
      marginBpCalc.push(l.marginBpCalc);
      countedBp.push(pctToBp(s.data.s.pst.raw));
    }
    const map: MapView = {
      v: 1,
      kind: 'map',
      election,
      office,
      index: sha256Hex(mapIndex.cdi.join('\n')),
      count: domestic.length,
      sourcesDigest: sha256Hex(uniqSorted(sources).join('\n')),
      candidates: presHeaders,
      leader,
      marginBpCalc,
      countedBp,
      status,
    };
    objects.set('map/president', map);
  }

  const views = new Map<string, string>();
  for (const name of [...objects.keys()].sort(cmp)) views.set(name, canonicalJson(objects.get(name)));
  return { views, objects };
}

function regions(state: ViewState, pres: Election): RegionsView {
  const ufEntry = (uf: string) => state.paths[resultPath(pres, OFFICES.president, uf as Area)];
  const all = UFS.map((uf) => shown(ufEntry(uf))?.data);
  const hs = headers(all);
  const sources: string[] = [];
  const regionsOut = REGIONS.map((r) => {
    const ufs = r.ufs.map((uf) => ({ uf, status: statusOf(ufEntry(uf)) }));
    const present = r.ufs.map((uf) => shown(ufEntry(uf))).filter((s) => s !== undefined);
    for (const s of present) sources.push(s.sha256);
    if (present.length === 0) return { code: r.code, name: r.name, ufs, complete: false, calc: null };
    const sum = (f: (d: ResultData) => number) => present.reduce((acc, s) => acc + f(s.data), 0);
    const votes = hs.map((h) => present.reduce((acc, s) => acc + (s.data.cand.find((c) => c.n === h.n)?.votes ?? 0), 0));
    const vvc = sum((d) => d.v.vvc);
    const ts = sum((d) => d.s.ts);
    const st = sum((d) => d.s.st);
    return {
      code: r.code,
      name: r.name,
      ufs,
      complete: present.length === r.ufs.length,
      calc: {
        sectionsTotal: ts,
        sectionsCounted: st,
        countedBpCalc: ts > 0 ? Math.round((st * 10_000) / ts) : null,
        votesTotal: sum((d) => d.v.tv),
        validWithSubJudice: vvc,
        blank: sum((d) => d.v.vb),
        null: sum((d) => d.v.tvn),
        votes,
        pctBpCalc: vvc > 0 ? votes.map((v) => Math.round((v * 10_000) / vvc)) : null,
      },
    };
  });
  return { v: 1, kind: 'regions', election: pres, office: 'president', sources: uniqSorted(sources), candidates: hs, regions: regionsOut };
}

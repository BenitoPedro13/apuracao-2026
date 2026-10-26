// The TSE's archived results (research 05): `votacao_candidato_munzona_<year>.zip` and
// `detalhe_votacao_munzona_<year>.zip` on cdn.tse.jus.br/estatistica/sead/odsele/. Latin-1,
// `;`-separated, quoted; the column order changes between years, so rows are read by
// header name, never by position. Pure: the caller streams the zip and hands over lines.
import { tseInstant } from '@apuracao/contracts';

export const ODSELE_BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele';
export type OdseleType = 'votacao_candidato_munzona' | 'detalhe_votacao_munzona';

/** The archive's URL for one year (research 05 §1). */
export const odseleUrl = (type: OdseleType, year: number) => `${ODSELE_BASE}/${type}/${type}_${year}.zip`;

/** The CSV inside the zip with the president rows: `_BR.csv`, or `_BRASIL.csv` (1998 candidates). */
export function presidentCsvName(names: readonly string[]): string {
  const br = names.find((n) => n.endsWith('_BR.csv'));
  const brasil = names.find((n) => n.endsWith('_BRASIL.csv'));
  const name = br ?? brasil;
  if (!name) throw new Error(`no _BR.csv or _BRASIL.csv in ${names.join(', ')}`);
  return name;
}

/** One `;`-separated line; quoted fields may hold `;`, and `""` is a literal quote. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let v = '';
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q === -1) throw new Error(`unterminated quote in: ${line.slice(0, 120)}`);
        v += line.slice(i, q);
        if (line[q + 1] === '"') {
          v += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      out.push(v);
      if (i < line.length && line[i] !== ';') throw new Error(`text after a closing quote in: ${line.slice(0, 120)}`);
      i++;
    } else {
      const semi = line.indexOf(';', i);
      const end = semi === -1 ? line.length : semi;
      out.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return out;
}

/** `#NULO#`/`#NULO`/−1: empty; `#NE#`/`#NE`/−3: "not recorded that year" (research 05 §1). */
const NULL_MARKS = new Set(['', '#NULO#', '#NULO', '-1']);
const NE_MARKS = new Set(['#NE#', '#NE', '-3']);

/** A count: a non-negative integer, or null when the TSE marks it empty / not recorded. */
export function countOf(raw: string | undefined): number | null {
  if (raw === undefined || NULL_MARKS.has(raw) || NE_MARKS.has(raw)) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`not a count: ${JSON.stringify(raw)}`);
  return Number(raw);
}

/** 2018 and 2022 write `CD_MUNICIPIO` as a bare integer, dropping leading zeros (`6092`). */
export const municipalityCode = (raw: string) => {
  if (!/^\d{1,5}$/.test(raw)) throw new Error(`not a TSE municipality code: ${JSON.stringify(raw)}`);
  return raw.padStart(5, '0');
};

/** `ZZ` = abroad (1998+); `VT` = the 2010 transit-vote pseudo-municipalities (`999xx`). */
export type PlaceKind = 'domestic' | 'abroad' | 'transit';
export const placeKind = (uf: string): PlaceKind => (uf === 'ZZ' ? 'abroad' : uf === 'VT' ? 'transit' : 'domestic');

/** Reads rows by name; throws at the header if a column a rule needs is missing. */
export function headerReader(headerLine: string, required: readonly string[]) {
  const cols = splitCsvLine(headerLine);
  const at = new Map(cols.map((c, i) => [c, i]));
  const missing = required.filter((c) => !at.has(c));
  if (missing.length) throw new Error(`missing columns ${missing.join(', ')}`);
  return (line: string) => {
    const f = splitCsvLine(line);
    if (f.length !== cols.length) throw new Error(`${f.length} fields, header has ${cols.length}: ${line.slice(0, 120)}`);
    return (name: string): string | undefined => {
      const i = at.get(name);
      return i === undefined ? undefined : f[i];
    };
  };
}

const KEY_COLUMNS = ['ANO_ELEICAO', 'NR_TURNO', 'SG_UF', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'CD_CARGO'] as const;
/** `CD_CARGO` of the president. */
export const PRESIDENT = 1;

interface RowKey {
  year: number;
  round: 1 | 2;
  uf: string;
  kind: PlaceKind;
  /** TSE code, 5 digits. */
  municipality: string;
  municipalityName: string;
}

export interface CandidateRow extends RowKey {
  number: number;
  name: string;
  party: string;
  votes: number;
}

export interface DetailRow extends RowKey {
  aptos: number;
  comparecimento: number;
  abstencoes: number;
  /** Voters of sections that were never installed: neither turnout nor abstention. */
  naoInstaladas: number;
  brancos: number;
  nulos: number;
}

function key(get: (c: string) => string | undefined): RowKey | null {
  if (Number(get('CD_CARGO')) !== PRESIDENT) return null;
  const round = Number(get('NR_TURNO'));
  if (round !== 1 && round !== 2) throw new Error(`NR_TURNO ${get('NR_TURNO')}`);
  const uf = get('SG_UF')!;
  return {
    year: Number(get('ANO_ELEICAO')),
    round,
    uf,
    kind: placeKind(uf),
    municipality: municipalityCode(get('CD_MUNICIPIO')!),
    municipalityName: get('NM_MUNICIPIO')!,
  };
}

const must = (v: number | null, what: string) => {
  if (v === null) throw new Error(`${what} is empty`);
  return v;
};

/**
 * President rows of `votacao_candidato_munzona`. Votes are `QT_VOTOS_NOMINAIS_VALIDOS`
 * where the column exists and is filled (1998 has 0 in `QT_VOTOS_NOMINAIS` and the votes
 * there), else `QT_VOTOS_NOMINAIS` (2002–2014 have no `_VALIDOS` column).
 */
export function candidateReader(headerLine: string) {
  const read = headerReader(headerLine, [...KEY_COLUMNS, 'NR_CANDIDATO', 'NM_URNA_CANDIDATO', 'SG_PARTIDO', 'QT_VOTOS_NOMINAIS']);
  return (line: string): CandidateRow | null => {
    const get = read(line);
    const k = key(get);
    if (!k) return null;
    const valid = countOf(get('QT_VOTOS_NOMINAIS_VALIDOS'));
    const votes = valid ?? must(countOf(get('QT_VOTOS_NOMINAIS')), 'QT_VOTOS_NOMINAIS');
    return { ...k, number: Number(get('NR_CANDIDATO')), name: get('NM_URNA_CANDIDATO')!, party: get('SG_PARTIDO')!, votes };
  };
}

/**
 * `QT_TOTAL_VOTOS_NULOS` only: 32 rows abroad in 2006 hold −2 (e.g. Tailândia, 2nd round:
 * 14 valid + 0 blank + `QT_VOTOS_NULOS` 1 = turnout 15), so any negative is "not given".
 */
const lenientCount = (raw: string | undefined) => (raw !== undefined && /^-\d+$/.test(raw) ? null : countOf(raw));

/**
 * President rows of `detalhe_votacao_munzona`. Null votes: the larger of
 * `QT_TOTAL_VOTOS_NULOS` and `QT_VOTOS_NULOS` (1994 fills only the latter; 2006 abroad has
 * negative totals).
 */
export function detailReader(headerLine: string) {
  const read = headerReader(headerLine, [
    ...KEY_COLUMNS,
    'QT_APTOS',
    'QT_COMPARECIMENTO',
    'QT_ABSTENCOES',
    'QT_ELEITORES_SECOES_NAO_INSTALADAS',
    'QT_VOTOS_BRANCOS',
    'QT_TOTAL_VOTOS_NULOS',
    'QT_VOTOS_NULOS',
  ]);
  return (line: string): DetailRow | null => {
    const get = read(line);
    const k = key(get);
    if (!k) return null;
    const c = (name: string) => must(countOf(get(name)), name);
    return {
      ...k,
      aptos: c('QT_APTOS'),
      comparecimento: c('QT_COMPARECIMENTO'),
      abstencoes: c('QT_ABSTENCOES'),
      naoInstaladas: c('QT_ELEITORES_SECOES_NAO_INSTALADAS'),
      brancos: c('QT_VOTOS_BRANCOS'),
      nulos: Math.max(lenientCount(get('QT_TOTAL_VOTOS_NULOS')) ?? 0, countOf(get('QT_VOTOS_NULOS')) ?? 0),
    };
  };
}

/** The columns the TSE rewrites on every regeneration (research 05 §2). */
export const GENERATION_COLUMNS = ['DT_GERACAO', 'HH_GERACAO'] as const;

/** A line with the generation stamp blanked: what the content identity hashes. */
export function withoutGeneration(headerLine: string) {
  const cols = splitCsvLine(headerLine);
  const drop = new Set(GENERATION_COLUMNS.map((c) => cols.indexOf(c)).filter((i) => i >= 0));
  return (line: string) => (drop.size ? splitCsvLine(line).filter((_, i) => !drop.has(i)).join('\u001f') : line);
}

/**
 * The content identity of an archive CSV (research 05 §2): the TSE regenerates these files
 * with a new stamp and in a different row order (2022 detail, 08 → 09/10/2026: the same
 * 12,567 rows, reordered). So it's a multiset hash: the sum mod 2^256 of each row's sha256,
 * stamp removed. Order-independent, duplicates still count, any changed row changes it.
 */
export class RowSetHash {
  private sum = 0n;
  private static readonly MOD = 1n << 256n;
  constructor(private readonly sha256: (s: string) => string) {}
  add(row: string) {
    this.sum = (this.sum + BigInt(`0x${this.sha256(row)}`)) % RowSetHash.MOD;
  }
  digest(): string {
    return this.sum.toString(16).padStart(64, '0');
  }
}

/** The 2022 totalization histories (research 03 §4): one file per round, next to the odsele archive. */
export const totalizationHistoryUrl = (year: number, round: 1 | 2) =>
  `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes${year}/Historico_Totalizacao_Presidente_BR_${round}T_${year}.zip`;

export interface TotalizationRow {
  /** `DT_TOTALIZACAO`, Brasília (the first 2022 2nd-round row is 17:00:51, right after the 17:00 close). */
  at: string;
  sectionsTotal: number;
  /** `QT_SECOES_TOT_ACUMULADO`. */
  sections: number;
  /** `QT_VOTOS_CONCORRENTES_ACUMULADO`: the candidates' sum. */
  valid: number;
  /** Cumulative votes per candidate, in column order; aligned with the reader's `candidates`. */
  votes: number[];
}

const NOT_CANDIDATES = new Set(['BRANCO', 'NULO']);

/**
 * `Historico_Totalizacao_Presidente_BR_<n>T_<year>.csv`. Unlike the leiame says, fields are
 * neither quoted nor trimmed: every value and header name is space-padded (`"  CD_CARGO"`,
 * `"       55"`). Candidates are the `<NAME>_QT_VOTOS_TOT_ACUMULADO` columns, blank and null
 * aside, named as in the header (`JAIR_BOLSONARO` → "JAIR BOLSONARO").
 */
export function totalizationHistoryReader(headerLine: string) {
  const cols = splitCsvLine(headerLine).map((c) => c.trim());
  const at = new Map(cols.map((c, i) => [c, i]));
  const SUFFIX = '_QT_VOTOS_TOT_ACUMULADO';
  const prefixes = cols.filter((c) => c.endsWith(SUFFIX)).map((c) => c.slice(0, -SUFFIX.length)).filter((p) => !NOT_CANDIDATES.has(p));
  const required = ['DT_TOTALIZACAO', 'QT_SECOES_TOTAL', 'QT_SECOES_TOT_ACUMULADO', 'QT_VOTOS_CONCORRENTES_ACUMULADO'];
  const missing = required.filter((c) => !at.has(c));
  if (missing.length || prefixes.length === 0) throw new Error(`missing columns ${[...missing, ...(prefixes.length ? [] : ['<candidate>' + SUFFIX])].join(', ')}`);
  const candidates = prefixes.map((p) => p.replace(/_/g, ' '));
  const read = (line: string): TotalizationRow => {
    const f = splitCsvLine(line).map((v) => v.trim());
    if (f.length !== cols.length) throw new Error(`${f.length} fields, header has ${cols.length}: ${line.slice(0, 120)}`);
    const get = (name: string) => f[at.get(name)!]!;
    const count = (name: string) => must(countOf(get(name)), name);
    const [date = '', time = ''] = get('DT_TOTALIZACAO').split(' ');
    return {
      at: tseInstant(date, time),
      sectionsTotal: count('QT_SECOES_TOTAL'),
      sections: count('QT_SECOES_TOT_ACUMULADO'),
      valid: count('QT_VOTOS_CONCORRENTES_ACUMULADO'),
      votes: prefixes.map((p) => count(p + SUFFIX)),
    };
  };
  return { candidates, read };
}

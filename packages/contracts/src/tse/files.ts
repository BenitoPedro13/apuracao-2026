import { z } from 'zod';
import { TseDate, TseDecimal, TseFlag, TseId, TseInt, TseTime, decimals, ints } from './primitives.js';

// Shapes of the TSE's published files, read from the real samples in
// docs/research/samples/ (TASK-contracts-and-tse-parsing.md §1). Every object is loose:
// unknown keys are kept and never fail validation, so a field the TSE adds on election
// night can't take the pipeline down. The raw blob is stored regardless.
//
// The high-precision `…n` decimals (e.g. `pvapn`) are optional: we don't read them yet.

/** File header shared by every data file. */
const header = {
  ele: TseId,
  t: z.string(),
  f: z.string(),
  dg: TseDate,
  hg: TseTime,
  idg: TseId,
};

/** `s`: sections (urnas) counted. */
export const TseSections = z.looseObject({
  ...ints('ts', 'st', 'snt', 'si', 'sni', 'sa', 'sna'),
  ...decimals('pst', 'psnt', 'psi', 'psni', 'psa', 'psna'),
});

/** `e`: electorate, turnout (`c`) and abstention (`a`). */
export const TseElectorate = z.looseObject({
  ...ints('te', 'est', 'esnt', 'esi', 'esni', 'esa', 'esna', 'c', 'a'),
  ...decimals('pest', 'pesnt', 'pesi', 'pesni', 'pesa', 'pesna', 'pc', 'pa'),
});

/** `v`: total, valid, blank (`vb`) and null (`tvn` = `vn` + `vnt`) votes. */
export const TseVotes = z.looseObject({
  ...ints('tv', 'vvc', 'vv', 'vnom', 'van', 'vansj', 'vb', 'tvn', 'vn', 'vnt', 'vsan', 'vscv'),
  ...decimals('pvvc', 'pvv', 'pvnom', 'pvan', 'pvansj', 'pvb', 'ptvn', 'pvn', 'pvnt'),
});

export const TseCandidate = z.looseObject({
  n: TseId, // ballot number
  sqcand: TseId,
  nm: z.string(),
  nmu: z.string(), // ballot name
  dt: TseDate.optional(), // birth date
  dvt: z.string(), // vote destination, e.g. "Válido"
  seq: TseInt,
  e: TseFlag, // elected
  st: z.string(), // e.g. "2º turno", "Não eleito"
  vap: TseInt, // votes
  pvap: TseDecimal,
  pvapn: TseDecimal.optional(),
  vs: z.array(z.looseObject({})).optional(), // running mates
});

export const TseParty = z.looseObject({
  n: TseId,
  sg: z.string(),
  nm: z.string(),
  nfed: z.string(), // federation number, "" when none
  tvtn: TseInt.optional(),
  tvan: TseInt.optional(),
  cand: z.array(TseCandidate),
});

export const TseCoalition = z.looseObject({
  n: TseId,
  nm: z.string(),
  tp: z.string(),
  com: z.string(),
  par: z.array(TseParty),
});

export const TseOffice = z.looseObject({
  cd: TseId,
  nmn: z.string(),
  nv: z.string().optional(),
  fed: z.array(z.looseObject({})).optional(),
  agr: z.array(TseCoalition),
});

/**
 * `-u` result file: one office in one scope (br, a UF, a municipality, or `zz` abroad).
 * The abroad aggregate is `tpabr: "uf"`, `cdabr: "zz"`.
 */
export const TseResultFile = z.looseObject({
  ...header,
  tpabr: z.enum(['br', 'uf', 'mu']),
  cdabr: z.string(),
  dt: TseDate, // totalization date/time
  ht: TseTime,
  tf: TseFlag, // `[VERIFY: meaning of tf / and on the night]` (architecture.md §7.2)
  and: z.string(),
  carg: z.array(TseOffice),
  s: TseSections,
  e: TseElectorate,
  v: TseVotes,
});
export type TseResultFile = z.output<typeof TseResultFile>;

/**
 * Coverage row. dt/ht are allowed to be "" (→ null) defensively: every 1st-round sample is
 * final and filled, and a municipality that hasn't started counting may have none.
 * `[VERIFY: dt/ht of a not-started row, on the first 2nd-round -ab files]`
 */
const optionalDate = z.union([TseDate, z.literal('').transform(() => null)]);
const optionalTime = z.union([TseTime, z.literal('').transform(() => null)]);

export const TseCoverageRow = z.looseObject({
  and: z.string(),
  tpabr: z.enum(['br', 'uf', 'mun']),
  cdabr: z.string(),
  dt: optionalDate,
  ht: optionalTime,
  // municipalities finished / partially counted / not started (UF rows of the br file)
  munf: TseInt.optional(),
  munpt: TseInt.optional(),
  munnr: TseInt.optional(),
  s: TseSections,
  e: TseElectorate,
});

/** `-ab` coverage file: per-UF rows (`br`) or per-municipality rows (a UF). No votes. */
export const TseCoverageFile = z.looseObject({
  ...header,
  abr: z.array(TseCoverageRow),
});
export type TseCoverageFile = z.output<typeof TseCoverageFile>;

/** `-cm` municipality index: TSE code `cd` → IBGE code `cdi` ("" abroad). */
export const TseMunicipalityIndex = z.looseObject({
  dg: TseDate,
  hg: TseTime,
  idg: TseId,
  f: z.string(),
  abr: z.array(
    z.looseObject({
      cd: z.string().regex(/^[a-z]{2}$/),
      ds: z.string(),
      mu: z.array(
        z.looseObject({
          cd: z.string().regex(/^\d{5}$/),
          cdi: z.union([z.string().regex(/^\d{7}$/), z.literal('')]),
          nm: z.string(),
          c: TseFlag, // capital
          z: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type TseMunicipalityIndex = z.output<typeof TseMunicipalityIndex>;

/** `ele-c` election catalog: URL templates and every pleito's elections. */
export const TseElectionCatalog = z.looseObject({
  dg: TseDate,
  hg: TseTime,
  idg: TseId,
  f: z.string(),
  arq: z.array(z.looseObject({ tp: z.string(), dir: z.string() })),
  pl: z.array(
    z.looseObject({
      cd: TseId,
      c: z.string(), // cycle, e.g. "ele2026"
      dt: TseDate,
      e: z.array(
        z.looseObject({
          cd: TseId,
          cdt2: z.string(), // 2nd-round election code, "" when none
          nm: z.string(),
          t: z.string(), // round
          abr: z.array(
            z.looseObject({
              cd: z.string(),
              cp: z.array(z.looseObject({ cd: TseId, ds: z.string() })),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type TseElectionCatalog = z.output<typeof TseElectionCatalog>;

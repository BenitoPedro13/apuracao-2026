import { z } from 'zod';
import { ElectionCode } from '../observation.js';
import { ResultStatus } from '../status.js';
import { IsoInstant, Office, Sha256, Sources, SourcesDigest, TsePct } from './common.js';
import { SectionsBlock } from './result.js';

/** A candidate column header: the TSE's `seq` order, the same in every file of an office. */
export const CandidateHeader = z.object({ n: z.string(), name: z.string(), party: z.string(), seq: z.number().int() });
export type CandidateHeader = z.infer<typeof CandidateHeader>;

/**
 * The 5 IBGE regions as our own sums of the UF files (architecture.md §7.4: labelled
 * computed; the headline always comes from the TSE's national file).
 */
export const RegionsView = z.object({
  v: z.literal(1),
  kind: z.literal('regions'),
  election: ElectionCode,
  office: Office,
  sources: Sources,
  candidates: z.array(CandidateHeader),
  regions: z.array(
    z.object({
      code: z.enum(['N', 'NE', 'CO', 'SE', 'S']),
      name: z.string(),
      ufs: z.array(z.object({ uf: z.string(), status: ResultStatus })),
      /** Every UF of the region has an accepted file (its numbers are in the sums). */
      complete: z.boolean(),
      /** null: no UF of the region has an accepted file. */
      calc: z
        .object({
          sectionsTotal: z.number().int(),
          sectionsCounted: z.number().int(),
          countedBpCalc: z.number().int().nullable(),
          votesTotal: z.number().int(),
          validWithSubJudice: z.number().int(),
          blank: z.number().int(),
          null: z.number().int(),
          /** Per candidate, in `candidates` order. */
          votes: z.array(z.number().int()),
          /** Over `validWithSubJudice`, as the TSE's `pvap` (research 02 §8); null with no votes. */
          pctBpCalc: z.array(z.number().int()).nullable(),
        })
        .nullable(),
    }),
  ),
});
export type RegionsView = z.infer<typeof RegionsView>;

/**
 * The domestic municipalities in ascending IBGE `cdi` order: the order of every MapView
 * array and of the map geometry (TASK-map.md). Changes only when the `-cm` index does, so
 * a browser fetches it once.
 */
export const MapIndexView = z.object({
  v: z.literal(1),
  kind: z.literal('map-index'),
  election: ElectionCode,
  source: Sha256,
  cdi: z.array(z.string().regex(/^\d{7}$/)),
  mu: z.array(z.string().regex(/^\d{5}$/)),
  uf: z.array(z.string().regex(/^[a-z]{2}$/)),
  name: z.array(z.string()),
});
export type MapIndexView = z.infer<typeof MapIndexView>;

/** Columnar map frame over MapIndexView's order. null = no data, never 0 (invariant 6). */
export const MapView = z.object({
  v: z.literal(1),
  kind: z.literal('map'),
  election: ElectionCode,
  office: Office,
  /** sha256 of MapIndexView.cdi joined by "\n": the order these arrays are in. */
  index: Sha256,
  count: z.number().int(),
  sourcesDigest: SourcesDigest,
  candidates: z.array(CandidateHeader),
  /** Index into `candidates`; -1 = no single leader (no data, no votes, or a tie). */
  leader: z.array(z.number().int().min(-1)),
  /** (leader − runner-up) / vvc in basis points; 0 for a tie, null with no votes or data. */
  marginBpCalc: z.array(z.number().int().nullable()),
  /** The TSE's `s.pst` as basis points ("47,03" → 4703); null with no data. */
  countedBp: z.array(z.number().int().nullable()),
  /** RESULT_STATUS_CODE. */
  status: z.array(z.number().int()),
});
export type MapView = z.infer<typeof MapView>;

export const MunicipalityRow = z.object({
  mu: z.string().regex(/^\d{5}$/), // TSE code
  cdi: z.string().nullable(), // IBGE code; null abroad
  name: z.string(),
  capital: z.boolean(),
  status: ResultStatus,
  failingSince: IsoInstant.nullable(),
  /** The `.jws` this row comes from; null when none was accepted. */
  source: Sha256.nullable(),
  totalizedAt: IsoInstant.nullable(),
  sections: SectionsBlock.nullable(),
  validWithSubJudice: z.number().int().nullable(),
  /**
   * Per candidate in the view's `candidates` order; null when no file was accepted. An
   * element is null for a candidate the file doesn't list.
   */
  votes: z.array(z.number().int().nullable()).nullable(),
  pct: z.array(TsePct.nullable()).nullable(),
  leader: z.number().int().min(-1),
});
export type MunicipalityRow = z.infer<typeof MunicipalityRow>;

/** The table alternative to the map for one UF or abroad (invariant 7). */
export const MunicipalityView = z.object({
  v: z.literal(1),
  kind: z.literal('municipalities'),
  election: ElectionCode,
  office: Office,
  area: z.string().regex(/^[a-z]{2}$/),
  candidates: z.array(CandidateHeader),
  /** Every municipality of the `-cm` index for the area, ascending TSE code. */
  rows: z.array(MunicipalityRow),
});
export type MunicipalityView = z.infer<typeof MunicipalityView>;

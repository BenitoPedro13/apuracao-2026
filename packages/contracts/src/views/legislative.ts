import { z } from 'zod';
import { ElectionCode } from '../observation.js';
import { ResultStatus } from '../status.js';
import { IsoInstant, Sources, TsePct, TseStamp } from './common.js';
import { ElectorateBlock, SectionsBlock, VotesBlock } from './result.js';

// Senate and deputies, 1st round only: a static archive (TASK-legislative-archive.md §2.2).
// Who was elected is the TSE's own flag (`e`, `st`); the only numbers of ours are the
// national seat sums, named `…Calc` like every other derived number.

/** `state-deputy` is office 7 in 26 UFs and office 8 (Deputado Distrital) in DF. */
export const LegislativeOffice = z.enum(['senate', 'federal-deputy', 'state-deputy']);
export type LegislativeOffice = z.infer<typeof LegislativeOffice>;

export const LegislativeParty = z.object({
  n: z.string(), // party number
  party: z.string(), // sg
  name: z.string(), // nm
  /** Federation number (nfed), null when the party is in none. */
  federation: z.string().nullable(),
  /** Its candidates with `e = "s"`. */
  seats: z.number().int(),
  /** tvtn: Σ votes of its "Válido" candidates. */
  nominal: z.number().int(),
  /** tvtl: legenda votes; null for the senate (no party-label vote). */
  label: z.number().int().nullable(),
});

export const LegislativeCandidate = z.object({
  n: z.string(),
  name: z.string(), // nmu
  party: z.string(),
  votes: z.number().int(),
  pct: TsePct,
  elected: z.boolean(),
  situation: z.string(), // st: "Eleito por QP", "Eleito por média", "Eleito", "Suplente"…
  destination: z.string().nullable(), // dvt
  /** Senate alternates (vs[]: tp s1/s2), in TSE order; empty for deputies. */
  alternates: z.array(z.object({ role: z.string(), name: z.string(), party: z.string() })),
});

/** `legislative/{office}/{uf}`: one UF's race, from its `-u` file. */
export const LegislativeUfView = z.object({
  v: z.literal(1),
  kind: z.literal('legislative'),
  election: ElectionCode,
  office: LegislativeOffice,
  area: z.string().regex(/^[a-z]{2}$/),
  sources: Sources,
  status: ResultStatus,
  failingSince: IsoInstant.nullable(),
  tse: TseStamp.nullable(),
  /** The TSE's office name (nmn), e.g. "Deputado Distrital". null before a file. */
  officeName: z.string().nullable(),
  /** nv */
  seats: z.number().int().nullable(),
  /** qe: electoral quotient (deputies). */
  quotient: z.number().int().nullable(),
  sections: SectionsBlock.nullable(),
  electorate: ElectorateBlock.nullable(),
  votes: VotesBlock.nullable(),
  /** vnom / vl: nominal and legenda votes, vnom + vl = valid. */
  nominal: z.number().int().nullable(),
  label: z.number().int().nullable(),
  /** Parties, by seats then nominal + legenda votes. */
  parties: z.array(LegislativeParty),
  /** Senate: every candidate; deputies: the elected only. By votes, highest first. */
  candidates: z.array(LegislativeCandidate),
});
export type LegislativeUfView = z.infer<typeof LegislativeUfView>;

/** `legislative/{office}/br`: seats per party summed by us over the UF files. */
export const LegislativeBrView = z.object({
  v: z.literal(1),
  kind: z.literal('legislative-br'),
  election: ElectionCode,
  office: LegislativeOffice,
  sources: Sources,
  /** Every UF with a race for this office, with its status and seats (nv; null if missing). */
  ufs: z.array(z.object({ uf: z.string(), status: ResultStatus, seats: z.number().int().nullable() })),
  /** Every UF has an accepted file: only then is seatsCalc the chamber's size. */
  complete: z.boolean(),
  seatsCalc: z.number().int(),
  /** By seats, then party. `byUf` is aligned with `ufs` (null: that UF is missing). */
  parties: z.array(z.object({ party: z.string(), seatsCalc: z.number().int(), byUf: z.array(z.number().int().nullable()) })),
});
export type LegislativeBrView = z.infer<typeof LegislativeBrView>;

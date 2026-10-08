import { z } from 'zod';
import { ElectionCode } from '../observation.js';
import { ResultStatus } from '../status.js';
import { IsoInstant, Office, Sources, TsePct, TseStamp } from './common.js';

/** Sections (urnas): `s.ts`, `s.st`, `s.pst`. */
export const SectionsBlock = z.object({ total: z.number().int(), counted: z.number().int(), countedPct: TsePct });

export const ElectorateBlock = z.object({
  total: z.number().int(), // e.te
  turnout: z.number().int(), // e.c
  turnoutPct: TsePct, // e.pc
  abstention: z.number().int(), // e.a
  abstentionPct: TsePct, // e.pa
});

export const VotesBlock = z.object({
  total: z.number().int(), // v.tv
  valid: z.number().int(), // v.vv
  /** v.vvc: valid + annulled + annulled sub judice. The denominator of every `pvap`. */
  validWithSubJudice: z.number().int(),
  blank: z.number().int(), // v.vb
  blankPct: TsePct,
  null: z.number().int(), // v.tvn
  nullPct: TsePct,
  subJudice: z.number().int(), // v.vansj
});

export const CandidateResult = z.object({
  n: z.string(), // ballot number
  name: z.string(), // nmu
  party: z.string(), // party sg
  /** Index into the TSE's `seq` order: the same in every file of an office. */
  seq: z.number().int(),
  votes: z.number().int(),
  pct: TsePct,
  elected: z.boolean(),
  situation: z.string(), // st, e.g. "2º turno"
  /** dvt, e.g. "Válido" or "Anulado sub judice"; null in a file with no votes. */
  destination: z.string().nullable(),
});

/**
 * One result unit: Brazil, a UF, abroad (`zz`) or (inside MunicipalityView) a municipality.
 * Missing data is null with a status saying why (invariant 6), never 0.
 */
export const ResultUnit = z.object({
  status: ResultStatus,
  /** fetch_failed: since when the last fetch has been failing (observation time). */
  failingSince: IsoInstant.nullable(),
  tse: TseStamp.nullable(),
  sections: SectionsBlock.nullable(),
  electorate: ElectorateBlock.nullable(),
  votes: VotesBlock.nullable(),
  /** In TSE `seq` order. Empty when no file has been accepted. */
  candidates: z.array(CandidateResult),
});
export type ResultUnit = z.infer<typeof ResultUnit>;

export const ResultView = z.object({
  v: z.literal(1),
  kind: z.literal('result'),
  election: ElectionCode,
  office: Office,
  /** 'br', a UF, or 'zz' (abroad). */
  area: z.string().regex(/^[a-z]{2}$/),
  sources: Sources,
  ...ResultUnit.shape,
  /** UF and zz rows of the president election's br coverage file; null elsewhere. */
  municipalities: z.object({ final: z.number().int(), partial: z.number().int(), notStarted: z.number().int() }).nullable(),
});
export type ResultView = z.infer<typeof ResultView>;

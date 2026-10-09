import { z } from 'zod';
import { Sha256 } from './common.js';

// The presidential archive 1994–2022 (TASK-historical-presidential.md §2.2): built once from
// the TSE's odsele zips by scripts/build-history.ts and shipped with the site, content-
// addressed like the map geometry. Per-municipality arrays are aligned with `ids` (IBGE
// `cdi`, ascending); `null` = not a municipality in that election (invariant 6: never 0).

const Count = z.number().int().nonnegative();
const MaybeCount = Count.nullable();
/** Per mille, 0–1000 (ours: a share of valid votes, rounded half-up). */
const PerMille = z.number().int().min(0).max(1000);

export const HistoryCandidate = z.object({ n: z.number().int(), name: z.string(), party: z.string() });
export type HistoryCandidate = z.infer<typeof HistoryCandidate>;

/** Sums of TSE rows: the whole country, or only abroad / transit. */
export const HistoryTotals = z.object({
  aptos: Count,
  comparecimento: Count,
  abstencoes: Count,
  naoInstaladas: Count,
  brancos: Count,
  nulos: Count,
  /** Aligned with the round's candidates. */
  votes: z.array(Count),
});
export type HistoryTotals = z.infer<typeof HistoryTotals>;

export const HistoryRound = z.object({
  year: z.number().int(),
  round: z.union([z.literal(1), z.literal(2)]),
  /** The round that chose the president (the 2nd when there was one). */
  decisive: z.boolean(),
  /** Every candidate, by national votes, most first. */
  candidates: z.array(HistoryCandidate),
  national: HistoryTotals,
  abroad: HistoryTotals.nullable(),
  transit: HistoryTotals.nullable(),
  byUf: z.record(z.string().regex(/^[A-Z]{2}$/), HistoryTotals),
});
export type HistoryRound = z.infer<typeof HistoryRound>;

/** The source zips, as downloaded (research 05 §2): byte identity and content identity. */
export const HistorySource = z.object({
  url: z.string(),
  sha256: Sha256,
  /** sha256 of the CSV rows with DT_GERACAO/HH_GERACAO removed. */
  contentId: Sha256,
  bytes: Count,
  generatedAt: z.string(),
});

/** Every municipality's TSE numbers, per round: what "Como a sua cidade votou" reads. */
export const HistoryMunicipalities = z.object({
  v: z.literal(1),
  ids: z.array(z.string().regex(/^\d{7}$/)),
  /** TSE code (5 digits), UF, and the name in the latest election it voted in. */
  tse: z.array(z.string().regex(/^\d{5}$/)),
  uf: z.array(z.string().regex(/^[A-Z]{2}$/)),
  name: z.array(z.string()),
  rounds: z.array(
    z.object({
      year: z.number().int(),
      round: z.union([z.literal(1), z.literal(2)]),
      aptos: z.array(MaybeCount),
      comparecimento: z.array(MaybeCount),
      brancos: z.array(MaybeCount),
      nulos: z.array(MaybeCount),
      /** [candidate][municipality], aligned with the round's candidates. */
      votes: z.array(z.array(MaybeCount)),
    }),
  ),
});
export type HistoryMunicipalities = z.infer<typeof HistoryMunicipalities>;

const R = z.number().min(-1).max(1);

/** The answers to the history page's questions (all ours; each names its method on the page). */
export const HistoryInsights = z.object({
  /** Domestic municipalities that voted in all 8 elections: the universe of "always". */
  universe: Count,
  /** Per municipality, decisive rounds won by its own winner = the national winner (null: not in all 8). */
  bellwetherHits: z.array(z.number().int().min(0).max(8).nullable()),
  /** Mean |its winner's share − the national winner's share| over the 8 decisive rounds, per mille. */
  mirrorGap: z.array(PerMille.nullable()),
  /** 1st round, per year: shares of the three national leaders, [year][leader][municipality]. */
  leaders1t: z.array(z.array(z.array(PerMille.nullable()))),
  /** Decisive round, per year: the municipal winner (candidate index) and margin over the 2nd. */
  decisive: z.array(z.object({ winner: z.array(z.number().int().nullable()), marginPm: z.array(PerMille.nullable()) })),
  /** Correlation across municipalities of the PT's 1st-round share, consecutive elections. */
  ptPersistence: z.array(z.object({ from: z.number().int(), to: z.number().int(), r: R, n: Count })),
  /** The same for the PT's main rival (the national runner-up or winner who isn't the PT). */
  rivalPersistence: z.array(z.object({ from: z.number().int(), to: z.number().int(), fromName: z.string(), toName: z.string(), r: R, n: Count })),
  /** Municipalities more than 5 p.p. below the national PT share in 2002 and more than 5 above in 2022, and the reverse. */
  flips: z.object({ belowToAbove: Count, aboveToBelow: Count }),
  /** Share of registered voters in municipalities won by ≥ 40 p.p. in the decisive round. */
  landslide: z.array(z.object({ year: z.number().int(), round: z.number().int(), voters: Count, of: Count, municipalities: Count, ofMunicipalities: Count })),
  /** Per 2nd round: candidates' gains from the 1st, the 1st-round votes of everyone else, and the cross-municipality slope. */
  transfers: z.array(z.object({ year: z.number().int(), others: Count, gains: z.tuple([z.number().int(), z.number().int()]), slope: z.tuple([z.number(), z.number()]) })),
  /** Up to 5 most similar municipalities per municipality (indexes), by 1st-round PT share relative to Brazil. */
  similar: z.array(z.array(z.number().int().nonnegative())),
});
export type HistoryInsights = z.infer<typeof HistoryInsights>;

/** `history/history.<sha8>.json`: the questions page's one file. */
export const HistoryFile = z.object({
  v: z.literal(1),
  years: z.array(z.number().int()),
  rounds: z.array(HistoryRound),
  /** Aligned with HistoryMunicipalities.ids (same order, same length). */
  ids: z.array(z.string().regex(/^\d{7}$/)),
  uf: z.array(z.string().regex(/^[A-Z]{2}$/)),
  name: z.array(z.string()),
  /** 2022 registered voters (the latest), for sizes and filters. */
  aptos: z.array(MaybeCount),
  insights: HistoryInsights,
  sources: z.array(HistorySource),
});
export type HistoryFile = z.infer<typeof HistoryFile>;

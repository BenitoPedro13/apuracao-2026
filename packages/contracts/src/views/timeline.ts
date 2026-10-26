import { z } from 'zod';
import { IsoInstant, Sha256 } from './common.js';

// "Ao longo da apuração" (TASK-over-the-count.md §2.2): the national president count, one
// point per published totalization, built offline by scripts/build-count-timeline.ts and
// shipped with the site. Columnar: `at`, `sections`, `valid` and each `votes[i]` are aligned.
// Points exist only where the TSE published one; the UI steps between them, never
// interpolates (invariant 1), and draws nothing across a gap (invariant 6).

const Count = z.number().int().nonnegative();

export const CountTimelineSource = z.discriminatedUnion('kind', [
  /** The TSE's own record of the night (research 03 §4), one row per totalization instant. */
  z.object({ kind: z.literal('totalization-history'), url: z.string(), sha256: Sha256, rows: Count }),
  /** Every version of the national result file our recorder stored (invariant 2). */
  z.object({ kind: z.literal('tse-feed-observed'), path: z.string(), versions: Count }),
]);
export type CountTimelineSource = z.infer<typeof CountTimelineSource>;

export const CountTimeline = z
  .object({
    v: z.literal(1),
    kind: z.literal('count-timeline'),
    office: z.literal('president'),
    year: z.number().int(),
    round: z.union([z.literal(1), z.literal(2)]),
    source: CountTimelineSource,
    sectionsTotal: Count,
    candidates: z.array(z.object({ n: z.number().int(), name: z.string(), party: z.string() })).min(1),
    /** The TSE's instant of each point (Brasília). */
    at: z.array(IsoInstant).min(1),
    /** Sections totalized so far. */
    sections: z.array(Count),
    /** Valid votes so far (the candidates' sum: the share's denominator). */
    valid: z.array(Count),
    /** [candidate][point]. */
    votes: z.array(z.array(Count)),
    /** Stretches where we observed nothing (the recorder was down): no line across them. */
    gaps: z.array(z.object({ from: IsoInstant, to: IsoInstant })),
  })
  .superRefine((t, ctx) => {
    const n = t.at.length;
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (t.sections.length !== n || t.valid.length !== n) issue('sections/valid not aligned with at');
    if (t.votes.length !== t.candidates.length) issue('votes not aligned with candidates');
    for (const [i, v] of t.votes.entries()) if (v.length !== n) issue(`votes[${i}] not aligned with at`);
    for (let k = 1; k < n; k++) {
      if (Date.parse(t.at[k]!) < Date.parse(t.at[k - 1]!)) issue(`at[${k}] goes back in time`);
      if (t.sections[k]! < t.sections[k - 1]!) issue(`sections[${k}] decreases`);
    }
    if (t.sections.some((s) => s > t.sectionsTotal)) issue('more sections than sectionsTotal');
  });
export type CountTimeline = z.infer<typeof CountTimeline>;

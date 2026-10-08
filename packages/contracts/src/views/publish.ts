import { z } from 'zod';
import { Elections, IsoInstant, Sha256 } from './common.js';

/** Which view hash every name had at one `seq` (architecture.md §6.2). Immutable. */
export const Manifest = z.object({
  v: z.literal(1),
  epoch: z.string().regex(/^[a-z0-9-]+$/),
  seq: z.number().int().nonnegative(),
  /** fetchedAt of the newest observation folded in: no wall clock (determinism). */
  publishedAt: IsoInstant,
  elections: Elections,
  views: z.record(z.string(), Sha256),
});
export type Manifest = z.infer<typeof Manifest>;

/** `/data/v1/latest.json`: the only mutable public object. Forward-only in (epoch, seq). */
export const LatestPointer = z.object({
  v: z.literal(1),
  epoch: z.string(),
  seq: z.number().int().nonnegative(),
  manifest: Sha256,
  publishedAt: IsoInstant,
  /** Wall clock of the last pointer write (refreshed every 60 s even with no new seq). */
  refreshedAt: IsoInstant,
  /** The national president file's TSE stamps; null before it is published. */
  tse: z.object({ generatedAt: IsoInstant, totalizedAt: IsoInstant.nullable() }).nullable(),
  health: z.object({
    mode: z.enum(['s3', 'kafka']),
    /** cycleStart of the newest recorder segment seen (heartbeats every 60 s). */
    recorderSeenAt: IsoInstant.nullable(),
  }),
  pollSeconds: z.number().int().positive(),
});
export type LatestPointer = z.infer<typeof LatestPointer>;

import { z } from 'zod';
import { Elections, Sha256 } from './common.js';

// The round selector's index (TASK-web-shell-and-data-hooks.md §2.3). The pointer names one
// epoch; this lists every epoch the site offers, so a past round stays reachable after the
// pointer moves on. Written by `scripts/publish-epochs.ts` (an ops step), never by readers.

export const EPOCHS_KEY = 'data/v1/epochs.json';

export const EpochEntry = z.object({
  epoch: z.string().regex(/^[a-z0-9-]+$/),
  /** What the selector shows, e.g. "1º turno". */
  label: z.string().min(1),
  elections: Elections,
  /**
   * The fixed manifest a past round loads. null for the epoch the pointer follows live
   * (it has no final manifest yet).
   */
  manifest: z.object({ seq: z.number().int().nonnegative(), sha: Sha256 }).nullable(),
});
export type EpochEntry = z.infer<typeof EpochEntry>;

export const EpochsIndex = z.object({
  v: z.literal(1),
  /** Oldest first; epochs are unique. */
  epochs: z
    .array(EpochEntry)
    .min(1)
    .refine((es) => new Set(es.map((e) => e.epoch)).size === es.length, 'duplicate epoch'),
});
export type EpochsIndex = z.infer<typeof EpochsIndex>;

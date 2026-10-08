import { z } from 'zod';

export const ElectionCode = z.enum(['6257', '6258', '6259', '6260']);
export type ElectionCode = z.infer<typeof ElectionCode>;

/** `u` result, `ab` coverage, `cm` municipality index, `c` election catalog (ele-c). */
export const FileType = z.enum(['u', 'ab', 'cm', 'c']);
export type FileType = z.infer<typeof FileType>;

/** `zz` is the abroad aggregate; an abroad city is level `mu` with `uf: 'zz'`. */
export const Scope = z.object({
  level: z.enum(['br', 'uf', 'mu', 'zz']),
  uf: z.string().regex(/^[a-z]{2}$/).optional(),
  mu: z.string().regex(/^\d{5}$/).optional(),
});
export type Scope = z.infer<typeof Scope>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const isoInstant = z.iso.datetime({ offset: true });

/**
 * One line of the internal log: what the recorder saw for one file at one moment
 * (architecture.md §8). The recorder ↔ projector contract.
 */
export const Observation = z.object({
  v: z.literal(1),
  kind: z.enum(['version', 'absent', 'error', 'recovered']),
  path: z.string(), // 'ele2026/6258/dados/sp/sp71072-c0001-e006258-u.jws'
  election: ElectionCode.optional(), // absent only for the catalog
  fileType: FileType,
  scope: Scope.optional(), // absent for the index and the catalog
  sha256: sha256.optional(),
  bytes: z.number().int().nonnegative().optional(),
  etag: z.string().optional(),
  idg: z.string().optional(),
  tseGeneratedAt: isoInstant.optional(), // dg + hg
  tseTotalizedAt: isoInstant.optional(), // dt + ht
  sig: z.enum(['valid', 'invalid']).optional(),
  kid: z.string().optional(),
  schema: z.enum(['ok', 'failed']).optional(),
  regression: z.boolean().optional(),
  anomaly: z.string().optional(),
  httpStatus: z.number().int().optional(),
  error: z.string().optional(),
  fetchedAt: isoInstant,
  recorder: z.string(),
  leaseGeneration: z.number().int().nonnegative(),
  cycleNo: z.number().int().nonnegative(),
  seqInCycle: z.number().int().nonnegative(),
});
export type Observation = z.infer<typeof Observation>;

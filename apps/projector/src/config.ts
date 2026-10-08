import { hostname } from 'node:os';
import { ELECTION_CODES, GOVERNOR_RUNOFF_UFS, UFS, type Election } from '@apuracao/tse';
import { z } from 'zod';

const ElectionList = z.string().transform((s, ctx) => {
  const m = /^president=(\d{4}),governor=(\d{4})$/.exec(s.trim());
  if (!m || !ELECTION_CODES.includes(m[1] as Election) || !ELECTION_CODES.includes(m[2] as Election)) {
    ctx.addIssue({ code: 'custom', message: `ELECTIONS must look like president=6258,governor=6260, got ${s}` });
    return z.NEVER;
  }
  return { president: m[1] as Election, governor: m[2] as Election };
});

const Env = z.object({
  PROJECTOR_ID: z.string().default(hostname()),
  RAW_BUCKET: z.string().min(3),
  AWS_REGION: z.string().default('sa-east-1'),
  S3_ENDPOINT: z.url().optional(), // local emulator only
  /** Where views go: an S3 bucket (apuracao26-pub) or, locally, a directory. */
  PUB_BUCKET: z.string().optional(),
  PUB_DIR: z.string().optional(),
  /** No default on purpose: the 1st round is president=6257,governor=6259; the night is 6258/6260. */
  ELECTIONS: ElectionList,
  /** Comma list; default: the 7 runoff UFs for 6260, all 27 for 6259. */
  GOVERNOR_UFS: z.string().optional(),
  EPOCH: z.string().regex(/^[a-z0-9-]+$/).default('s3-1'),
  /** Replace a pointer that belongs to another epoch (a deliberate switch, runbook). */
  PROMOTE: z.stringbool().default(false),
  TAIL_MS: z.coerce.number().int().positive().default(2_000),
  LOOKBACK_MS: z.coerce.number().int().positive().default(600_000),
  QUIET_MS: z.coerce.number().int().nonnegative().default(2_000),
  MAX_DELAY_MS: z.coerce.number().int().positive().default(10_000),
  CHECKPOINT_EVERY: z.coerce.number().int().positive().default(50),
  POINTER_REFRESH_MS: z.coerce.number().int().positive().default(60_000),
  BLOB_CONCURRENCY: z.coerce.number().int().positive().default(32),
  BLOB_CACHE_MB: z.coerce.number().positive().default(200),
  POLL_SECONDS: z.coerce.number().int().positive().default(20),
  LEASE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  LEASE_RENEW_MS: z.coerce.number().int().positive().default(10_000),
});

export type ProjectorConfig = z.output<typeof Env> & { governorUfs: string[] };

export function loadConfig(env: Record<string, string | undefined> = process.env): ProjectorConfig {
  const c = Env.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  const governorUfs = c.GOVERNOR_UFS
    ? c.GOVERNOR_UFS.split(',').map((s) => s.trim())
    : c.ELECTIONS.governor === '6260'
      ? [...GOVERNOR_RUNOFF_UFS]
      : [...UFS];
  for (const uf of governorUfs) if (!(UFS as readonly string[]).includes(uf)) throw new Error(`GOVERNOR_UFS: unknown UF ${uf}`);
  return { ...c, governorUfs };
}

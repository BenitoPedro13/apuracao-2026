import { hostname } from 'node:os';
import { refuseTestKeyInProduction } from '@apuracao/s3kit';
import { ELECTION_CODES, TSE_BASE_URL, type Election } from '@apuracao/tse';
import { z } from 'zod';

/**
 * election:office:cadence[:uf], cadence = 'expires' or a minimum re-poll interval in seconds.
 * `:uf` = aggregate-only: the UF result files, no municipality or coverage files
 * (TASK-legislative-archive.md §2.1).
 */
export interface Target {
  election: Election;
  office: number;
  /** null = poll at each file's Expires; a number = no more often than every N seconds. */
  minIntervalS: number | null;
  ufOnly: boolean;
}

const TargetList = z.string().transform((s, ctx) =>
  s.split(',').map((part): Target => {
    const [election, office, cadence, scope, ...rest] = part.trim().split(':');
    if (!ELECTION_CODES.includes(election as Election) || !/^\d+$/.test(office ?? '') || !cadence || (scope !== undefined && scope !== 'uf') || rest.length) {
      ctx.addIssue({ code: 'custom', message: `bad target ${part}` });
      return z.NEVER;
    }
    return {
      election: election as Election,
      office: Number(office),
      minIntervalS: cadence === 'expires' ? null : Number(cadence),
      ufOnly: scope === 'uf',
    };
  }),
);

const Env = z.object({
  RECORDER_ID: z.string().default(hostname()),
  // 1st round: captured once, then a slow soak (frozen files). 2nd round: discovery, then
  // each file at its Expires (TASK-recorder.md §2.1). Senate and deputies: 1st-round UF
  // files only, soaked like the rest (TASK-legislative-archive.md §2.1).
  RECORDER_TARGETS: z
    .string()
    .default('6257:1:600,6259:3:600,6258:1:expires,6260:3:expires,6259:5:600:uf,6259:6:600:uf,6259:7:600:uf,6259:8:600:uf')
    .pipe(TargetList),
  RATE_MAX: z.coerce.number().positive().default(10),
  CONCURRENCY: z.coerce.number().int().positive().default(16),
  RAW_BUCKET: z.string().min(3),
  AWS_REGION: z.string().default('sa-east-1'),
  S3_ENDPOINT: z.url().optional(), // local emulator only
  /** Governance-mode Object Lock retention on raw/ and obs/ writes. Off for the emulator. */
  OBJECT_LOCK_YEARS: z.coerce.number().int().nonnegative().default(10),
  TSE_BASE_URL: z.url().default(TSE_BASE_URL),
  /** fake-tse's test key (replays only). Refused with a production bucket. */
  TSE_TEST_JWK_URL: z.url().optional(),
  USER_AGENT: z.string().default('apuracao-2026-recorder/0.1 (public vote-count dashboard; polite polling)'),
  FLUSH_MS: z.coerce.number().int().positive().default(5_000),
  HEARTBEAT_MS: z.coerce.number().int().positive().default(60_000),
  SNAPSHOT_MS: z.coerce.number().int().positive().default(60_000),
  JITTER_MIN_MS: z.coerce.number().int().nonnegative().default(1_000),
  JITTER_MAX_MS: z.coerce.number().int().nonnegative().default(3_000),
  DISCOVERY_CONFIG_S: z.coerce.number().positive().default(300),
  DISCOVERY_PROBE_S: z.coerce.number().positive().default(60),
  ABSENT_RETRY_S: z.coerce.number().positive().default(60),
  PENDING_MAX_TRIES: z.coerce.number().int().positive().default(5),
  LEASE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  LEASE_RENEW_MS: z.coerce.number().int().positive().default(10_000),
});

export type RecorderConfig = z.output<typeof Env>;

export function loadConfig(env: Record<string, string | undefined> = process.env): RecorderConfig {
  const config = Env.parse(env);
  refuseTestKeyInProduction(config.TSE_TEST_JWK_URL, { RAW_BUCKET: config.RAW_BUCKET });
  return config;
}

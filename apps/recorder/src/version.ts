import { createHash } from 'node:crypto';
import { tseInstant, type Observation } from '@apuracao/contracts';
import { parseTseFile, verifyJws, type JwsResult, type Keyring } from '@apuracao/tse';

// The rules of architecture.md §4.4, as a pure function of (previous state, what was
// fetched). IO lives in recorder.ts.

export interface PathState {
  etag?: string;
  sha256?: string;
  /** Highest idg accepted for this path, and the sha first accepted at that idg. */
  maxIdg?: number;
  shaAtMaxIdg?: string;
  everSeen: boolean;
  absent: boolean;
  inError: boolean;
  failures: number;
  pendingTries: number;
}

export const emptyState = (): PathState => ({ everSeen: false, absent: false, inError: false, failures: 0, pendingTries: 0 });

export interface Analysis {
  sha256: string;
  bytes: number;
  sig: JwsResult;
  schemaOk: boolean;
  schemaIssues: string[];
  idg?: number;
  tseGeneratedAt?: string;
  tseTotalizedAt?: string;
  /** The validated JSON payload, when the schema passed. */
  data?: unknown;
}

const decodePayload = (token: string): Uint8Array | undefined => {
  const p = token.trim().split('.')[1];
  return p ? Buffer.from(p, 'base64url') : undefined;
};

const instant = (d: unknown, t: unknown) => {
  try {
    return typeof d === 'string' && typeof t === 'string' ? tseInstant(d, t) : undefined;
  } catch {
    return undefined;
  }
};

/** sha256, signature, schema and header fields of one fetched body. */
export async function analyze(path: string, body: Buffer, keys: Keyring): Promise<Analysis> {
  const sha256 = createHash('sha256').update(body).digest('hex');
  const token = body.toString('utf8');
  const sig = path.endsWith('.jws')
    ? await verifyJws(token, keys)
    : ({ status: 'malformed', reason: 'not a .jws' } as const);
  // Parse the payload even when the signature fails, so the observation still carries idg.
  const payload = sig.status === 'valid' ? sig.payload : decodePayload(token);
  const parsed = payload ? parseTseFile(path, payload) : { ok: false as const, issues: ['no payload'] };
  let header: Record<string, unknown>;
  try {
    header = payload ? (JSON.parse(Buffer.from(payload).toString('utf8')) as Record<string, unknown>) : {};
  } catch {
    header = {};
  }
  const idg = typeof header['idg'] === 'string' && /^\d+$/.test(header['idg']) ? Number(header['idg']) : undefined;
  return {
    sha256,
    bytes: body.length,
    sig,
    schemaOk: parsed.ok,
    schemaIssues: parsed.ok ? [] : parsed.issues,
    idg,
    tseGeneratedAt: instant(header['dg'], header['hg']),
    tseTotalizedAt: instant(header['dt'], header['ht']),
    data: parsed.ok ? parsed.data : undefined,
  };
}

export type Fetched =
  | { kind: 'ok'; etag?: string; analysis: Analysis }
  | { kind: 'not_modified' }
  | { kind: 'not_found' }
  | { kind: 'failed'; error: string; status?: number };

/** Observation fields this module decides; recorder.ts adds identity and timing. */
export type ObservationCore = Pick<
  Observation,
  'kind' | 'sha256' | 'bytes' | 'etag' | 'idg' | 'tseGeneratedAt' | 'tseTotalizedAt' | 'sig' | 'kid' | 'schema' | 'regression' | 'anomaly' | 'httpStatus' | 'error'
>;

export interface Decision {
  state: PathState;
  observation?: ObservationCore;
  /** Store the blob (new bytes). */
  store: boolean;
  /** This version becomes the current accepted state of the path. */
  accept: boolean;
  /** Re-fetch soon: tier-2 file still older than the coverage row that triggered it. */
  pending: boolean;
  /** Retry after a failure (with backoff). */
  retry: boolean;
}

export const ERROR_AFTER_FAILURES = 3;

export function decide(prev: PathState, fetched: Fetched, trigger?: string): Decision {
  const state = { ...prev };
  const none = { store: false, accept: false, pending: false, retry: false };

  if (fetched.kind === 'failed') {
    state.failures += 1;
    if (state.failures >= ERROR_AFTER_FAILURES && !state.inError) {
      state.inError = true;
      return { ...none, state, retry: true, observation: { kind: 'error', error: fetched.error, httpStatus: fetched.status } };
    }
    return { ...none, state, retry: true };
  }

  const wasInError = state.inError;
  state.failures = 0;
  state.inError = false;
  const recovered: ObservationCore | undefined = wasInError ? { kind: 'recovered' } : undefined;

  if (fetched.kind === 'not_found') {
    if (state.everSeen && !state.absent) {
      state.absent = true;
      return { ...none, state, observation: { kind: 'absent', httpStatus: 404 } };
    }
    return { ...none, state, observation: recovered };
  }

  if (fetched.kind === 'not_modified') {
    const pending = trigger !== undefined && state.pendingTries > 0;
    return { ...none, state, pending, observation: recovered };
  }

  const a = fetched.analysis;
  state.etag = fetched.etag;
  const sameBytes = state.sha256 === a.sha256 && !state.absent;
  state.absent = false;
  state.everSeen = true;

  const olderThanTrigger = trigger !== undefined && a.tseTotalizedAt !== undefined && a.tseTotalizedAt < trigger;
  state.pendingTries = olderThanTrigger ? state.pendingTries + 1 : 0;

  if (sameBytes) {
    return { ...none, state, pending: olderThanTrigger, observation: recovered };
  }
  state.sha256 = a.sha256;

  const trusted = a.sig.status === 'valid' && a.schemaOk;
  let regression: boolean | undefined;
  let anomaly: string | undefined;
  let accept = trusted;
  if (a.idg !== undefined && state.maxIdg !== undefined) {
    if (a.idg < state.maxIdg) {
      regression = true;
      accept = false;
    } else if (a.idg === state.maxIdg && a.sha256 !== state.shaAtMaxIdg) {
      anomaly = 'same-idg-different-bytes';
      accept = false;
    }
  }
  if (accept && a.idg !== undefined) {
    state.maxIdg = a.idg;
    state.shaAtMaxIdg = a.sha256;
  }

  return {
    state,
    store: true,
    accept,
    pending: olderThanTrigger,
    retry: false,
    observation: {
      kind: 'version',
      sha256: a.sha256,
      bytes: a.bytes,
      etag: fetched.etag,
      idg: a.idg?.toString(),
      tseGeneratedAt: a.tseGeneratedAt,
      tseTotalizedAt: a.tseTotalizedAt,
      sig: a.sig.status === 'valid' ? 'valid' : 'invalid',
      kid: 'kid' in a.sig ? a.sig.kid : undefined,
      schema: a.schemaOk ? 'ok' : 'failed',
      regression,
      anomaly,
      httpStatus: 200,
    },
  };
}

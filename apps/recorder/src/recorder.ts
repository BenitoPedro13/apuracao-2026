import type { S3Client } from '@aws-sdk/client-s3';
import type { Observation, TseCoverageFile } from '@apuracao/contracts';
import { catalogPath, importKeys, parsePath, type Area, type TseJwk } from '@apuracao/tse';
import pinnedKey from '@apuracao/tse/keys/prod.jwk.json' with { type: 'json' };
import { backoffMs, Budget } from './budget.js';
import type { RecorderConfig, Target } from './config.js';
import { changedMunicipalities, indexCoverage, type CoverageRowKey } from './coverage.js';
import type { Fetcher, FetchOutcome } from './fetch.js';
import { Lease } from './lease.js';
import { Metrics } from './metrics.js';
import { nextDueFromHeaders, Schedule } from './schedule.js';
import { RawStore, segmentKey } from './store.js';
import { configFiles, municipalFile, probePaths, tier1Files, type TrackedFile } from './targets.js';
import { analyze, decide, emptyState, type Fetched, type PathState } from './version.js';

// The poll loop (architecture.md §4): schedule → budget → conditional GET → verify/parse →
// store blob → observation → reschedule. Only the lease holder polls.

export const SNAPSHOT_KEY = 'state/recorder/v1/snapshot.json.gz';
const JWK_PATH = 'app/assets/assinatura-jws/prod.jwk.json';

interface Snapshot {
  v: 1;
  savedAt: string;
  active: string[];
  paths: Record<string, { state: PathState; dueAt?: number; notBefore?: number; trigger?: string; notFound?: number }>;
  coverage: Record<string, Record<string, CoverageRowKey>>;
}

export interface RecorderDeps {
  config: RecorderConfig;
  s3: S3Client;
  fetcher: Fetcher;
  now?: () => number;
  random?: () => number;
  log?: (event: Record<string, unknown>) => void;
  emf?: (line: string) => void;
}

const targetKey = (t: Target) => `${t.election}:${t.office}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createRecorder(deps: RecorderDeps) {
  const { config, fetcher } = deps;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const log = deps.log ?? ((e) => console.log(JSON.stringify({ t: new Date(now()).toISOString(), ...e })));
  const store = new RawStore(deps.s3, config.RAW_BUCKET, config.OBJECT_LOCK_YEARS, now);
  const metrics = new Metrics({ Recorder: config.RECORDER_ID }, deps.emf, now);
  const budget = new Budget({ rateMax: config.RATE_MAX, concurrency: config.CONCURRENCY, now });
  const schedule = new Schedule();
  const lease = new Lease({
    s3: deps.s3,
    bucket: config.RAW_BUCKET,
    holder: config.RECORDER_ID,
    ttlMs: config.LEASE_TTL_MS,
    renewMs: config.LEASE_RENEW_MS,
    now,
    onChange: (leader, generation) => {
      log({ msg: leader ? 'lease acquired' : 'lease lost', generation });
      metrics.gauge('lease_held', leader ? 1 : 0);
    },
  });

  const tracked = new Map<string, TrackedFile>();
  const states = new Map<string, PathState>();
  const dueAt = new Map<string, number>();
  /** The Expires of the last response per path: nothing is ever scheduled before it (invariant 4). */
  const notBefore = new Map<string, number>();
  const triggers = new Map<string, string | undefined>();
  const notFound = new Map<string, number>();
  const coverage = new Map<string, Record<string, CoverageRowKey>>();
  const active = new Set<string>();
  const keys = new Map<string, CryptoKey>();
  let buffer: Omit<Observation, 'cycleNo' | 'seqInCycle'>[] = [];
  let cycleNo = 0;
  let cycleStart = new Date(now());
  let lastSegmentAt = now();
  let running = false;
  const inFlight = new Set<Promise<void>>();
  const inFlightPaths = new Set<string>();
  const timers: NodeJS.Timeout[] = [];

  const jitter = () => config.JITTER_MIN_MS + random() * (config.JITTER_MAX_MS - config.JITTER_MIN_MS);

  function scheduleAt(path: string, at: number): void {
    const due = Math.max(at, notBefore.get(path) ?? 0);
    schedule.add(path, due);
    dueAt.set(path, Math.min(due, dueAt.get(path) ?? Infinity));
  }

  function activate(target: Target, at: number): void {
    if (active.has(targetKey(target))) return;
    active.add(targetKey(target));
    log({ msg: 'election active', election: target.election, office: target.office });
    for (const f of tier1Files(target)) {
      tracked.set(f.path, f);
      if (!schedule.has(f.path) && !inFlightPaths.has(f.path)) scheduleAt(f.path, at);
    }
  }

  function fileFor(path: string): TrackedFile | undefined {
    const known = tracked.get(path);
    if (known) return known;
    const info = parsePath(path);
    const target = config.RECORDER_TARGETS.find((t) => t.election === info.election && t.office === info.office);
    if (!target || info.scope?.level !== 'mu') return undefined;
    const file = municipalFile(target, info.scope.uf as Area, info.scope.mu!);
    tracked.set(path, file);
    return file;
  }

  async function restore(): Promise<void> {
    const snap = await store.getJsonGz<Snapshot>(SNAPSHOT_KEY);
    if (!snap) return log({ msg: 'no snapshot: cold start' });
    for (const k of snap.active) active.add(k);
    for (const [path, p] of Object.entries(snap.paths)) {
      states.set(path, p.state);
      if (p.trigger !== undefined) triggers.set(path, p.trigger);
      if (p.notFound) notFound.set(path, p.notFound);
      if (p.notBefore) notBefore.set(path, p.notBefore);
      if (p.dueAt !== undefined && fileFor(path)) scheduleAt(path, p.dueAt);
    }
    for (const [path, idx] of Object.entries(snap.coverage)) coverage.set(path, idx);
    log({ msg: 'restored snapshot', savedAt: snap.savedAt, paths: states.size, active: [...active] });
  }

  async function snapshot(): Promise<void> {
    if (!lease.isLeader) return;
    const paths: Snapshot['paths'] = {};
    for (const [path, state] of states) paths[path] = { state };
    for (const [path, at] of dueAt) (paths[path] ??= { state: states.get(path) ?? emptyState() }).dueAt = at;
    for (const [path, trig] of triggers) (paths[path] ??= { state: states.get(path) ?? emptyState() }).trigger = trig;
    for (const [path, n] of notFound) (paths[path] ??= { state: states.get(path) ?? emptyState() }).notFound = n;
    for (const [path, t] of notBefore) if (t > now()) (paths[path] ??= { state: states.get(path) ?? emptyState() }).notBefore = t;
    const snap: Snapshot = { v: 1, savedAt: new Date(now()).toISOString(), active: [...active], paths, coverage: Object.fromEntries(coverage) };
    await store.putJsonGz(SNAPSHOT_KEY, snap);
  }

  async function flush(force = false): Promise<void> {
    const heartbeatDue = lease.isLeader && now() - lastSegmentAt >= config.HEARTBEAT_MS;
    if (buffer.length === 0 && !heartbeatDue && !force) return;
    if (buffer.length === 0 && force && !lease.isLeader) return;
    const batch = buffer;
    buffer = [];
    const start = cycleStart;
    cycleStart = new Date(now());
    for (;;) {
      const no = cycleNo++;
      const observations = batch.map((o, seqInCycle) => ({ ...o, cycleNo: no, seqInCycle }) as Observation);
      try {
        if ((await store.putSegment(segmentKey(config.RECORDER_ID, start, no), observations)) === 'exists') continue;
        lastSegmentAt = now();
        metrics.count('segments_written');
        return;
      } catch (err) {
        log({ msg: 'segment write failed', error: (err as Error).message });
        buffer = [...batch, ...buffer]; // keep them; next flush retries
        cycleStart = start;
        return;
      }
    }
  }

  async function handleUnknownKid(kid: string): Promise<boolean> {
    const res = await fetcher.get(JWK_PATH);
    if (res.kind !== 'ok') return false;
    const jwk = JSON.parse(res.body.toString('utf8')) as TseJwk;
    if (jwk.kid !== kid) return false;
    for (const [k, v] of await importKeys([jwk])) keys.set(k, v);
    await store.putKey(kid, jwk);
    metrics.count('key_rotation');
    log({ msg: 'new TSE key accepted: confirm the rotation', kid, level: 'page' });
    return true;
  }

  function observe(file: TrackedFile, core: NonNullable<ReturnType<typeof decide>['observation']>, fetchedAt: number): void {
    const info = parsePath(file.path);
    buffer.push({
      v: 1,
      path: file.path,
      election: info.election,
      fileType: info.fileType,
      scope: info.scope,
      ...core,
      fetchedAt: new Date(fetchedAt).toISOString(),
      recorder: config.RECORDER_ID,
      leaseGeneration: lease.generation,
    });
    if (core.sig === 'invalid') metrics.count('sig_invalid_total');
    if (core.schema === 'failed') metrics.count('schema_failed_total');
    if (core.regression) metrics.count('regressions_total');
    if (core.anomaly) metrics.count('anomalies_total');
  }

  async function process(path: string): Promise<void> {
    const file = fileFor(path);
    if (!file) return;
    const prev = states.get(path) ?? emptyState();
    const started = now();
    const outcome: FetchOutcome = await fetcher.get(path, prev.etag);
    const failed = outcome.kind === 'failed' || (outcome.kind === 'ok' && outcome.etagMismatch);
    budget.release({
      failed,
      pushback: outcome.kind === 'failed' && outcome.pushback,
      retryAfterS: outcome.kind === 'failed' ? outcome.retryAfterS : undefined,
    });
    const statusClass = outcome.kind === 'ok' ? '200' : outcome.kind === 'not_modified' ? '304' : outcome.kind === 'not_found' ? '404' : 'error';
    metrics.count('tse_requests_total', { Status: statusClass, Tier: String(file.tier) });
    if (failed) {
      const error = outcome.kind === 'failed' ? outcome.error : 'etag does not match the MD5 of the body';
      log({ msg: 'fetch failed', path, status: outcome.kind === 'failed' ? outcome.status : 200, error, failures: prev.failures + 1 });
    }

    let fetched: Fetched;
    if (outcome.kind === 'ok' && !outcome.etagMismatch) {
      let analysis = await analyze(path, outcome.body, keys);
      if (analysis.sig.status === 'unknown_kid' && (await handleUnknownKid(analysis.sig.kid))) {
        analysis = await analyze(path, outcome.body, keys);
      }
      fetched = { kind: 'ok', etag: outcome.etag, analysis };
    } else if (outcome.kind === 'ok') {
      fetched = { kind: 'failed', error: 'etag does not match the MD5 of the body' };
    } else if (outcome.kind === 'failed') {
      fetched = { kind: 'failed', error: outcome.error, status: outcome.status };
    } else {
      fetched = { kind: outcome.kind };
    }

    const trigger = file.tier === 2 ? triggers.get(path) : undefined;
    const decision = decide(prev, fetched, trigger);
    if (decision.store && outcome.kind === 'ok') {
      try {
        await store.putBlob(decision.observation!.sha256!, outcome.body);
      } catch (err) {
        // Not stored → don't advance state; try again soon.
        log({ msg: 'blob write failed', path, error: (err as Error).message });
        scheduleAt(path, now() + backoffMs(1, random) + 1_000);
        return;
      }
    }
    states.set(path, decision.state);
    if (decision.observation) observe(file, decision.observation, started);
    if (decision.state.absent !== prev.absent || decision.state.inError !== prev.inError) {
      log({ msg: 'path state', path, absent: decision.state.absent, inError: decision.state.inError });
    }
    if (outcome.kind === 'ok') metrics.gauge('tse_last_success_at', now() / 1000, { Class: classOf(file) }, 'Seconds');

    // Discovery: a probe answering 200 means the election is live.
    if (outcome.kind === 'ok' && probePaths(file.target).includes(path)) activate(file.target, now() + jitter());

    // Tier 1 → tier 2.
    if (decision.accept && file.kind === 'coverage' && fetched.kind === 'ok' && fetched.analysis.data) {
      // `data` already passed TseCoverageFile in parseTseFile (accept implies schema ok).
      const next = indexCoverage(fetched.analysis.data as TseCoverageFile);
      const area = parsePath(path).scope?.uf ?? 'br';
      const changed = changedMunicipalities(coverage.get(path), next);
      coverage.set(path, next);
      for (const { mu, instant } of changed) {
        const mf = municipalFile(file.target, area as Area, mu);
        tracked.set(mf.path, mf);
        triggers.set(mf.path, instant);
        notFound.delete(mf.path);
        scheduleAt(mf.path, now());
      }
      if (changed.length) log({ msg: 'coverage changed', path, municipalities: changed.length });
    }

    reschedule(file, outcome, decision);
  }

  function classOf(file: TrackedFile): string {
    if (file.kind === 'municipal') return 'mun';
    if (file.kind === 'coverage') return 'ab';
    if (file.kind === 'config') return 'config';
    return file.national ? 'br' : 'uf-agg';
  }

  function reschedule(file: TrackedFile, outcome: FetchOutcome, decision: ReturnType<typeof decide>): void {
    const t = now();
    dueAt.delete(file.path);
    const expires = outcome.headers.expires ? Date.parse(outcome.headers.expires) : NaN;
    if (!Number.isNaN(expires)) notBefore.set(file.path, expires);
    const fromHeaders = (fallbackS: number) => nextDueFromHeaders(outcome.headers, t, jitter, fallbackS);

    if (decision.retry) return scheduleAt(file.path, t + Math.max(1_000, backoffMs(decision.state.failures, random)));

    if (file.tier === 2) {
      if (outcome.kind === 'not_found' && !decision.state.everSeen) {
        const tries = (notFound.get(file.path) ?? 0) + 1;
        notFound.set(file.path, tries);
        if (tries < config.PENDING_MAX_TRIES) return scheduleAt(file.path, t + config.ABSENT_RETRY_S * 1000 + jitter());
        metrics.count('tse_stuck_mun');
        return void triggers.delete(file.path);
      }
      if (decision.pending && decision.state.pendingTries < config.PENDING_MAX_TRIES) {
        return scheduleAt(file.path, fromHeaders(config.ABSENT_RETRY_S));
      }
      if (decision.pending) metrics.count('tse_stuck_mun');
      notFound.delete(file.path);
      return void triggers.delete(file.path);
    }

    const target = file.target;
    if (file.kind === 'config') return scheduleAt(file.path, Math.max(fromHeaders(config.DISCOVERY_CONFIG_S), t + config.DISCOVERY_CONFIG_S * 1000));
    if (!active.has(targetKey(target))) {
      // Still discovering: only the probes poll, at the probe interval.
      if (probePaths(target).includes(file.path)) scheduleAt(file.path, Math.max(fromHeaders(config.DISCOVERY_PROBE_S), t + config.DISCOVERY_PROBE_S * 1000));
      return;
    }
    if (outcome.kind === 'not_found') return scheduleAt(file.path, Math.max(fromHeaders(config.ABSENT_RETRY_S), t + config.ABSENT_RETRY_S * 1000));
    const minNext = target.minIntervalS === null ? 0 : t + target.minIntervalS * 1000;
    scheduleAt(file.path, Math.max(fromHeaders(60), minNext));
  }

  async function loop(): Promise<void> {
    while (running) {
      if (!lease.isLeader) {
        await sleep(500);
        continue;
      }
      const wait = budget.waitMs();
      if (wait > 0) {
        await sleep(Math.min(wait, 1_000));
        continue;
      }
      const t = now();
      const path = budget.breakerOpen
        ? schedule.popDueWhere(t, (p) => tracked.get(p)?.national ?? false)
        : schedule.popDue(t);
      if (!path) {
        const next = schedule.peekDue();
        await sleep(Math.max(5, Math.min(next === undefined ? 1_000 : next - t, 1_000)));
        continue;
      }
      dueAt.delete(path);
      budget.acquire();
      inFlightPaths.add(path);
      const p = process(path)
        .catch((err: unknown) => {
          log({ msg: 'process failed', path, error: (err as Error).message });
          scheduleAt(path, now() + 5_000);
        })
        .finally(() => {
          inFlight.delete(p);
          inFlightPaths.delete(path);
        });
      inFlight.add(p);
    }
  }

  return {
    async start(): Promise<void> {
      for (const [k, v] of await importKeys([pinnedKey as TseJwk])) keys.set(k, v);
      // Register every tier-0/1 file first, so the snapshot can restore their due times.
      const first = config.RECORDER_TARGETS[0]!;
      const roots: TrackedFile[] = [{ path: catalogPath(), tier: 0, target: first, kind: 'config', national: false }];
      for (const target of config.RECORDER_TARGETS) roots.push(...configFiles(target), ...tier1Files(target));
      for (const f of roots) tracked.set(f.path, f);
      await restore();
      const t = now();
      for (const f of roots.filter((x) => x.tier === 0)) if (!schedule.has(f.path)) scheduleAt(f.path, t);
      for (const target of config.RECORDER_TARGETS) {
        if (active.has(targetKey(target))) {
          active.delete(targetKey(target));
          activate(target, t);
        } else {
          for (const path of probePaths(target)) if (!schedule.has(path)) scheduleAt(path, t);
        }
      }
      await lease.start();
      running = true;
      timers.push(setInterval(() => void flush(), config.FLUSH_MS));
      timers.push(setInterval(() => void snapshot().catch((e: unknown) => log({ msg: 'snapshot failed', error: (e as Error).message })), config.SNAPSHOT_MS));
      timers.push(
        setInterval(() => {
          metrics.gauge('tse_scheduled', schedule.size);
          metrics.gauge('tse_pending_mun', triggers.size);
          metrics.gauge('rate_limit', budget.rate);
          metrics.gauge('breaker_open', budget.breakerOpen ? 1 : 0);
          for (const t of config.RECORDER_TARGETS) metrics.gauge('targets_active', active.has(targetKey(t)) ? 1 : 0, { Election: t.election });
          metrics.flush();
        }, 60_000),
      );
      void loop();
      log({ msg: 'recorder started', id: config.RECORDER_ID, targets: config.RECORDER_TARGETS, rateMax: config.RATE_MAX });
    },

    async stop(): Promise<void> {
      running = false;
      for (const t of timers) clearInterval(t);
      await Promise.allSettled(inFlight);
      await flush(true);
      await snapshot().catch(() => undefined);
      await lease.stop();
      metrics.flush();
      log({ msg: 'recorder stopped' });
    },

    /** Simulates a crash (tests): stops polling and timers without flushing or releasing the lease. */
    async abort(): Promise<void> {
      running = false;
      for (const t of timers) clearInterval(t);
      lease.abandon();
      await Promise.allSettled(inFlight);
    },

    get isLeader() {
      return lease.isLeader;
    },
    get stats() {
      return { tracked: tracked.size, scheduled: schedule.size, buffered: buffer.length, active: [...active], generation: lease.generation };
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;

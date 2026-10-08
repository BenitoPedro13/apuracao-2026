import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Manifest, type LatestPointer, type Observation } from '@apuracao/contracts';
import { Lease, PROJECTOR_LEASE_KEY } from '@apuracao/s3kit';
import { importKeys, resultPath, OFFICES, type Keyring, type TseJwk } from '@apuracao/tse';
import pinnedKey from '@apuracao/tse/keys/prod.jwk.json' with { type: 'json' };
import {
  buildManifest,
  classify,
  emptyState,
  encodeView,
  fold,
  needsBlob,
  prepare,
  reconcile,
  render,
  type EncodedView,
  type Prepared,
  type ViewState,
  type ViewsConfig,
} from '@apuracao/views';
import { BlobReader, mapLimit } from './blobs.js';
import type { ProjectorConfig } from './config.js';
import { manifestKey, viewKey, type Publisher } from './publisher.js';
import { SegmentSource, type SegmentRef, type SourcePosition } from './source.js';

// The projector (architecture.md §5.4, TASK-projector-and-views.md §2.3), S3 mode: tail the
// recorder's segments → fold → debounce → publish objects, then the manifest, then the
// pointer. Checkpoints hold state + source position together.

export const checkpointPrefix = (epoch: string) => `checkpoints/projector/${epoch}/`;

interface Checkpoint {
  v: 1;
  epoch: string;
  seq: number;
  savedAt: string;
  views: ViewsConfig;
  state: ViewState;
  position: SourcePosition;
}

export interface ProjectorDeps {
  config: ProjectorConfig;
  s3: S3Client;
  publisher: Publisher;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
}

export interface Timings {
  listMs: number;
  segmentsMs: number;
  blobsMs: number;
  foldMs: number;
  renderMs: number;
  publishMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** Segments read (and blobs prefetched) per batch. */
const BATCH = 64;

export function createProjector(deps: ProjectorDeps) {
  const { config, s3, publisher } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((e) => console.log(JSON.stringify({ t: new Date(now()).toISOString(), ...e })));
  const views: ViewsConfig = { elections: config.ELECTIONS, governorUfs: config.governorUfs };
  const source = new SegmentSource(s3, config.RAW_BUCKET, config.LOOKBACK_MS);
  const blobs = new BlobReader(s3, config.RAW_BUCKET, config.BLOB_CACHE_MB * 1024 * 1024);
  const timings: Timings = { listMs: 0, segmentsMs: 0, blobsMs: 0, foldMs: 0, renderMs: 0, publishMs: 0 };
  const stats = { segments: 0, observations: 0, invalidLines: 0, changes: 0, rejected: {} as Record<string, number>, publishes: 0, viewsPut: 0 };

  let state = emptyState();
  let seq = 0;
  let keys: Keyring = new Map();
  /** View name → sha last published, so unchanged views aren't re-put. */
  const published = new Map<string, string>();
  let publishedSeq = -1;
  let lastManifest: { sha: string; seq: number; publishedAt: string } | undefined;

  async function loadKeys(): Promise<void> {
    const jwks: TseJwk[] = [pinnedKey as TseJwk];
    const res = await s3.send(new ListObjectsV2Command({ Bucket: config.RAW_BUCKET, Prefix: 'meta/keys/' }));
    for (const o of res.Contents ?? []) {
      const body = await s3.send(new GetObjectCommand({ Bucket: config.RAW_BUCKET, Key: o.Key! }));
      jwks.push(JSON.parse(await body.Body!.transformToString()) as TseJwk);
    }
    keys = await importKeys(jwks);
  }

  async function timed<T>(phase: keyof Timings, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      timings[phase] += performance.now() - t0;
    }
  }

  /** Fold segments in order. Blobs a batch may need are fetched and prepared in parallel first. */
  async function ingest(refs: SegmentRef[]): Promise<number> {
    let changes = 0;
    for (let i = 0; i < refs.length; i += BATCH) {
      const batch = refs.slice(i, i + BATCH);
      const segments = await timed('segmentsMs', () => mapLimit(batch, 16, (r) => source.read(r)));
      const wanted = new Map<string, Observation>();
      for (const seg of segments) {
        stats.invalidLines += seg.invalid;
        for (const o of seg.observations) if (needsBlob(state, o, views)) wanted.set(`${o.path}|${o.sha256}`, o);
      }
      const prepared = new Map<string, Prepared>();
      await timed('blobsMs', () =>
        mapLimit([...wanted.entries()], config.BLOB_CONCURRENCY, async ([k, o]) => {
          prepared.set(k, await prepare(o.path, classify(o.path, views)!, await blobs.get(o.sha256!), keys));
        }),
      );
      const t0 = performance.now();
      batch.forEach((ref, j) => {
        for (const o of segments[j]!.observations) {
          stats.observations++;
          const r = fold(state, o, views, needsBlob(state, o, views) ? prepared.get(`${o.path}|${o.sha256}`) : undefined);
          if (r.rejected) {
            stats.rejected[r.rejected] = (stats.rejected[r.rejected] ?? 0) + 1;
            log({ msg: 'version rejected', path: o.path, sha256: o.sha256, reason: r.rejected });
          }
          if (r.changed) {
            seq++;
            changes++;
          }
        }
        stats.segments++;
        source.done(ref);
      });
      timings.foldMs += performance.now() - t0;
    }
    stats.changes += changes;
    return changes;
  }

  function pointerTse(): LatestPointer['tse'] {
    const br = state.paths[resultPath(config.ELECTIONS.president, OFFICES.president, 'br')]?.accepted?.data;
    return br?.kind === 'result' ? { generatedAt: br.generatedAt, totalizedAt: br.totalizedAt } : null;
  }

  /** Move the pointer forward only: same epoch and seq ≥ current, or --promote (TASK §2.4 item 9). */
  async function advancePointer(m: { sha: string; seq: number; publishedAt: string }): Promise<'moved' | 'behind' | 'conflict'> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await publisher.readPointer();
      if (cur && (cur.pointer.epoch === config.EPOCH ? cur.pointer.seq > m.seq : !config.PROMOTE)) return 'behind';
      const seenAt = source.newestAt;
      const next: LatestPointer = {
        v: 1,
        epoch: config.EPOCH,
        seq: m.seq,
        manifest: m.sha,
        publishedAt: m.publishedAt,
        refreshedAt: new Date(now()).toISOString(),
        tse: pointerTse(),
        health: { mode: 's3', recorderSeenAt: seenAt === undefined ? null : new Date(seenAt).toISOString() },
        pollSeconds: config.POLL_SECONDS,
      };
      if (await publisher.writePointer(next, cur?.etag)) return 'moved';
    }
    return 'conflict';
  }

  /** Objects first, then the manifest, then the pointer: no reader can see a torn state. */
  async function publish(): Promise<{ manifest: EncodedView; pointer: string; views: number; changedViews: number } | undefined> {
    if (state.newestAt === null) return undefined;
    const t0 = performance.now();
    const encoded = [...render(state, views).views].map(([name, json]) => encodeView(name, json));
    timings.renderMs += performance.now() - t0;
    return timed('publishMs', async () => {
      const changed = encoded.filter((v) => published.get(v.name) !== v.sha256);
      await mapLimit(changed, 16, (v) => publisher.putImmutable(viewKey(v.sha256), v.bytes));
      for (const v of changed) published.set(v.name, v.sha256);
      stats.viewsPut += changed.length;

      let manifest = buildManifest({ epoch: config.EPOCH, seq, publishedAt: state.newestAt!, elections: views.elections, views: encoded });
      if ((await publisher.putImmutable(manifestKey(config.EPOCH, seq), manifest.bytes)) === 'exists') {
        // Same seq published before (a restart, or a briefly double-active projector).
        const existing = (await publisher.getBytes(manifestKey(config.EPOCH, seq)))!;
        if (sha256(existing) !== manifest.sha256) {
          const theirs = Manifest.parse(JSON.parse(Buffer.from(existing).toString('utf8')));
          const ours = Manifest.parse(JSON.parse(Buffer.from(manifest.bytes).toString('utf8')));
          if (JSON.stringify(theirs.views) !== JSON.stringify(ours.views)) {
            log({ msg: 'manifest conflict: a different state was published at this seq; pointer not moved', seq, level: 'warn' });
            return { manifest, pointer: 'conflict', views: encoded.length, changedViews: changed.length };
          }
          manifest = { ...manifest, sha256: sha256(existing), bytes: existing };
        }
      }
      lastManifest = { sha: manifest.sha256, seq, publishedAt: state.newestAt! };
      const pointer = await advancePointer(lastManifest);
      publishedSeq = seq;
      stats.publishes++;
      return { manifest, pointer, views: encoded.length, changedViews: changed.length };
    });
  }

  function reconcileSummary() {
    const r = reconcile(state, views);
    const comparable = r.sums.filter((s) => s.comparable);
    return {
      identityFailures: r.identityFailures.length,
      sumsComparable: comparable.length,
      sumsMismatched: comparable.filter((s) => s.absDiff !== 0).map((s) => `${s.office}/${s.area}/${s.parts}`),
      sumsMissingParts: r.sums.filter((s) => s.missing > 0).length,
    };
  }

  async function checkpoint(): Promise<void> {
    const cp: Checkpoint = { v: 1, epoch: config.EPOCH, seq, savedAt: new Date(now()).toISOString(), views, state, position: source.position };
    const key = `${checkpointPrefix(config.EPOCH)}${String(seq).padStart(12, '0')}.json.gz`;
    await s3.send(new PutObjectCommand({ Bucket: config.RAW_BUCKET, Key: key, Body: gzipSync(JSON.stringify(cp)), ContentType: 'application/json', ContentEncoding: 'gzip' }));
    log({ msg: 'checkpoint', key, seq });
  }

  async function restore(): Promise<void> {
    state = emptyState();
    seq = 0;
    source.position = { newest: {}, processed: [] };
    let token: string | undefined;
    let latest: string | undefined;
    do {
      const res = await s3.send(new ListObjectsV2Command({ Bucket: config.RAW_BUCKET, Prefix: checkpointPrefix(config.EPOCH), ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (!latest || o.Key! > latest) latest = o.Key!;
      token = res.NextContinuationToken;
    } while (token);
    if (!latest) return log({ msg: 'no checkpoint: folding the log from the start', epoch: config.EPOCH });
    const res = await s3.send(new GetObjectCommand({ Bucket: config.RAW_BUCKET, Key: latest }));
    const cp = JSON.parse(gunzipSync(await res.Body!.transformToByteArray()).toString('utf8')) as Checkpoint;
    if (JSON.stringify(cp.views) !== JSON.stringify(views)) {
      throw new Error(`checkpoint ${latest} is for ${JSON.stringify(cp.views)}, not ${JSON.stringify(views)}: use a new EPOCH`);
    }
    state = cp.state;
    seq = cp.seq;
    source.position = cp.position;
    log({ msg: 'restored checkpoint', key: latest, seq, paths: Object.keys(state.paths).length });
  }

  // --- live mode ---

  let running = false;
  let loopDone: Promise<void> | undefined;
  let initializedGeneration = -1;
  const lease = new Lease({
    s3,
    bucket: config.RAW_BUCKET,
    key: PROJECTOR_LEASE_KEY,
    holder: config.PROJECTOR_ID,
    ttlMs: config.LEASE_TTL_MS,
    renewMs: config.LEASE_RENEW_MS,
    now,
    onChange: (leader, generation) => log({ msg: leader ? 'lease acquired' : 'lease lost', generation }),
  });

  async function loop(): Promise<void> {
    let firstDirtyAt: number | undefined;
    let lastChangeAt = 0;
    let lastPointerAt = now();
    let publishesSinceCheckpoint = 0;
    while (running) {
      try {
        if (!lease.isLeader) {
          await sleep(500);
          continue;
        }
        if (initializedGeneration !== lease.generation) {
          const generation = lease.generation;
          await restore();
          published.clear();
          // A new leader re-publishes what it restored at once: the pointer may be missing
          // or behind (the previous leader died between publishing and checkpointing).
          publishedSeq = -1;
          firstDirtyAt = now() - config.MAX_DELAY_MS;
          initializedGeneration = generation;
          continue;
        }
        const refs = await timed('listMs', () => source.poll());
        if (refs.length && (await ingest(refs)) > 0) {
          lastChangeAt = now();
          firstDirtyAt ??= lastChangeAt;
        }
        const t = now();
        if (firstDirtyAt !== undefined && seq !== publishedSeq && (t - lastChangeAt >= config.QUIET_MS || t - firstDirtyAt >= config.MAX_DELAY_MS)) {
          const res = await publish();
          firstDirtyAt = undefined;
          lastPointerAt = now();
          if (res) log({ msg: 'published', seq, manifest: res.manifest.sha256, pointer: res.pointer, views: res.views, changedViews: res.changedViews, reconcile: reconcileSummary() });
          if (++publishesSinceCheckpoint >= config.CHECKPOINT_EVERY) {
            await checkpoint();
            publishesSinceCheckpoint = 0;
          }
        } else if (lastManifest && t - lastPointerAt >= config.POINTER_REFRESH_MS) {
          await advancePointer(lastManifest);
          lastPointerAt = t;
        }
      } catch (err) {
        log({ msg: 'projector loop error', error: (err as Error).message, level: 'error' });
      }
      await sleep(config.TAIL_MS);
    }
  }

  return {
    get seq() {
      return seq;
    },
    get state() {
      return state;
    },
    get isLeader() {
      return lease.isLeader;
    },
    stats,
    timings,
    blobs,

    async start(): Promise<void> {
      await loadKeys();
      await lease.start();
      running = true;
      loopDone = loop();
      log({ msg: 'projector started', id: config.PROJECTOR_ID, epoch: config.EPOCH, elections: views.elections, target: publisher.target });
    },

    /** Graceful: publish what's pending, checkpoint, hand the lease over. */
    async stop(): Promise<void> {
      running = false;
      await loopDone;
      if (lease.isLeader && initializedGeneration === lease.generation) {
        if (seq !== publishedSeq) await publish();
        await checkpoint();
      }
      await lease.stop();
      log({ msg: 'projector stopped', seq });
    },

    /** Simulates a crash (tests): no publish, no checkpoint, lease left to expire. */
    async abort(): Promise<void> {
      running = false;
      lease.abandon();
      await loopDone;
    },

    /** Fold the whole log once and publish the final state (TASK §2.3 CLI). */
    async rebuild(): Promise<{ seq: number; pointer?: string; manifest?: string; reconcile: ReturnType<typeof reconcileSummary> }> {
      await loadKeys();
      const refs = await timed('listMs', () => source.poll());
      await ingest(refs);
      const res = await publish();
      return { seq, pointer: res?.pointer, manifest: res?.manifest.sha256, reconcile: reconcileSummary() };
    },

    render: () => render(state, views),
  };
}

export type Projector = ReturnType<typeof createProjector>;

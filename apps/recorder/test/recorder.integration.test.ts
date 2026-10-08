// Integration: real S3 API (RustFS via testcontainers) + fake-tse serving the real samples
// + the recorder in-process (TASK-recorder.md §5.3). No mocks.
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Observation } from '@apuracao/contracts';
import { startFakeTse, type FakeTse } from '@apuracao/fake-tse';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createFetcher } from '../src/fetch.js';
import { createRecorder, SNAPSHOT_KEY, type Recorder } from '../src/recorder.js';
import { RawStore } from '../src/store.js';
import { SAMPLES_DIR } from '../src/test-samples.test-helper.js';
import { runS3Conformance } from './s3-conformance.js';

const USER = 'apuracao';
const PASS = 'apuracao-local-only';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let rustfs: StartedTestContainer;
let s3: S3Client;
let tse: FakeTse;

beforeAll(async () => {
  rustfs = await new GenericContainer('rustfs/rustfs:1.0.1')
    .withEnvironment({ RUSTFS_ACCESS_KEY: USER, RUSTFS_SECRET_KEY: PASS })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/health', 9000))
    .start();
  s3 = new S3Client({
    endpoint: `http://${rustfs.getHost()}:${rustfs.getMappedPort(9000)}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: USER, secretAccessKey: PASS },
  });
  tse = await startFakeTse({ samplesDir: SAMPLES_DIR, maxAgeSeconds: 2 });
}, 120_000);

afterAll(async () => {
  await tse?.close();
  await rustfs?.stop();
});

async function bucket(name: string): Promise<string> {
  await s3.send(new CreateBucketCommand({ Bucket: name }));
  return name;
}

function recorder(bucketName: string, id: string): Recorder {
  const config = loadConfig({
    RECORDER_ID: id,
    RAW_BUCKET: bucketName,
    RECORDER_TARGETS: '6257:1:expires,6259:3:expires,6258:1:expires',
    RATE_MAX: '200',
    OBJECT_LOCK_YEARS: '0',
    TSE_BASE_URL: tse.url,
    FLUSH_MS: '300',
    HEARTBEAT_MS: '1000',
    SNAPSHOT_MS: '1000',
    JITTER_MIN_MS: '100',
    JITTER_MAX_MS: '300',
    DISCOVERY_CONFIG_S: '2',
    DISCOVERY_PROBE_S: '2',
    ABSENT_RETRY_S: '1',
    PENDING_MAX_TRIES: '1',
    LEASE_TTL_MS: '3000',
    LEASE_RENEW_MS: '1000',
  });
  return createRecorder({ config, s3, fetcher: createFetcher({ baseUrl: tse.url, userAgent: 'test' }), log: () => {}, emf: () => {} });
}

async function observations(store: RawStore, prefix = 'obs/v1/'): Promise<Observation[]> {
  const out: Observation[] = [];
  for (const key of (await store.list(prefix)).sort()) out.push(...(await store.readSegment(key)));
  return out.map((o) => Observation.parse(o));
}

test('S3 conformance: the emulator honours the conditional writes the recorder relies on', async () => {
  const results = await runS3Conformance(s3, await bucket('conformance'), 'c');
  expect(results.filter((r) => !r.ok)).toEqual([]);
}, 30_000); // the projector's container suite may run in parallel

describe('one recorder against fake-tse', () => {
  let b: string;
  let store: RawStore;
  let rec: Recorder;
  let blobsAfterCapture: number;
  let versionsAfterCapture: number;

  beforeAll(async () => {
    b = await bucket('single');
    store = new RawStore(s3, b, 0);
    rec = recorder(b, 'rec-a');
    tse.log.length = 0;
    await rec.start();
    await sleep(8_000);
  }, 60_000);

  test('cold start: every available .jws stored once, as valid, schema-ok versions', async () => {
    const blobs = await store.list('raw/v1/sha256/');
    const obs = await observations(store);
    const versions = obs.filter((o) => o.kind === 'version');
    // catalog, cm 6257, br-u, br-ab, sp-ab, sp71072-u, zz-u (6257) and rj-u (6259)
    expect(blobs).toHaveLength(8);
    expect(new Set(versions.map((o) => o.sha256)).size).toBe(8);
    expect(versions.every((o) => o.sig === 'valid' && o.schema === 'ok' && o.leaseGeneration === 1)).toBe(true);
    expect(versions.map((o) => o.path)).toContain('ele2026/6257/dados/sp/sp71072-c0001-e006257-u.jws');
    // The SP coverage file triggered its 645 municipalities (one is a sample; 644 are 404 here).
    expect(tse.log.filter((e) => /dados\/sp\/sp\d{5}-c0001/.test(e.path)).length).toBeGreaterThanOrEqual(645);
    blobsAfterCapture = blobs.length;
    versionsAfterCapture = versions.length;
  });

  test('second pass: 0 new blobs and 0 new versions (304s), idempotent', async () => {
    const before = tse.log.length;
    await sleep(6_000);
    const again = tse.log.slice(before);
    expect(again.filter((e) => e.status === 304).length).toBeGreaterThan(0);
    expect(again.filter((e) => e.status === 200)).toEqual([]);
    expect(await store.list('raw/v1/sha256/')).toHaveLength(blobsAfterCapture);
    expect((await observations(store)).filter((o) => o.kind === 'version')).toHaveLength(versionsAfterCapture);
  }, 30_000);

  test('politeness: no request before Expires, no query strings, heartbeat segments', async () => {
    expect(tse.log.filter((e) => e.early)).toEqual([]);
    expect(tse.log.filter((e) => e.query !== '')).toEqual([]);
    expect((await store.list('obs/v1/rec-a/')).length).toBeGreaterThanOrEqual(5);
  });

  test('restart: state comes back from the snapshot; no unconditional re-download', async () => {
    await rec.stop();
    expect(await store.getJsonGz(SNAPSHOT_KEY)).toBeDefined();
    const before = tse.log.length;
    const rec2 = recorder(b, 'rec-a2');
    await rec2.start();
    await sleep(5_000);
    await rec2.stop();
    const after = tse.log.slice(before).filter((e) => e.status !== 404);
    expect(after.length).toBeGreaterThan(0);
    expect(after.filter((e) => !e.conditional)).toEqual([]);
    expect(after.filter((e) => e.early)).toEqual([]);
    expect(await store.list('raw/v1/sha256/')).toHaveLength(blobsAfterCapture);
  }, 30_000);
});

test('two recorders: one polls; after a crash the other takes over with generation + 1', async () => {
  const b = await bucket('lease');
  const store = new RawStore(s3, b, 0);
  const a = recorder(b, 'rec-1');
  await a.start();
  const c = recorder(b, 'rec-2');
  await c.start();
  await sleep(2_000);
  expect(a.isLeader).toBe(true);
  expect(c.isLeader).toBe(false);

  const crashedAt = Date.now();
  await a.abort();
  while (!c.isLeader && Date.now() - crashedAt < 10_000) await sleep(100);
  expect(c.isLeader).toBe(true);
  expect(Date.now() - crashedAt).toBeLessThan(6_000); // TTL 3 s + renew 1 s
  expect(c.stats.generation).toBe(2);
  await sleep(2_000);
  await c.stop();

  const gens = new Map<string, Set<number>>();
  for (const o of await observations(store)) (gens.get(o.recorder) ?? gens.set(o.recorder, new Set()).get(o.recorder)!).add(o.leaseGeneration);
  expect([...(gens.get('rec-1') ?? [])]).toEqual([1]);
  expect((await store.list('obs/v1/rec-2/')).length).toBeGreaterThan(0);
}, 60_000);

test('graceful handover to a standby started earlier: no version observed twice', async () => {
  const b = await bucket('handover');
  const store = new RawStore(s3, b, 0);
  const a = recorder(b, 'rec-old');
  await a.start();
  await sleep(4_000); // capture
  const standby = recorder(b, 'rec-new'); // starts while rec-old still records (a deploy)
  await standby.start();
  await sleep(3_000);
  expect(standby.isLeader).toBe(false);
  await a.stop(); // SIGTERM path: final flush + snapshot, then hand the lease over
  const stoppedAt = Date.now();
  while (!standby.isLeader && Date.now() - stoppedAt < 5_000) await sleep(100);
  expect(standby.isLeader).toBe(true);
  await sleep(4_000);
  await standby.stop();

  const versions = (await observations(store)).filter((o) => o.kind === 'version');
  const pairs = versions.map((o) => `${o.path} ${o.sha256}`);
  expect(pairs.length).toBeGreaterThan(0);
  expect(pairs.length - new Set(pairs).size).toBe(0);
}, 60_000);

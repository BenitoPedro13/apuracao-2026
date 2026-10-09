// Integration (TASK-projector-and-views.md §5 item 2): real S3 API (RustFS via
// testcontainers) + fake-tse serving the real samples + the recorder writing the raw log +
// the projector publishing to a second bucket. No mocks.
import { CreateBucketCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { LatestPointer, Manifest, ResultView } from '@apuracao/contracts';
import { startFakeTse, type FakeTse } from '@apuracao/fake-tse';
import { createFetcher, createRecorder, loadConfig as loadRecorderConfig, type Recorder } from '@apuracao/recorder';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createProjector, type Projector } from '../src/projector.js';
import { POINTER_KEY, S3Publisher, manifestKey, viewKey } from '../src/publisher.js';

// Real containers (RustFS): these tests take 5–6 s each on the CI runner, past Vitest's
// 5 s default (38ab10b, 89a6b61). Hooks and the slow ones keep their own, longer timeouts.
vi.setConfig({ testTimeout: 30_000 });

const SAMPLES_DIR = fileURLToPath(new URL('../../../docs/research/samples', import.meta.url));
const USER = 'apuracao';
const PASS = 'apuracao-local-only';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RAW = 'raw';

let rustfs: StartedTestContainer;
let s3: S3Client;
let tse: FakeTse;
let recorder: Recorder;

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

async function bucket(name: string): Promise<string> {
  await s3.send(new CreateBucketCommand({ Bucket: name }));
  return name;
}

async function count(b: string, prefix: string): Promise<number> {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: b, Prefix: prefix }));
  return res.KeyCount ?? 0;
}

function projector(id: string, pub: string, extra: Record<string, string> = {}): Projector {
  const config = loadConfig({
    PROJECTOR_ID: id,
    RAW_BUCKET: RAW,
    ELECTIONS: 'president=6257,governor=6259',
    GOVERNOR_UFS: 'rj',
    EPOCH: 'test-1',
    TAIL_MS: '200',
    QUIET_MS: '300',
    MAX_DELAY_MS: '1000',
    CHECKPOINT_EVERY: '1',
    POINTER_REFRESH_MS: '1000',
    LEASE_TTL_MS: '3000',
    LEASE_RENEW_MS: '1000',
    ...extra,
  });
  return createProjector({ config, s3, publisher: new S3Publisher(s3, pub), log: () => {} });
}

const pub = (b: string) => new S3Publisher(s3, b);

async function readView<T>(b: string, name: string, schema: { parse: (x: unknown) => T }): Promise<T> {
  const p = (await pub(b).readPointer())!.pointer;
  const manifest = Manifest.parse(JSON.parse(Buffer.from((await pub(b).getBytes(manifestKey(p.epoch, p.seq)))!).toString('utf8')));
  return schema.parse(JSON.parse(Buffer.from((await pub(b).getBytes(viewKey(manifest.views[name]!)))!).toString('utf8')));
}

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
  await bucket(RAW);
  const config = loadRecorderConfig({
    RECORDER_ID: 'rec-a',
    RAW_BUCKET: RAW,
    RECORDER_TARGETS: '6257:1:expires,6259:3:expires',
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
  recorder = createRecorder({ config, s3, fetcher: createFetcher({ baseUrl: tse.url, userAgent: 'test' }), log: () => {}, emf: () => {} });
  await recorder.start();
  // catalog, cm 6257, br-u, br-ab, sp-ab, sp71072-u, zz-u (6257) and rj-u (6259). zz29424 and
  // rj60011 are never triggered: there is no zz-ab or rj-ab sample.
  await waitFor(async () => ((await count(RAW, 'raw/v1/sha256/')) >= 8 ? true : undefined), 60_000, 'the capture');
}, 120_000);

afterAll(async () => {
  await recorder?.stop();
  await tse?.close();
  await rustfs?.stop();
});

describe('one projector, live', () => {
  let p: Projector;
  let b: string;

  beforeAll(async () => {
    b = await bucket('pub-live');
    p = projector('proj-a', b);
    await p.start();
    await waitFor(async () => (await pub(b).readPointer())?.pointer, 30_000, 'the first pointer');
    await sleep(3_000); // let late segments (heartbeats) and a pointer refresh through
  }, 60_000);

  afterAll(() => p.stop());

  test('views appear: national president from the real br file', async () => {
    const br = await readView(b, 'result/president/br', ResultView);
    expect(br.status).toBe('final');
    expect(br.candidates[0]).toMatchObject({ votes: 56_104_503, pct: { raw: '47,03' } });
    expect((await readView(b, 'result/president/sp', ResultView)).status).toBe('not_published');
  });

  test('every object a manifest names exists; the pointer is valid and refreshed', async () => {
    const { pointer } = (await pub(b).readPointer())!;
    LatestPointer.parse(pointer);
    expect(pointer).toMatchObject({ epoch: 'test-1', health: { mode: 's3' }, pollSeconds: 20 });
    expect(pointer.health.recorderSeenAt).not.toBeNull();
    expect(pointer.tse?.totalizedAt).toBe('2026-10-05T12:51:05-03:00');
    const manifest = Manifest.parse(JSON.parse(Buffer.from((await pub(b).getBytes(manifestKey('test-1', pointer.seq)))!).toString('utf8')));
    expect(Object.keys(manifest.views)).toEqual(expect.arrayContaining(['map/president', 'map-index/president', 'regions/president', 'result/governor/rj']));
    for (const sha of Object.values(manifest.views)) expect(await pub(b).getBytes(viewKey(sha))).toBeDefined();
    const before = pointer.refreshedAt;
    await sleep(2_500);
    expect((await pub(b).readPointer())!.pointer.refreshedAt > before).toBe(true);
  });

  test('replay = live: a rebuild of the same log renders byte-identical views', async () => {
    const r = projector('rebuild', await bucket('pub-rebuild'), { EPOCH: 'rebuild-1' });
    await r.rebuild();
    expect(r.render().views).toEqual(p.render().views);
  });

  test('forward-only: a pointer ahead of us (same epoch) is never moved back', async () => {
    const ahead = await bucket('pub-ahead');
    const cur = (await pub(b).readPointer())!.pointer;
    await pub(ahead).writePointer({ ...cur, seq: 1_000_000 }, undefined);
    const r = projector('behind', ahead);
    const res = await r.rebuild();
    expect(res.pointer).toBe('behind');
    expect((await pub(ahead).readPointer())!.pointer.seq).toBe(1_000_000);
  });

  test('a pointer of another epoch is replaced only with PROMOTE', async () => {
    const other = await bucket('pub-other');
    const cur = (await pub(b).readPointer())!.pointer;
    await pub(other).writePointer({ ...cur, epoch: 'kafka-1', seq: 5 }, undefined);
    expect((await projector('np', other).rebuild()).pointer).toBe('behind');
    expect((await projector('p', other, { PROMOTE: 'true' }).rebuild()).pointer).toBe('moved');
    expect((await pub(other).readPointer())!.pointer.epoch).toBe('test-1');
  });
});

test('two projectors: one publishes, and the pointer never goes backwards', async () => {
  const b = await bucket('pub-two');
  const a = projector('proj-1', b);
  const c = projector('proj-2', b);
  await a.start();
  await c.start();
  try {
    const seqs: number[] = [];
    const until = Date.now() + 6_000;
    while (Date.now() < until) {
      const p = await pub(b).readPointer();
      if (p) seqs.push(p.pointer.seq);
      await sleep(100);
    }
    expect([a.isLeader, c.isLeader].filter(Boolean)).toHaveLength(1);
    expect(seqs.length).toBeGreaterThan(0);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBeGreaterThanOrEqual(seqs[i - 1]!);
  } finally {
    await a.stop();
    await c.stop();
  }
}, 30_000);

test('kill and restart from the checkpoint: final views equal an uninterrupted run', async () => {
  const b = await bucket('pub-crash');
  const first = projector('crash-1', b, { EPOCH: 'crash-1' });
  await first.start();
  await waitFor(async () => ((await count(RAW, 'checkpoints/projector/crash-1/')) > 0 ? true : undefined), 30_000, 'a checkpoint');
  await first.abort(); // no publish, no checkpoint, lease left to expire

  const second = projector('crash-2', b, { EPOCH: 'crash-1' });
  await second.start();
  await waitFor(async () => (second.isLeader ? true : undefined), 15_000, 'the takeover');
  await sleep(3_000);
  await second.stop();

  const reference = projector('ref', await bucket('pub-ref'), { EPOCH: 'ref-1' });
  await reference.rebuild();
  expect(second.render().views).toEqual(reference.render().views);
  // The pointer moved only forward across the crash.
  expect((await pub(b).readPointer())!.pointer.seq).toBe(second.seq);
}, 60_000);

test('views are stored gzipped, keyed by the sha256 of the uncompressed bytes (TASK-public-cdn.md §8)', async () => {
  const pointer = LatestPointer.parse(JSON.parse(Buffer.from((await pub('pub-live').getBytes(POINTER_KEY))!).toString('utf8')));
  const manifest = Manifest.parse(JSON.parse(Buffer.from((await pub('pub-live').getBytes(manifestKey('test-1', pointer.seq)))!).toString('utf8')));
  const sha = manifest.views['result/president/br']!;
  const raw = await s3.send(new GetObjectCommand({ Bucket: 'pub-live', Key: viewKey(sha) }));
  expect(raw.ContentEncoding).toBe('gzip');
  const stored = await raw.Body!.transformToByteArray();
  const plain = gunzipSync(stored);
  expect(createHash('sha256').update(plain).digest('hex')).toBe(sha);
  expect(stored.length).toBeLessThan(plain.length);
  expect(Buffer.from((await pub('pub-live').getBytes(viewKey(sha)))!).equals(plain)).toBe(true);
});

test('pointer object carries the cache headers of architecture.md §6.2', async () => {
  const res = await s3.send(new GetObjectCommand({ Bucket: 'pub-live', Key: POINTER_KEY }));
  expect(res.CacheControl).toBe('public, max-age=5, s-maxage=5, stale-while-revalidate=30, stale-if-error=86400');
});

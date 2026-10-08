// A whole 1st-round replay, locally (TASK-fake-tse.md §2.5, architecture.md §9.2):
// RustFS (docker compose) + fake-tse + recorder + projector, each its own process, as in
// production. Prints the §9.2 numbers per run and the medians over runs.
//
//   node scripts/replay.ts [--capture .capture/ele2026-1t] [--speed 20] [--runs 3]
//                          [--faults '<json>'] [--real <PUB_DIR of the real-log rebuild>]
//
// Only the TSE-facing timings are scaled by the speed (probe/absent retry, jitter: they're
// relative to the TSE's 60 s edge window). The pipeline's own timings (flush 5 s, tail 2 s,
// debounce 2–10 s) stay at their production values, so publish lag is measured in wall
// seconds under 20× the night's event rate.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { CreateBucketCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { LatestPointer, Manifest } from '@apuracao/contracts';
import type { RequestLogEntry } from '@apuracao/fake-tse';
import { mapLimit, SegmentSource } from '@apuracao/projector';
import { UFS } from '@apuracao/tse';
import { classify } from '@apuracao/views';

const ROOT = join(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    capture: { type: 'string', default: join(ROOT, '.capture/ele2026-1t') },
    speed: { type: 'string', default: '20' },
    runs: { type: 'string', default: '1' },
    faults: { type: 'string' },
    real: { type: 'string' },
    port: { type: 'string', default: '8181' },
    'quiet-s': { type: 'string', default: '30' },
  },
});
if (!existsSync(values.capture)) {
  console.error(`${values.capture} is missing: run node scripts/export-capture.ts first (needs aws login)`);
  process.exit(1);
}
const speed = Number(values.speed);
const S3_ENDPOINT = 'http://localhost:9000';
const creds = { AWS_ACCESS_KEY_ID: 'apuracao', AWS_SECRET_ACCESS_KEY: 'apuracao-local-only', AWS_REGION: 'us-east-1' };
const s3 = new S3Client({ region: creds.AWS_REGION, endpoint: S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: creds.AWS_ACCESS_KEY_ID, secretAccessKey: creds.AWS_SECRET_ACCESS_KEY } });
const VIEWS = { elections: { president: '6257', governor: '6259' }, governorUfs: UFS } as const;
const NATIONAL = 'result/president/br';

execFileSync('docker', ['compose', '-f', join(ROOT, 'infra/docker-compose.yml'), 'up', '-d', '--wait', 'rustfs'], { stdio: 'inherit' });

function start(name: string, args: string[], env: Record<string, string>, dir: string): ChildProcess {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...creds, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = createWriteStream(join(dir, `${name}.log`));
  child.stdout!.pipe(out);
  child.stderr!.pipe(out);
  return child;
}

const stop = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const median = (xs: number[]) => quantile(xs, 0.5);

/** Highest average requests/s over any `w` consecutive seconds. */
function peakWindow(perSecond: Map<number, number>, w: number): number {
  let best = 0;
  for (const start of perSecond.keys()) {
    let n = 0;
    for (let s = start; s < start + w; s++) n += perSecond.get(s) ?? 0;
    best = Math.max(best, n / w);
  }
  return +best.toFixed(1);
}

async function lines(child: ChildProcess, match: RegExp): Promise<string> {
  let buf = '';
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const m = match.exec(buf);
      if (m) resolve(m[0]);
    });
    child.once('exit', (code) => reject(new Error(`exited ${code} before ${match}`)));
  });
}

async function readManifest(pubDir: string): Promise<Manifest> {
  const pointer = LatestPointer.parse(JSON.parse(readFileSync(join(pubDir, 'data/v1/latest.json'), 'utf8')));
  return Manifest.parse(JSON.parse(readFileSync(join(pubDir, `data/v1/${pointer.epoch}/m/${String(pointer.seq).padStart(12, '0')}.json`), 'utf8')));
}

async function run(no: number) {
  const runId = `${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15).toLowerCase()}-${no}`;
  const dir = join(ROOT, '.replay', runId);
  mkdirSync(dir, { recursive: true });
  const bucket = `replay-${runId}`;
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`run ${no}: ${dir}, bucket ${bucket}`);

  const tseProc = start('fake-tse', ['apps/fake-tse/dist/main.js', '--capture', values.capture, '--speed', String(speed), '--port', values.port, ...(values.faults ? ['--faults', values.faults] : [])], {}, dir);
  const started = JSON.parse(await lines(tseProc, /\{"msg":"fake-tse started".*\}/)) as { url: string; endsAt: string; testKid: string };
  const control = started.url.replace('/oficial/', '/_control/');
  const common = { RAW_BUCKET: bucket, S3_ENDPOINT, TSE_TEST_JWK_URL: `${started.url}app/assets/assinatura-jws/test.jwk.json` };
  const pubDir = join(dir, 'pub');
  const wallStart = Date.now();
  const recorder = start('recorder', ['apps/recorder/dist/main.js'], {
    ...common,
    RECORDER_ID: 'replay-rec',
    OBJECT_LOCK_YEARS: '0',
    RATE_MAX: '100',
    RECORDER_TARGETS: '6257:1:expires,6259:3:expires',
    TSE_BASE_URL: started.url,
    JITTER_MIN_MS: String(Math.round(1000 / speed)),
    JITTER_MAX_MS: String(Math.round(3000 / speed)),
    DISCOVERY_CONFIG_S: String(300 / speed),
    DISCOVERY_PROBE_S: String(60 / speed),
    ABSENT_RETRY_S: String(60 / speed),
  }, dir);
  const projector = start('projector', ['apps/projector/dist/main.js', 'run'], { ...common, PROJECTOR_ID: 'replay-proj', PUB_DIR: pubDir, ELECTIONS: 'president=6257,governor=6259', EPOCH: 'replay-1' }, dir);

  // Every pointer write, read off the directory (writes are atomic renames, ≥ 2 s apart).
  const pointers: LatestPointer[] = [];
  let logFrom = 0;
  let last200At = Date.now();
  let lastPrint = 0;
  // The loop ticks every 200 ms: a longer gap means this machine slept or froze (a closed
  // lid froze run 3 of 2026-10-08), and every process froze with it. Such a run is invalid.
  let lastTick = Date.now();
  let maxStallMs = 0;
  for (;;) {
    maxStallMs = Math.max(maxStallMs, Date.now() - lastTick);
    lastTick = Date.now();
    try {
      const p = LatestPointer.parse(JSON.parse(readFileSync(join(pubDir, 'data/v1/latest.json'), 'utf8')));
      if (pointers.at(-1)?.refreshedAt !== p.refreshedAt) pointers.push(p);
    } catch {
      // not yet written, or mid-rename
    }
    const state = (await (await fetch(`${control}state`)).json()) as { tReal: string; done: boolean };
    const recent = (await (await fetch(`${control}log?from=${logFrom}`)).json()) as RequestLogEntry[];
    logFrom += recent.length;
    for (const e of recent) if (e.status === 200) last200At = e.at;
    const quietFor = Date.now() - last200At;
    if (Date.now() - lastPrint > 30_000) {
      lastPrint = Date.now();
      console.log(`  replay ${state.tReal}  requests ${logFrom}  publishes ${pointers.length}  seq ${pointers.at(-1)?.seq ?? '-'}`);
    }
    const settled = pointers.length > 0 && Date.now() - Date.parse(pointers.at(-1)!.publishedAt) > Number(values['quiet-s']) * 1000;
    if (state.done && settled && quietFor > Number(values['quiet-s']) * 1000) break;
    if (recorder.exitCode !== null || projector.exitCode !== null) throw new Error(`a process died: see ${dir}`);
    await sleep(200);
  }
  const wallMs = Date.now() - wallStart;
  await stop(recorder);
  await stop(projector);
  const log = (await (await fetch(`${control}log`)).json()) as RequestLogEntry[];
  // Rebuild from the same raw log (it must equal the live final views), while fake-tse still
  // serves the test key.
  const rebuildDir = join(dir, 'rebuild');
  const rebuild = start('rebuild', ['apps/projector/dist/main.js', 'rebuild', '--epoch', 'rebuild-1', '--out', rebuildDir], { ...common, PROJECTOR_ID: 'replay-rebuild', ELECTIONS: 'president=6257,governor=6259' }, dir);
  const rebuildExit = await new Promise<number | null>((r) => rebuild.once('exit', r));
  if (rebuildExit !== 0) throw new Error(`projector rebuild exited ${rebuildExit}: see ${dir}/rebuild.log`);
  await stop(tseProc);
  writeFileSync(join(dir, 'fake-tse-log.ndjson'), log.map((e) => JSON.stringify(e)).join('\n'));

  // The raw log.
  const source = new SegmentSource(s3, bucket, 600_000);
  const segments = await mapLimit(await source.poll(), 16, (r) => source.read(r));
  const observations = segments.flatMap((s) => s.observations);
  const recorded = new Set(observations.filter((o) => o.kind === 'version').map((o) => `${o.path}|${o.sha256}`));
  // TSE data files only: app/ is the JWKs, fetched by both processes at start.
  const data = log.filter((e) => !e.path.startsWith('app/'));
  const served = new Set(data.filter((e) => e.status === 200).map((e) => `${e.path}|${e.sha256}`));
  const lost = [...served].filter((k) => !recorded.has(k));
  let blobs = 0;
  let token: string | undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'raw/v1/sha256/', ContinuationToken: token }));
    blobs += res.KeyCount ?? 0;
    token = res.NextContinuationToken;
  } while (token);

  // Request rate per wall second.
  const perSecond = new Map<number, number>();
  for (const e of log) perSecond.set(Math.floor(e.at / 1000), (perSecond.get(Math.floor(e.at / 1000)) ?? 0) + 1);

  // Publish lag: observation fetchedAt → the first pointer whose manifest folded it.
  const lags: number[] = [];
  for (const o of observations) {
    if (o.kind !== 'version' || !classify(o.path, VIEWS)) continue;
    const p = pointers.find((x) => x.publishedAt >= o.fetchedAt);
    if (p) lags.push(Date.parse(p.refreshedAt) - Date.parse(o.fetchedAt));
  }

  const live = await readManifest(pubDir);
  const rebuilt = await readManifest(rebuildDir);
  const viewDiffs = [...new Set([...Object.keys(live.views), ...Object.keys(rebuilt.views)])].filter((n) => live.views[n] !== rebuilt.views[n]);
  const real = values.real ? await readManifest(values.real) : undefined;

  const result = {
    run: runId,
    /** Longest gap between harness ticks; > 5 s means the machine slept or froze. */
    maxStallS: +(maxStallMs / 1000).toFixed(1),
    valid: maxStallMs <= 5_000,
    wallMinutes: +(wallMs / 60_000).toFixed(1),
    requests: log.length,
    served200: served.size,
    capturePathsServedFinal: new Set(data.filter((e) => e.status === 200 && e.version === 'final').map((e) => e.path)).size,
    lostVersions: lost.length,
    earlyRequests: data.filter((e) => e.early).length,
    queryStrings: log.filter((e) => e.query !== '').length,
    /** Busiest single second (the budget allows a burst of 2 × RATE_MAX = 200). */
    peakRps: Math.max(...perSecond.values()),
    /** Busiest 60 s, averaged: the sustained rate. The token bucket allows (60 × 100 + 200) / 60 = 103.3. */
    peak60sRps: peakWindow(perSecond, 60),
    p99Rps: quantile([...perSecond.values()], 0.99),
    versionsRecorded: recorded.size,
    blobs,
    invalidSig: observations.filter((o) => o.kind === 'version' && o.sig === 'invalid').length,
    regressions: observations.filter((o) => o.regression).length,
    publishes: pointers.length,
    lagP50S: +(median(lags) / 1000).toFixed(2),
    lagP95S: +(quantile(lags, 0.95) / 1000).toFixed(2),
    lagMaxS: +(Math.max(...lags) / 1000).toFixed(2),
    rebuildEqualsLive: viewDiffs.length === 0,
    rebuildViewDiffs: viewDiffs.slice(0, 10),
    nationalEqualsRealLog: real ? real.views[NATIONAL] === live.views[NATIONAL] : 'not compared (no --real)',
  };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ ...result, lost: lost.slice(0, 50) }, null, 2));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

const results: Awaited<ReturnType<typeof run>>[] = [];
for (let i = 1; i <= Number(values.runs); i++) {
  const r = await run(i);
  if (!r.valid) console.log(`run ${i} is INVALID: the harness stalled ${r.maxStallS} s (sleep or freeze); excluded from the medians`);
  else results.push(r);
}
if (results.length > 1) {
  const rows = results as unknown as Record<string, unknown>[];
  const numeric = Object.keys(rows[0]!).filter((k) => typeof rows[0]![k] === 'number');
  console.log(JSON.stringify({ medians: Object.fromEntries(numeric.map((k) => [k, median(rows.map((r) => r[k] as number))])) }, null, 2));
}

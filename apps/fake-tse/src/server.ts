// fake-tse (TASK-recorder.md §2.3, TASK-fake-tse.md): serves real captured TSE files with
// the TSE CDN's HTTP semantics (research 01 §2, 02 §3). Without `reveal`, every file is
// served final from the first second (v0). With `reveal`, files appear and coverage files
// grow on a replay clock (reveal.ts), and seeded faults can be injected (faults.ts).
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { Faults, type FaultConfig } from './faults.js';
import { loadCapture, planReveal, stepAt, rebuildCoverage, Timeline, versionAt, type Capture, type Plan } from './reveal.js';
import { corruptSignature, createTestSigner, TEST_JWK_PATH, type Signer } from './sign.js';

export interface RevealOptions {
  /** Real instant the replay starts at, ms. 1st round: 2026-10-04 17:00 BRT (polls close). */
  origin: number;
  /** Replay seconds per wall second. Default 20 (17:00 → 01:00 in 24 min). */
  speed?: number;
  /** Quiet stretches between events longer than this (replay ms) are cut to it. Default 10 min. */
  maxGapMs?: number;
}

export interface FakeTseOptions {
  /** Directory of files named as the URL path with '/' → '_' (samples/ or .capture/ele2026-1t). */
  samplesDir: string;
  /** Edge cache window in replay seconds (wall seconds without reveal). The TSE's is ~60. */
  maxAgeSeconds?: number;
  port?: number;
  host?: string;
  now?: () => number;
  reveal?: RevealOptions;
  faults?: FaultConfig;
}

export interface RequestLogEntry {
  at: number;
  path: string;
  query: string;
  /** 0 = an injected timeout (connection dropped, no response). */
  status: number;
  conditional: boolean;
  /** True if this path was requested before the Expires of our previous response for it. */
  early: boolean;
  /** sha256 of the uncompressed body, on 200. */
  sha256?: string;
  /** Reveal version served (final, step-k), on 200/304. */
  version?: string;
  /** Replay instant the served content belongs to (ISO), in reveal mode. */
  tReal?: string;
  fault?: string;
}

export interface ReplayClock {
  /** The replay instant now. */
  tReal(): number;
  /** True once every event of the capture has been revealed. */
  readonly done: boolean;
  /** Real instant of the last event. */
  readonly endsAt: number;
  set(change: { speed?: number; paused?: boolean; at?: number }): void;
  readonly speed: number;
  readonly paused: boolean;
}

export interface FakeTse {
  url: string;
  log: RequestLogEntry[];
  /** Present in reveal mode. */
  replay?: ReplayClock;
  /** The ephemeral test key, in reveal mode. */
  signer?: Signer;
  plan?: Plan;
  setFaults(config: FaultConfig): void;
  close(): Promise<void>;
}

const PREFIX = '/oficial/';
const CONTROL = '/_control/';

interface Prepared {
  body: Buffer;
  gzipped?: Buffer;
  etag: string;
  sha256: string;
}

function prepare(body: Buffer): Prepared {
  return { body, etag: `"${createHash('md5').update(body).digest('hex')}"`, sha256: createHash('sha256').update(body).digest('hex') };
}

class Clock implements ReplayClock {
  #anchorWall: number;
  #anchorC = 0;
  speed: number;
  paused = false;

  constructor(
    private readonly timeline: Timeline,
    private readonly now: () => number,
    speed: number,
  ) {
    this.#anchorWall = now();
    this.speed = speed;
  }

  /** Compressed replay ms at wall instant `wall`. */
  c(wall: number): number {
    return this.#anchorC + (this.paused ? 0 : (wall - this.#anchorWall) * this.speed);
  }

  tReal(wall = this.now()): number {
    return this.timeline.toReal(this.c(wall));
  }

  get done(): boolean {
    return this.c(this.now()) >= this.timeline.end;
  }

  get endsAt(): number {
    return this.timeline.toReal(this.timeline.end);
  }

  set(change: { speed?: number; paused?: boolean; at?: number }): void {
    const wall = this.now();
    this.#anchorC = change.at !== undefined ? this.timeline.toCompressed(change.at) : this.c(wall);
    this.#anchorWall = wall;
    if (change.speed !== undefined && change.speed > 0) this.speed = change.speed;
    if (change.paused !== undefined) this.paused = change.paused;
  }
}

const readJson = (req: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c)).on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (err) {
        reject(err as Error);
      }
    });
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startFakeTse(options: FakeTseOptions): Promise<FakeTse> {
  const now = options.now ?? Date.now;
  const capture: Capture = loadCapture(options.samplesDir);
  const log: RequestLogEntry[] = [];
  let faults = new Faults(options.faults);

  let signer: Signer | undefined;
  let plan: Plan | undefined;
  let clock: Clock | undefined;
  if (options.reveal) {
    signer = createTestSigner();
    capture.set(TEST_JWK_PATH, Buffer.from(JSON.stringify(signer.jwk)));
    plan = planReveal(capture, options.reveal.origin);
    const timeline = new Timeline(options.reveal.origin, plan.events, options.reveal.maxGapMs ?? 600_000);
    clock = new Clock(timeline, now, options.reveal.speed ?? 20);
  }
  /** Whole seconds, like Expires itself: a sub-second phase would truncate to an earlier header. */
  const windowMs = () => Math.max(1, Math.round((options.maxAgeSeconds ?? 60) / (clock?.speed ?? 1))) * 1000;

  /** Per path: the responses prepared for its recent versions (a coverage file has many). */
  const cache = new Map<string, Map<string, Prepared>>();
  function cached(path: string, key: string, build: () => Buffer): Prepared {
    let byKey = cache.get(path);
    if (!byKey) cache.set(path, (byKey = new Map()));
    let p = byKey.get(key);
    if (!p) {
      p = prepare(build());
      byKey.set(key, p);
      if (byKey.size > 4) byKey.delete(byKey.keys().next().value!);
    }
    return p;
  }

  /** What the edge holds for `path` in the window starting at `windowStart`. */
  function resolve(path: string, windowStart: number): { version: string; tReal?: number; get: () => Prepared } | undefined {
    const corrupt = faults.corrupt(path);
    const variant = (v: string, build: () => Buffer) => ({
      version: corrupt ? `${v}+badsig` : v,
      build: corrupt ? () => corruptSignature(build()) : build,
    });
    if (!plan || !clock || !signer) {
      const body = capture.get(path);
      if (!body) return undefined;
      const v = variant('final', () => body);
      return { version: v.version, get: () => cached(path, v.version, v.build) };
    }
    const tReal = clock.tReal(windowStart);
    let found = versionAt(plan, path, tReal, signer);
    const entry = plan.entries.get(path);
    if (found && entry?.kind === 'coverage' && faults.regress(path)) {
      // The previous step: k − 1, or for the original file the last rebuilt step.
      const k = found.step! < 0 ? stepAt(entry, entry.finalAt - 1) : found.step! - 1;
      if (k >= 0) found = { version: `step-${k}`, step: k, build: () => rebuildCoverage(entry, k, plan.origin, signer) };
    }
    if (!found) return undefined;
    const v = variant(found.version, found.build);
    return { version: v.version, tReal, get: () => cached(path, v.version, v.build) };
  }

  /** Per-path phase so files don't all expire at the same instant, like the real edge. */
  const phaseOf = (path: string, win: number) => {
    const h = parseInt(createHash('md5').update(path).digest('hex').slice(0, 8), 16);
    return (h % win) - (h % 1000);
  };
  const lastExpires = new Map<string, number>();

  async function control(req: IncomingMessage, url: URL): Promise<[number, unknown]> {
    const what = url.pathname.slice(CONTROL.length);
    if (what === 'state' && req.method === 'GET') {
      return [200, clock
        ? { tReal: new Date(clock.tReal()).toISOString(), endsAt: new Date(clock.endsAt).toISOString(), done: clock.done, speed: clock.speed, paused: clock.paused, requests: log.length }
        : { requests: log.length }];
    }
    if (what === 'clock' && req.method === 'POST' && clock) {
      const body = (await readJson(req)) as { speed?: number; paused?: boolean; at?: string };
      clock.set({ speed: body.speed, paused: body.paused, at: body.at ? Date.parse(body.at) : undefined });
      return [200, { tReal: new Date(clock.tReal()).toISOString(), speed: clock.speed, paused: clock.paused }];
    }
    if (what === 'faults' && req.method === 'POST') {
      faults = new Faults((await readJson(req)) as FaultConfig);
      return [200, faults.config];
    }
    if (what === 'log' && req.method === 'GET') {
      return [200, log.slice(Number(url.searchParams.get('from') ?? 0))];
    }
    return [404, { error: 'unknown control endpoint' }];
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname.startsWith(CONTROL)) {
      control(req, url).then(
        ([status, body]) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        },
        (err: unknown) => {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        },
      );
      return;
    }
    void serve(req, res, url);
  });

  async function serve(req: IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<void> {
    const delay = faults.delayMs();
    if (delay > 0) await sleep(delay);
    const t = now();
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    const early = t < (lastExpires.get(path) ?? 0);
    const conditional = req.headers['if-none-match'] !== undefined;
    const done = (status: number, extra: Partial<RequestLogEntry> = {}) =>
      void log.push({ at: t, path, query: url.search, status, conditional, early, ...extra });

    const injected = faults.error();
    if (injected?.status === 'timeout') {
      setTimeout(() => res.socket?.destroy(), injected.hangMs).unref();
      return done(0, { fault: 'timeout' });
    }
    if (injected) {
      res.writeHead(injected.status, { 'content-type': 'text/html', ...(injected.retryAfterS ? { 'retry-after': String(injected.retryAfterS) } : {}) });
      res.end(`<html>${injected.status}</html>`);
      return done(injected.status, { fault: String(injected.status) });
    }

    // The edge object expires at a fixed instant; max-age counts down to it. Its content is
    // what the origin had when the window opened.
    const win = windowMs();
    const phase = phaseOf(path, win);
    const expiresAt = Math.ceil((t - phase + 1) / win) * win + phase;
    const found = url.search === '' ? resolve(path, expiresAt - win) : undefined;
    const tReal = found?.tReal === undefined ? undefined : new Date(found.tReal).toISOString();

    if (!found) {
      // As v0: no Expires on a 404 `[VERIFY: the TSE edge's 404 headers on the night]`.
      res.writeHead(404, { 'content-type': 'text/html', 'cache-control': `max-age=${win / 1000}` });
      res.end('<html>404</html>');
      return done(404);
    }
    lastExpires.set(path, expiresAt);
    const entry = found.get();
    const cacheControl = `max-age=${Math.max(0, Math.round((expiresAt - t) / 1000))}`;
    const headers = { etag: entry.etag, 'cache-control': cacheControl, expires: new Date(expiresAt).toUTCString(), date: new Date(t).toUTCString() };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return done(304, { version: found.version, tReal });
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    const contentType = path.endsWith('.json') ? 'application/json' : 'application/jose';
    res.writeHead(200, { ...headers, 'content-type': contentType, ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
    res.end(gzip ? (entry.gzipped ??= gzipSync(entry.body)) : entry.body);
    return done(200, { sha256: entry.sha256, version: found.version, tReal });
  }

  await new Promise<void>((r) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${options.host ?? '127.0.0.1'}:${port}${PREFIX}`,
    log,
    replay: clock,
    signer,
    plan,
    setFaults: (config) => void (faults = new Faults(config)),
    close: () =>
      new Promise((r, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : r()));
      }),
  };
}

// fake-tse v0 (TASK-recorder.md §2.3): serves the real captured TSE files with the TSE
// CDN's HTTP semantics (research 01 §2, 02 §3). It never modifies a file. Staged reveal
// and withheld coverage rows are Phase 2.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

export interface FakeTseOptions {
  /** Directory of samples named as the URL path with '/' → '_' (docs/research/samples). */
  samplesDir: string;
  /** Edge cache window in seconds. The TSE's is ~60. */
  maxAgeSeconds?: number;
  port?: number;
  now?: () => number;
}

export interface RequestLogEntry {
  at: number;
  path: string;
  query: string;
  status: number;
  conditional: boolean;
  /** True if this path was requested before the Expires of our previous response for it. */
  early: boolean;
}

export interface FakeTse {
  url: string;
  log: RequestLogEntry[];
  close(): Promise<void>;
}

const PREFIX = '/oficial/';

interface Entry {
  body: Buffer;
  gzipped: Buffer;
  etag: string;
  contentType: string;
  /** Per-file phase so files don't all expire at the same instant, like the real edge. */
  phaseMs: number;
}

function loadSamples(dir: string, windowMs: number): Map<string, Entry> {
  const files = new Map<string, Entry>();
  for (const name of readdirSync(dir)) {
    if (!/^(ele2026|comum|app)_/.test(name) || !/\.(json|jws)$/.test(name)) continue;
    const body = readFileSync(`${dir}/${name}`);
    const path = name.replace(/_/g, '/');
    const md5 = createHash('md5').update(body).digest('hex');
    files.set(path, {
      body,
      gzipped: gzipSync(body),
      etag: `"${md5}"`,
      contentType: name.endsWith('.json') ? 'application/json' : 'application/jose',
      phaseMs: (parseInt(md5.slice(0, 8), 16) % windowMs) - (parseInt(md5.slice(0, 8), 16) % 1000),
    });
  }
  return files;
}

export async function startFakeTse(options: FakeTseOptions): Promise<FakeTse> {
  const windowMs = (options.maxAgeSeconds ?? 60) * 1000;
  const now = options.now ?? Date.now;
  const files = loadSamples(options.samplesDir, windowMs);
  const lastExpires = new Map<string, number>();
  const log: RequestLogEntry[] = [];

  const server: Server = createServer((req, res) => {
    const t = now();
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : url.pathname;
    const entry = files.get(path);
    const early = t < (lastExpires.get(path) ?? 0);
    const conditional = req.headers['if-none-match'] !== undefined;
    const done = (status: number) => log.push({ at: t, path, query: url.search, status, conditional, early });

    if (!entry || url.search !== '') {
      res.writeHead(404, { 'content-type': 'text/html', 'cache-control': `max-age=${windowMs / 1000}` });
      res.end('<html>404</html>');
      return done(404);
    }

    // The edge object expires at a fixed whole-second instant; max-age counts down to it.
    const expiresAt = Math.ceil((t - entry.phaseMs + 1) / windowMs) * windowMs + entry.phaseMs;
    lastExpires.set(path, expiresAt);
    const headers = {
      etag: entry.etag,
      'cache-control': `max-age=${Math.max(0, Math.round((expiresAt - t) / 1000))}`,
      expires: new Date(expiresAt).toUTCString(),
      date: new Date(t).toUTCString(),
    };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return done(304);
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    res.writeHead(200, {
      ...headers,
      'content-type': entry.contentType,
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(gzip ? entry.gzipped : entry.body);
    return done(200);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${PREFIX}`,
    log,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Agent, request } from 'undici';

// One conditional GET against the TSE edge (architecture.md §4.3). Never a query string:
// that would bypass the edge cache and load the TSE origin (research 02 §3).

export type FetchOutcome =
  | { kind: 'ok'; body: Buffer; etag?: string; etagMismatch: boolean; headers: CacheHeaders }
  | { kind: 'not_modified'; headers: CacheHeaders }
  | { kind: 'not_found'; headers: CacheHeaders }
  | { kind: 'failed'; status?: number; error: string; pushback: boolean; retryAfterS?: number; headers: CacheHeaders };

export interface CacheHeaders {
  expires?: string;
  date?: string;
  cacheControl?: string;
}

export interface Fetcher {
  get(path: string, ifNoneMatch?: string): Promise<FetchOutcome>;
  close(): Promise<void>;
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

export function createFetcher(options: { baseUrl: string; userAgent: string }): Fetcher {
  const agent = new Agent({
    allowH2: true,
    connect: { timeout: 3_000 },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
    keepAliveTimeout: 30_000,
  });
  const base = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;

  return {
    async get(path, ifNoneMatch) {
      if (path.includes('?') || path.includes('#')) throw new Error(`refusing a query string: ${path}`);
      let headers: CacheHeaders = {};
      try {
        const res = await request(base + path, {
          method: 'GET',
          dispatcher: agent,
          signal: AbortSignal.timeout(10_000),
          headers: {
            'user-agent': options.userAgent,
            'accept-encoding': 'gzip',
            ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}),
          },
        });
        headers = {
          expires: header(res.headers, 'expires'),
          date: header(res.headers, 'date'),
          cacheControl: header(res.headers, 'cache-control'),
        };
        const raw = Buffer.from(await res.body.arrayBuffer());
        if (res.statusCode === 304) return { kind: 'not_modified', headers };
        if (res.statusCode === 404) return { kind: 'not_found', headers };
        if (res.statusCode !== 200) {
          const retryAfter = Number(header(res.headers, 'retry-after'));
          return {
            kind: 'failed',
            status: res.statusCode,
            error: `HTTP ${res.statusCode}`,
            pushback: res.statusCode === 429 || res.statusCode === 503,
            retryAfterS: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
            headers,
          };
        }
        const body = header(res.headers, 'content-encoding') === 'gzip' ? gunzipSync(raw) : raw;
        const etag = header(res.headers, 'etag');
        // The TSE's ETag is the MD5 of the uncompressed body (research 02 §3).
        const md5 = `"${createHash('md5').update(body).digest('hex')}"`;
        return { kind: 'ok', body, etag, etagMismatch: etag !== undefined && etag !== md5, headers };
      } catch (err) {
        return { kind: 'failed', error: (err as Error).message, pushback: false, headers };
      }
    },
    close: () => agent.close(),
  };
}

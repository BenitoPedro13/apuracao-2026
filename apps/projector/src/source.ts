import { gunzipSync } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { Observation } from '@apuracao/contracts';

// S3 mode source (TASK §2.3): the recorder's observation segments, straight from the raw
// bucket. Keys: obs/v1/{recorder}/{YYYY-MM-DD}/{HH}/{cycleStartCompact}-{cycleNo}.ndjson.gz

export const OBS_PREFIX = 'obs/v1/';
const KEY = /^obs\/v1\/([^/]+)\/\d{4}-\d{2}-\d{2}\/\d{2}\/(\d{8}T\d{6}Z)-(\d{8,})\.ndjson\.gz$/;

export interface SegmentRef {
  key: string;
  recorder: string;
  cycleStart: number;
}

export function parseSegmentKey(key: string): SegmentRef | undefined {
  const m = KEY.exec(key);
  if (!m) return undefined;
  const c = m[2]!;
  const iso = `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(9, 11)}:${c.slice(11, 13)}:${c.slice(13, 15)}Z`;
  return { key, recorder: m[1]!, cycleStart: Date.parse(iso) };
}

/** The key prefix of segments that started at `t`: every later segment sorts after it. */
export function keyAt(recorder: string, t: number): string {
  const iso = new Date(t).toISOString();
  const compact = iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${OBS_PREFIX}${recorder}/${iso.slice(0, 10)}/${iso.slice(11, 13)}/${compact}`;
}

/** Merge order: cycle start, then recorder, then key (deterministic for a given set). */
export const segmentOrder = (a: SegmentRef, b: SegmentRef) =>
  a.cycleStart - b.cycleStart || (a.recorder < b.recorder ? -1 : a.recorder > b.recorder ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export interface SourcePosition {
  /** Newest cycleStart seen per recorder. */
  newest: Record<string, number>;
  /** Keys already processed inside the lookback window. */
  processed: string[];
}

/**
 * Tails the segments. A segment PUT can land after a later key (the recorder's flushes
 * aren't serialized), so each poll lists from `lookbackMs` before the newest key seen and
 * skips keys already processed (TASK §2.4 item 7).
 */
export class SegmentSource {
  #newest = new Map<string, number>();
  /** key → its segment (recorder, cycleStart). */
  #processed = new Map<string, SegmentRef>();

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly lookbackMs: number,
  ) {}

  get position(): SourcePosition {
    return { newest: Object.fromEntries(this.#newest), processed: [...this.#processed.keys()].sort() };
  }

  set position(p: SourcePosition) {
    this.#newest = new Map(Object.entries(p.newest));
    this.#processed = new Map(p.processed.flatMap((k) => {
      const ref = parseSegmentKey(k);
      return ref ? [[k, ref] as const] : [];
    }));
  }

  /** cycleStart of the newest segment seen from any recorder (heartbeats every 60 s). */
  get newestAt(): number | undefined {
    const all = [...this.#newest.values()];
    return all.length ? Math.max(...all) : undefined;
  }

  async #listAll(prefix: string, extra: { StartAfter?: string; Delimiter?: string }) {
    const keys: string[] = [];
    const prefixes: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, ...extra }));
      keys.push(...(res.Contents ?? []).map((o) => o.Key!));
      prefixes.push(...(res.CommonPrefixes ?? []).map((p) => p.Prefix!));
      token = res.NextContinuationToken;
    } while (token);
    return { keys, prefixes };
  }

  /** New, unprocessed segments in merge order. Doesn't mark them processed (see `done`). */
  async poll(): Promise<SegmentRef[]> {
    const { prefixes } = await this.#listAll(OBS_PREFIX, { Delimiter: '/' });
    const out: SegmentRef[] = [];
    for (const p of prefixes) {
      const recorder = p.slice(OBS_PREFIX.length, -1);
      const newest = this.#newest.get(recorder);
      const startAfter = newest === undefined ? undefined : keyAt(recorder, newest - this.lookbackMs);
      const { keys } = await this.#listAll(p, startAfter ? { StartAfter: startAfter } : {});
      for (const key of keys) {
        const ref = parseSegmentKey(key);
        if (ref && !this.#processed.has(key)) out.push(ref);
      }
    }
    return out.sort(segmentOrder);
  }

  /** Mark a segment folded, and forget keys that fell out of every lookback window. */
  done(ref: SegmentRef): void {
    this.#processed.set(ref.key, ref);
    const newest = Math.max(ref.cycleStart, this.#newest.get(ref.recorder) ?? -Infinity);
    this.#newest.set(ref.recorder, newest);
    // A poll lists this recorder from newest − lookback: older keys can't come back.
    for (const [k, r] of this.#processed) {
      if (r.recorder === ref.recorder && r.cycleStart < newest - 2 * this.lookbackMs) this.#processed.delete(k);
    }
  }

  async read(ref: SegmentRef): Promise<{ observations: Observation[]; invalid: number }> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: ref.key }));
    const text = gunzipSync(await res.Body!.transformToByteArray()).toString('utf8');
    const observations: Observation[] = [];
    let invalid = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const parsed = Observation.safeParse(JSON.parse(line));
      if (parsed.success) observations.push(parsed.data);
      else invalid++;
    }
    return { observations, invalid };
  }
}

import { gunzipSync, gzipSync } from 'node:zlib';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type PutObjectCommandInput, type S3Client } from '@aws-sdk/client-s3';
import type { Observation } from '@apuracao/contracts';
import { isNotFound, putOnce } from '@apuracao/s3kit';

// The raw log (architecture.md §5.1). raw/ and obs/ are immutable: written once with
// If-None-Match: * and, in AWS, governance-mode Object Lock retention set per object. The
// bucket has no default retention, so lease/ and state/ (overwritten constantly) aren't
// locked (TASK-recorder.md §6).

export const blobKey = (sha256: string) => `raw/v1/sha256/${sha256.slice(0, 2)}/${sha256}.jws`;

const compact = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function segmentKey(recorder: string, cycleStart: Date, cycleNo: number): string {
  const iso = cycleStart.toISOString();
  return `obs/v1/${recorder}/${iso.slice(0, 10)}/${iso.slice(11, 13)}/${compact(cycleStart)}-${String(cycleNo).padStart(8, '0')}.ndjson.gz`;
}

export class RawStore {
  constructor(
    private readonly s3: S3Client,
    readonly bucket: string,
    private readonly lockYears: number,
    private readonly now: () => number = Date.now,
  ) {}

  #lock(): Partial<PutObjectCommandInput> {
    if (this.lockYears <= 0) return {};
    const until = new Date(this.now());
    until.setUTCFullYear(until.getUTCFullYear() + this.lockYears);
    return { ObjectLockMode: 'GOVERNANCE', ObjectLockRetainUntilDate: until };
  }

  /** Write-once put. Returns 'exists' on 412: already stored, which is success (§7.5). */
  #putOnce(Key: string, Body: Uint8Array, extra: Partial<PutObjectCommandInput>): Promise<'stored' | 'exists'> {
    return putOnce(this.s3, { Bucket: this.bucket, Key, Body, ...this.#lock(), ...extra });
  }

  putBlob(sha256: string, body: Uint8Array): Promise<'stored' | 'exists'> {
    return this.#putOnce(blobKey(sha256), body, { ContentType: 'application/jose' });
  }

  putSegment(key: string, observations: Observation[]): Promise<'stored' | 'exists'> {
    const ndjson = observations.map((o) => JSON.stringify(o)).join('\n') + (observations.length ? '\n' : '');
    return this.#putOnce(key, gzipSync(ndjson), { ContentType: 'application/x-ndjson', ContentEncoding: 'gzip' });
  }

  putKey(kid: string, jwk: unknown): Promise<'stored' | 'exists'> {
    return this.#putOnce(`meta/keys/${kid}.jwk.json`, Buffer.from(JSON.stringify(jwk)), { ContentType: 'application/json' });
  }

  /** Mutable, unlocked objects (state snapshots). */
  async putJsonGz(key: string, value: unknown): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: gzipSync(JSON.stringify(value)), ContentType: 'application/json', ContentEncoding: 'gzip' }));
  }

  async getJsonGz<T>(key: string): Promise<T | undefined> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return JSON.parse(gunzipSync(bytes).toString('utf8')) as T;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async readSegment(key: string): Promise<Observation[]> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const text = gunzipSync(await res.Body!.transformToByteArray()).toString('utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Observation);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      keys.push(...(res.Contents ?? []).map((o) => o.Key!));
      token = res.NextContinuationToken;
    } while (token);
    return keys;
  }
}

import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { LatestPointer, POINTER_KEY } from '@apuracao/contracts';
import { isNotFound, isStatus, putOnce } from '@apuracao/s3kit';

// The public layout (architecture.md §6.2) lives in @apuracao/contracts, shared with the web app.
export { manifestKey, POINTER_KEY, viewKey } from '@apuracao/contracts';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const POINTER_CACHE = 'public, max-age=5, s-maxage=5, stale-while-revalidate=30, stale-if-error=86400';

export interface Publisher {
  readonly target: string;
  /** Write-once. */
  putImmutable(key: string, bytes: Uint8Array): Promise<'stored' | 'exists'>;
  getBytes(key: string): Promise<Uint8Array | undefined>;
  readPointer(): Promise<{ pointer: LatestPointer; etag: string } | undefined>;
  /** Conditional on the etag read (or on absence). False: someone else wrote first. */
  writePointer(pointer: LatestPointer, etag: string | undefined): Promise<boolean>;
}

export class S3Publisher implements Publisher {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  get target() {
    return `s3://${this.bucket}`;
  }

  /**
   * Stored gzipped: S3 doesn't compress (CloudFront did; TASK-public-cdn.md §8). The key is
   * still the sha256 of the uncompressed bytes, and browsers decode transparently.
   */
  putImmutable(key: string, bytes: Uint8Array) {
    return putOnce(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Body: gzipSync(bytes, { level: 9 }),
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
      CacheControl: IMMUTABLE,
    });
  }

  /** The uncompressed bytes. */
  async getBytes(key: string) {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = await res.Body!.transformToByteArray();
      return res.ContentEncoding === 'gzip' ? new Uint8Array(gunzipSync(body)) : body;
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async readPointer() {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: POINTER_KEY }));
      return { pointer: LatestPointer.parse(JSON.parse(await res.Body!.transformToString())), etag: res.ETag! };
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async writePointer(pointer: LatestPointer, etag: string | undefined) {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: POINTER_KEY,
          Body: JSON.stringify(pointer),
          ContentType: 'application/json',
          CacheControl: POINTER_CACHE,
          ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }),
        }),
      );
      return true;
    } catch (err) {
      if (isStatus(err, 412, 409)) return false;
      throw err;
    }
  }
}

/** Local stand-in for the public bucket (TASK §2.3: until TASK-public-cdn.md). */
export class DirPublisher implements Publisher {
  constructor(private readonly dir: string) {}

  get target() {
    return this.dir;
  }

  async putImmutable(key: string, bytes: Uint8Array) {
    const path = join(this.dir, key);
    try {
      await stat(path);
      return 'exists' as const;
    } catch {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.tmp`, bytes);
      await rename(`${path}.tmp`, path);
      return 'stored' as const;
    }
  }

  async getBytes(key: string) {
    try {
      return new Uint8Array(await readFile(join(this.dir, key)));
    } catch {
      return undefined;
    }
  }

  async readPointer() {
    const bytes = await this.getBytes(POINTER_KEY);
    if (!bytes) return undefined;
    return { pointer: LatestPointer.parse(JSON.parse(Buffer.from(bytes).toString('utf8'))), etag: createHash('md5').update(bytes).digest('hex') };
  }

  async writePointer(pointer: LatestPointer, etag: string | undefined) {
    const current = await this.readPointer();
    if ((current?.etag ?? undefined) !== etag) return false;
    const path = join(this.dir, POINTER_KEY);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(pointer));
    await rename(`${path}.tmp`, path);
    return true;
  }
}

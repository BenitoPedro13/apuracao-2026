import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

// Raw blobs by sha256 from the raw log (architecture.md §5.1), with a byte-bounded LRU.

export const blobKey = (sha256: string) => `raw/v1/sha256/${sha256.slice(0, 2)}/${sha256}.jws`;

export class BlobReader {
  #cache = new Map<string, Uint8Array>();
  #bytes = 0;
  gets = 0;
  hits = 0;

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly maxBytes: number,
  ) {}

  async get(sha256: string): Promise<Uint8Array> {
    const cached = this.#cache.get(sha256);
    if (cached) {
      this.hits++;
      this.#cache.delete(sha256);
      this.#cache.set(sha256, cached); // most recently used last
      return cached;
    }
    this.gets++;
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: blobKey(sha256) }));
    const bytes = await res.Body!.transformToByteArray();
    this.#cache.set(sha256, bytes);
    this.#bytes += bytes.length;
    for (const [k, v] of this.#cache) {
      if (this.#bytes <= this.maxBytes) break;
      this.#cache.delete(k);
      this.#bytes -= v.length;
    }
    return bytes;
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

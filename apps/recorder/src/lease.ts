import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';

// Recorder leadership (architecture.md §4.5): one S3 object, conditional writes only.
// Create with If-None-Match: *, renew or take over with If-Match: <etag>. The generation
// is a fencing token carried on every observation.

export const LEASE_KEY = 'lease/recorder.json';

interface LeaseBody {
  holder: string;
  generation: number;
  expiresAt: number;
}

export interface LeaseOptions {
  s3: S3Client;
  bucket: string;
  holder: string;
  ttlMs: number;
  renewMs: number;
  now?: () => number;
  onChange?: (leader: boolean, generation: number) => void;
}

const isStatus = (err: unknown, ...codes: number[]) =>
  err instanceof S3ServiceException && codes.includes(err.$metadata.httpStatusCode ?? 0);

export class Lease {
  #o: Required<Omit<LeaseOptions, 'onChange'>> & Pick<LeaseOptions, 'onChange'>;
  #leader = false;
  #generation = 0;
  #validUntil = 0;
  #timer?: NodeJS.Timeout;

  constructor(o: LeaseOptions) {
    this.#o = { now: Date.now, ...o };
  }

  /** Leader only while the last successful write is fresh (a margin of one renewal period). */
  get isLeader(): boolean {
    return this.#leader && this.#o.now() < this.#validUntil;
  }
  get generation(): number {
    return this.#generation;
  }

  async start(): Promise<void> {
    await this.tick();
    this.#timer = setInterval(() => void this.tick(), this.#o.renewMs);
  }

  /** Stop renewing without handing over (a crash, for tests): the lease runs out its TTL. */
  abandon(): void {
    clearInterval(this.#timer);
    this.#leader = false;
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    if (!this.isLeader) return;
    // Hand over immediately instead of making the standby wait out the TTL.
    try {
      const current = await this.#read();
      if (current && current.body.holder === this.#o.holder) {
        await this.#write({ ...current.body, expiresAt: 0 }, { IfMatch: current.etag });
      }
    } catch {
      // Best effort: the lease expires on its own.
    }
    this.#set(false, this.#generation);
  }

  async #read(): Promise<{ body: LeaseBody; etag: string } | undefined> {
    try {
      const res = await this.#o.s3.send(new GetObjectCommand({ Bucket: this.#o.bucket, Key: LEASE_KEY }));
      return { body: JSON.parse(await res.Body!.transformToString()) as LeaseBody, etag: res.ETag! };
    } catch (err) {
      if (err instanceof NoSuchKey || isStatus(err, 404)) return undefined;
      throw err;
    }
  }

  async #write(body: LeaseBody, cond: { IfMatch?: string; IfNoneMatch?: string }): Promise<void> {
    await this.#o.s3.send(
      new PutObjectCommand({ Bucket: this.#o.bucket, Key: LEASE_KEY, Body: JSON.stringify(body), ContentType: 'application/json', ...cond }),
    );
  }

  #set(leader: boolean, generation: number): void {
    const changed = leader !== this.#leader || generation !== this.#generation;
    this.#leader = leader;
    this.#generation = generation;
    if (changed) this.#o.onChange?.(leader, generation);
  }

  /** One acquire/renew attempt. */
  async tick(): Promise<void> {
    const now = this.#o.now();
    const expiresAt = now + this.#o.ttlMs;
    try {
      const current = await this.#read();
      let generation: number;
      if (!current) {
        generation = 1;
        await this.#write({ holder: this.#o.holder, generation, expiresAt }, { IfNoneMatch: '*' });
      } else if (current.body.holder === this.#o.holder && current.body.expiresAt > now) {
        generation = current.body.generation;
        await this.#write({ ...current.body, expiresAt }, { IfMatch: current.etag });
      } else if (current.body.expiresAt <= now) {
        generation = current.body.generation + 1;
        await this.#write({ holder: this.#o.holder, generation, expiresAt }, { IfMatch: current.etag });
      } else {
        return this.#set(false, current.body.generation);
      }
      this.#validUntil = expiresAt - this.#o.renewMs;
      this.#set(true, generation);
    } catch (err) {
      // 412: someone else wrote first. Anything else: we can't prove leadership.
      if (!isStatus(err, 412, 409)) console.error(JSON.stringify({ msg: 'lease error', error: (err as Error).message }));
      this.#set(false, this.#generation);
    }
  }
}

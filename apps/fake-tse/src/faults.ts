// Seeded fault injection (TASK-fake-tse.md §2.4, architecture.md §9.2): the same seed and
// the same request sequence give the same faults.

export interface FaultConfig {
  seed?: number;
  /** Log-normal delay before responding. */
  latency?: { p50Ms?: number; p99Ms?: number };
  /** Per-request probabilities. A timeout hangs `timeoutMs`, then drops the connection. */
  errors?: { rate429?: number; rate503?: number; rateTimeout?: number; retryAfterS?: number; timeoutMs?: number };
  /** For these coverage paths, serve the previous reveal step's bytes (lower idg) at `rate`. */
  regression?: { paths: string[]; rate?: number };
  /** For these paths, every 200 carries a signature with one character flipped. */
  badSignature?: string[];
}

export type InjectedError = { status: 429 | 503; retryAfterS?: number } | { status: 'timeout'; hangMs: number };

/** mulberry32: small, fast, seedable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** z of the 99th percentile of the standard normal. */
const Z99 = 2.3263478740408408;

export class Faults {
  readonly #random: () => number;
  readonly #regression: Set<string>;
  readonly #badSignature: Set<string>;

  constructor(readonly config: FaultConfig = {}) {
    this.#random = seededRandom(config.seed ?? 1);
    this.#regression = new Set(config.regression?.paths ?? []);
    this.#badSignature = new Set(config.badSignature ?? []);
  }

  /** Delay before responding, ms: log-normal with the configured p50 and p99 (defaults 80 ms, 2 s). */
  delayMs(): number {
    if (!this.config.latency) return 0;
    const p50 = this.config.latency.p50Ms ?? 80;
    const p99 = this.config.latency.p99Ms ?? 2_000;
    const sigma = Math.log(p99 / p50) / Z99;
    // Box–Muller
    const u = Math.max(this.#random(), Number.EPSILON);
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.#random());
    return p50 * Math.exp(sigma * z);
  }

  error(): InjectedError | undefined {
    const e = this.config.errors;
    if (!e) return undefined;
    const r = this.#random();
    const r429 = e.rate429 ?? 0;
    const r503 = e.rate503 ?? 0;
    if (r < r429) return { status: 429, retryAfterS: e.retryAfterS ?? 5 };
    if (r < r429 + r503) return { status: 503 };
    if (r < r429 + r503 + (e.rateTimeout ?? 0)) return { status: 'timeout', hangMs: e.timeoutMs ?? 30_000 };
    return undefined;
  }

  regress(path: string): boolean {
    return this.#regression.has(path) && this.#random() < (this.config.regression?.rate ?? 0.5);
  }

  corrupt(path: string): boolean {
    return this.#badSignature.has(path);
  }
}

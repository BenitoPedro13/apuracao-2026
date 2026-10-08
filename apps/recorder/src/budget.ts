// Request budget (architecture.md §4.3): token bucket + concurrency cap + AIMD on pushback
// + a circuit breaker. Time is injected so it is unit-testable with a fake clock.

export interface BudgetOptions {
  rateMax: number;
  concurrency: number;
  now: () => number;
}

const RATE_FLOOR = 5;
const AIMD_STEP = 10;
const AIMD_QUIET_MS = 30_000;
const BREAKER_WINDOW_MS = 30_000;
const BREAKER_OPEN_RATIO = 0.2;
const BREAKER_MIN_SAMPLES = 10;
const BREAKER_CLEAN_RATIO = 0.05;
const BREAKER_PROBE_MS = 60_000;
const BREAKER_CLEAN_WINDOWS = 3;

export class Budget {
  #o: BudgetOptions;
  #rate: number;
  #tokens: number;
  #lastRefill: number;
  #inFlight = 0;
  #pausedUntil = 0;
  #lastPushback = -Infinity;
  #lastIncrease: number;
  #outcomes: { at: number; failed: boolean }[] = [];
  #breakerOpen = false;
  #probeWindowStart = 0;
  #cleanWindows = 0;

  constructor(o: BudgetOptions) {
    this.#o = o;
    this.#rate = o.rateMax;
    this.#tokens = this.#burst();
    this.#lastRefill = o.now();
    this.#lastIncrease = o.now();
  }

  get rate(): number {
    return this.#rate;
  }
  get inFlight(): number {
    return this.#inFlight;
  }
  get breakerOpen(): boolean {
    return this.#breakerOpen;
  }

  #burst(): number {
    return Math.max(1, Math.round(this.#rate * 2));
  }

  #refill(now: number): void {
    this.#tokens = Math.min(this.#burst(), this.#tokens + ((now - this.#lastRefill) / 1000) * this.#rate);
    this.#lastRefill = now;
    // Additive increase: +10 req/s per 30 s without pushback, up to the max.
    if (this.#rate < this.#o.rateMax && now - Math.max(this.#lastPushback, this.#lastIncrease) >= AIMD_QUIET_MS) {
      this.#rate = Math.min(this.#o.rateMax, this.#rate + AIMD_STEP);
      this.#lastIncrease = now;
    }
  }

  /** Milliseconds until a request may start (0 = now). */
  waitMs(): number {
    const now = this.#o.now();
    this.#refill(now);
    if (now < this.#pausedUntil) return this.#pausedUntil - now;
    if (this.#inFlight >= this.#o.concurrency) return 10;
    if (this.#tokens >= 1) return 0;
    return Math.ceil(((1 - this.#tokens) / this.#rate) * 1000);
  }

  /** Take a token and a concurrency slot. Call only when waitMs() is 0. */
  acquire(): void {
    this.#tokens -= 1;
    this.#inFlight += 1;
  }

  /** Report the outcome of a request started with acquire(). */
  release(outcome: { failed: boolean; pushback?: boolean; retryAfterS?: number }): void {
    const now = this.#o.now();
    this.#inFlight -= 1;
    if (outcome.pushback) {
      // Multiplicative decrease on 429/503, and honour Retry-After.
      this.#rate = Math.max(RATE_FLOOR, this.#rate / 2);
      this.#tokens = Math.min(this.#tokens, this.#burst());
      this.#lastPushback = now;
      if (outcome.retryAfterS) this.#pausedUntil = Math.max(this.#pausedUntil, now + outcome.retryAfterS * 1000);
    }
    this.#outcomes.push({ at: now, failed: outcome.failed });
    this.#evaluateBreaker(now);
  }

  #evaluateBreaker(now: number): void {
    this.#outcomes = this.#outcomes.filter((o) => now - o.at <= Math.max(BREAKER_WINDOW_MS, BREAKER_PROBE_MS));
    const recent = this.#outcomes.filter((o) => now - o.at <= BREAKER_WINDOW_MS);
    const failRatio = recent.filter((o) => o.failed).length / Math.max(1, recent.length);

    if (!this.#breakerOpen) {
      if (recent.length >= BREAKER_MIN_SAMPLES && failRatio > BREAKER_OPEN_RATIO) {
        this.#breakerOpen = true;
        this.#probeWindowStart = now;
        this.#cleanWindows = 0;
      }
      return;
    }
    // Open: judge each 60 s probe window; close after 3 consecutive windows under 5%.
    if (now - this.#probeWindowStart >= BREAKER_PROBE_MS) {
      const window = this.#outcomes.filter((o) => o.at > this.#probeWindowStart);
      const ratio = window.filter((o) => o.failed).length / Math.max(1, window.length);
      this.#cleanWindows = window.length > 0 && ratio < BREAKER_CLEAN_RATIO ? this.#cleanWindows + 1 : 0;
      this.#probeWindowStart = now;
      if (this.#cleanWindows >= BREAKER_CLEAN_WINDOWS) this.#breakerOpen = false;
    }
  }
}

/** Exponential backoff with full jitter: base 2 s, cap 60 s (§4.3). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1)));
}

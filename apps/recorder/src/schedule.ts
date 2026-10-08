// Priority queue of (dueAt, path), coalesced by path (architecture.md §4.3). Tier-2 items
// are due on enqueue; ties are broken by insertion order, so the oldest change goes first.

interface Item {
  path: string;
  dueAt: number;
  order: number;
}

export class Schedule {
  #heap: Item[] = [];
  #byPath = new Map<string, Item>();
  #order = 0;

  get size(): number {
    return this.#byPath.size;
  }

  has(path: string): boolean {
    return this.#byPath.has(path);
  }

  /** Schedule `path` at `dueAt`. If already queued, keep the earlier due time (coalesce). */
  add(path: string, dueAt: number): void {
    const existing = this.#byPath.get(path);
    if (existing) {
      if (dueAt >= existing.dueAt) return;
      this.#remove(existing);
    }
    const item = { path, dueAt, order: this.#order++ };
    this.#byPath.set(path, item);
    this.#heap.push(item);
    this.#up(this.#heap.length - 1);
  }

  peekDue(): number | undefined {
    return this.#heap[0]?.dueAt;
  }

  /** Pop the earliest item due at or before `now`. */
  popDue(now: number): string | undefined {
    const top = this.#heap[0];
    if (!top || top.dueAt > now) return undefined;
    this.#remove(top);
    return top.path;
  }

  /** Pop the earliest due item that satisfies `accept` (used while the breaker is open). */
  popDueWhere(now: number, accept: (path: string) => boolean): string | undefined {
    const due = this.#heap.filter((i) => i.dueAt <= now && accept(i.path));
    if (due.length === 0) return undefined;
    const first = due.reduce((a, b) => (b.dueAt < a.dueAt || (b.dueAt === a.dueAt && b.order < a.order) ? b : a));
    this.#remove(first);
    return first.path;
  }

  #less(a: Item, b: Item): boolean {
    return a.dueAt < b.dueAt || (a.dueAt === b.dueAt && a.order < b.order);
  }

  #remove(item: Item): void {
    const i = this.#heap.indexOf(item);
    const last = this.#heap.pop()!;
    this.#byPath.delete(item.path);
    if (i < this.#heap.length) {
      this.#heap[i] = last;
      this.#up(i);
      this.#down(i);
    }
  }

  #up(i: number): void {
    const h = this.#heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  #down(i: number): void {
    const h = this.#heap;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.#less(h[l]!, h[m]!)) m = l;
      if (r < h.length && this.#less(h[r]!, h[m]!)) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }
}

/** When to poll next given a response's caching headers (§4.3: never before Expires). */
export function nextDueFromHeaders(
  headers: { expires?: string; date?: string; cacheControl?: string },
  now: number,
  jitter: () => number,
  fallbackS: number,
): number {
  const expires = headers.expires ? Date.parse(headers.expires) : NaN;
  if (!Number.isNaN(expires)) return Math.max(expires, now) + jitter();
  const maxAge = /max-age=(\d+)/.exec(headers.cacheControl ?? '')?.[1];
  const base = headers.date ? Date.parse(headers.date) : now;
  if (maxAge !== undefined && !Number.isNaN(base)) return Math.max(base + Number(maxAge) * 1000, now) + jitter();
  return now + fallbackS * 1000 + jitter();
}

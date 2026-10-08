// CloudWatch Embedded Metric Format on stdout (architecture.md §10.1): metrics without an
// agent. Counters and gauges are aggregated in memory and flushed once a minute.

type Dims = Record<string, string>;
const NAMESPACE = 'apuracao26';

interface Series {
  name: string;
  dims: Dims;
  unit: 'Count' | 'Seconds' | 'None';
  value: number;
  gauge: boolean;
}

export class Metrics {
  #series = new Map<string, Series>();
  constructor(
    private readonly properties: Record<string, string>,
    private readonly write: (line: string) => void = (l) => process.stdout.write(l + '\n'),
    private readonly now: () => number = Date.now,
  ) {}

  #key(name: string, dims: Dims) {
    return `${name}|${Object.entries(dims).sort().map(([k, v]) => `${k}=${v}`).join(',')}`;
  }

  count(name: string, dims: Dims = {}, n = 1): void {
    const k = this.#key(name, dims);
    const s = this.#series.get(k) ?? { name, dims, unit: 'Count' as const, value: 0, gauge: false };
    s.value += n;
    this.#series.set(k, s);
  }

  gauge(name: string, value: number, dims: Dims = {}, unit: 'Seconds' | 'None' | 'Count' = 'None'): void {
    this.#series.set(this.#key(name, dims), { name, dims, unit, value, gauge: true });
  }

  flush(): void {
    for (const [k, s] of this.#series) {
      const dims = { Service: 'recorder', ...s.dims };
      this.write(
        JSON.stringify({
          _aws: {
            Timestamp: this.now(),
            CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: [Object.keys(dims)], Metrics: [{ Name: s.name, Unit: s.unit }] }],
          },
          ...this.properties,
          ...dims,
          [s.name]: s.value,
        }),
      );
      if (!s.gauge) this.#series.delete(k);
    }
  }
}

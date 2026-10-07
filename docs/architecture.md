# Architecture — Apuração 2026

**Status:** proposed, 2026-10-07. Written against `docs/research/01-tse-results-feed.md` and
`docs/research/02-signatures-cache-and-map-mesh.md` (re-verified today). Decisions the user
made on 2026-10-07: **AWS (existing credits), no custom domain for now, cookieless analytics
with no ads, and a message broker on the election-night critical path for learning value.**
Everything else here is a recommendation until the user signs it off. Open questions are in
§15.

Build order and dates: `docs/tasks/TASK-implementation-plan.md`.

---

## 1. Goals and non-goals

### Goals (for Sunday 2026-10-25)

1. **Record** every distinct version of every TSE results file we can observe for the 2nd
   round (president `6258`, governor `6260`) byte for byte, with its TSE signature, from the
   moment the files appear until the count is final (`tf: "s"` everywhere).
2. **Show the count live**: national headline (leader, %, votes, gap), a municipality
   choropleth for president, per-region/UF breakdown, turnout and blank/null figures, with
   "last updated" always visible.
3. **Replay the count**: a timeline scrubber and an "over the count" chart built only from
   versions we actually observed, with gaps shown as gaps.
4. **Stay up under a viral spike unattended**: readers are served only from a CDN. A spike
   cannot slow ingestion, and an ingestion stall cannot take the site down.
5. **Be provably faithful**: every number on screen traces to a TSE-signed file we stored,
   and anyone can check the signature.
6. **Learn distributed systems on a real workload** (user's choice: a broker on the critical
   path), *without* letting a learning component be able to lose data or take the site
   down.

### Non-goals (for the 25th)

- 1st-round history. It no longer exists at the TSE (research 01 §5.3). We only hold the
  final 1st-round state.
- Senate, federal/state deputies. The 2nd round has none.
- Projections, forecasts, "who will win" calls, interpolation between observed versions.
  Forbidden by invariant 1.
- Per-section ballot-box data (`arquivo-urna`, dadosabertos). Only the seam is designed
  (§13).
- Accounts, comments, notifications, a native app, i18n beyond pt-BR.
- A custom domain (deferred, §15).

---

## 2. Capacity numbers (stated, with their justification)

### 2.1 What we read from the TSE

| Quantity | Number | Source |
|---|---|---|
| Tier-1 files per cycle (coverage `-ab` + aggregate `-u`) | **72**: 29 + 7 coverage, 29 + 7 aggregate | research 02 §4 |
| Tier-2 files (municipal `-u`), maximum | **6,318**: 5,757 president + 561 governor | research 02 §4 |
| Size per municipal `.jws` | 12.6 KB raw, ~3.8 KB on the wire (gzip) | research 02 §2 |
| Coverage files, all 36 together | ~6.4 MB raw as `.jws`, ~0.6 MB gzipped | research 02 §4 (12.4× gzip ratio) |
| TSE edge freshness | `max-age` counting down from ~60 s per object | research 02 §3 |
| Published limit | 2,000 req/s, but it is the **origin's** limit towards Akamai, not ours | research 02 §3 |

**Our ceiling: 100 requests/s sustained (5% of the published figure), burst 200, at most
16 in flight.** This is self-imposed because the real per-client limit is unknown. At that
ceiling, a worst-case cycle where every municipality changed at once (72 + 6,318 = 6,390
requests) drains in **64 s**. A cycle where nothing changed costs 72 conditional requests
(≈ 72 × 0.5 KB of headers) once per ~60 s, i.e. **1.2 req/s**.

### 2.2 What we record

Assume a count from 17:00 to ~22:00 BRT with heavy change (5 h = 300 one-minute windows):

| Stream | Versions (estimate) | Raw bytes |
|---|---|---|
| Aggregate `-u` (36 files, change ~every minute) | 36 × 300 = **10,800** | 10,800 × 12 KB ≈ 130 MB |
| Coverage `-ab` (36 files, change ~every minute) | 36 × 300 = **10,800** | 300 × 6.4 MB ≈ **1.9 GB** (worst case) |
| Municipal `-u` (6,318 files, ~4 versions each on average) | **~25,000** | 25,000 × 12.6 KB ≈ 315 MB |
| **Total** | **~47,000 observations** | **≤ 2.4 GB** raw, ≈ 0.3 GB gzipped |

That is small. Nothing here needs a database cluster, a data lake or a stream processor.
The numbers justify **object storage plus one process**. Everything beyond that is a
deliberate learning choice and is labelled as one (§3.3).

### 2.3 What readers pull

**Design peak: 50,000 concurrent viewers, with a cost model up to 250,000.** Why that number:
the mass audience on election night goes to the TSE app and the big portals (g1, UOL,
Folha). A personal dashboard with no domain and no marketing realistically sees 1–5k
concurrent viewers, but one share from a large account can push a niche tracker into the
tens of thousands. 50k is that case. Because readers only touch the CDN, *capacity* doesn't
change with the number. Only *cost* does, so §11 prices 5k, 50k and 250k.

Per viewer, with a visible tab (hidden tabs stop polling):

| Request | Rate | Size (gzip) |
|---|---|---|
| `latest.json` pointer | every 20 s | ~0.6 KB |
| new manifest + changed views (national, map, UF, timeline tail, feed tail) | once per new `seq`, ~1/min | ~33 KB |
| first load: HTML/JS shell + TopoJSON + first views | once | ~250 KB + 330 KB + 40 KB ≈ **620 KB** |

At 50k viewers: **~5,000 req/s at the edge**, ~27 MB/s. Over a 5-hour night that is ~90 M
requests and ~510 GB. With CloudFront Origin Shield and request collapsing, the origin (S3)
sees roughly **one request per object per TTL**, i.e. **< 2 req/s**, regardless of viewers.

### 2.4 Latency budget (TSE edge publishes → visible in a browser)

| Hop | Worst case | Typical |
|---|---|---|
| Our poll after the TSE edge copy expires | 3 s (jitter after `Expires`) | 2 s |
| Fetch + verify + S3 write + Kafka produce | 2 s | 0.3 s |
| Projector debounce + build + publish | 10 s | 3 s |
| Pointer cache (`s-maxage=5`) | 5 s | 2.5 s |
| Client poll | 20 s | 10 s |
| **Total we add** | **40 s** | **~18 s** |

**Target: p95 ≤ 40 s from "TSE edge serves it" to "a browser shows it" for the national
headline.** Municipal detail can lag one more TSE cache window (≤ 60 s), because the change
is detected via the coverage file before the municipal file's own edge copy refreshes
(§4.4). The TSE's own edge adds 0–60 s before us, and we can't do anything about that.

---

## 3. Components

### 3.1 Diagram

```
                       TSE (Akamai edge, max-age≈60 s)   resultados.tse.jus.br/oficial/ele2026/{6258,6260}/…/*.jws
                                     │  conditional GETs, ≤100 req/s, at each file's Expires
                                     ▼
 ┌─────────────────────────── AWS sa-east-1 (São Paulo), one VPC ───────────────────────────┐
 │                                                                                           │
 │  recorder ×2 (Fargate, AZ a + b; one holds the S3 lease, other hot standby)               │
 │    poll scheduler → fetch .jws → verify Ed25519 → parse (Zod) → classify                  │
 │      │ 1. PUT raw blob (If-None-Match:*)       │ 2. produce Observation   │ 3. append obs  │
 │      ▼                                          ▼                          ▼ segment/cycle │
 │  S3 apuracao26-raw  ◄──── claim check ────  MSK (Kafka) 3× t3.small     S3 apuracao26-raw │
 │  raw/v1/sha256/…  (Object Lock)               tse.observations.v1        obs/v1/…          │
 │      ▲                                          │ (1 partition, RF 3)       ▲              │
 │      │ GET blob by sha256                       ▼                           │ fallback     │
 │  projector ×2 (Fargate; one holds the S3 lease) ◄───────────────────────────┘ source       │
 │    fold → state → views → feed/timeline → publish (content-addressed) → move pointer      │
 │      │                                          │ produce views.published.v1 (lab only)   │
 │      ▼                                          ▼                                          │
 │  S3 apuracao26-pub  (private, CloudFront OAC)   [lab consumers: DuckDB, own log, …  —     │
 │    /            Next.js static export            never on the critical path]              │
 │    /data/v1/…   pointer, manifests, views                                                 │
 └──────┬────────────────────────────────────────────────────────────────────────────────────┘
        │ Origin Shield (sa-east-1)
        ▼
  CloudFront  dXXXX.cloudfront.net   ──►  browsers (poll pointer every 20 s; immutable views)
        ▲
  canary Lambdas (sa-east-1 + us-east-1) + alarms → SNS → email/SMS
```

### 3.2 Each component and whether the numbers require it

| Component | Job | Required by the numbers? |
|---|---|---|
| **recorder** (TS, Node 24, Fargate ARM 0.25 vCPU / 0.5 GB; 1 from 10-11, a 2nd only 10-23 → 10-26) | Polls the TSE politely, stores raw versions, emits observations | **Yes.** The standby is a choice for redundancy on a night that can't be repeated. It runs 3 days, ~$1.20. |
| **S3 raw bucket** with Object Lock | The immutable source of truth (invariant 2) | **Yes.** |
| **projector** (TS, Fargate ARM 0.5 vCPU / 1 GB; 1 from 10-18, a 2nd only 10-23 → 10-26) | Folds observations into views and publishes them | **Yes**, as a process. It could live inside the recorder. Splitting it is what lets the broker sit in between (§3.3). |
| **MSK (Kafka)** 3 brokers, **switched on only for the rehearsal and the night** (§11) | Ordered, replicated log of observations between recorder and projector | **No.** ~50k messages over a night is ~3 msg/s. Here for learning, by the user's choice. See §3.3 for how it is kept from hurting. Development uses Redpanda in local Docker. |
| **S3 public bucket + CloudFront** | Serves the site and all data to readers | **Yes**: it is the whole fan-out design (§6). |
| **Database** (Postgres, DynamoDB, …) | — | **No, and not added.** The projector's state is ~10 MB in memory, checkpointed to S3. |
| **Stream processor** (Flink, Kafka Streams, …) | — | **No, and not added on the night.** The fold is a pure function in `packages/views`. A stream processor is a lab exercise (§3.3). |
| **SSE/WebSocket push service** | — | **No, rejected** (ADR-8). |

### 3.3 The learning tension, stated plainly

The boring design that survives a spike unattended is **recorder → S3 → projector reading S3
→ S3/CloudFront**. It has two stateful dependencies (the TSE and S3), and S3 is the one
cloud service least likely to fail on a Sunday night.

The user chose to put a broker on the critical path anyway, to learn Kafka on a real
workload: partitions, replication, ISR, idempotent producers, offsets, consumer failover,
and replay by rewinding. That's legitimate as long as three rules hold. The design enforces
them:

1. **The broker never holds the only copy of anything.** The recorder writes the raw blob to
   S3 *before* producing (claim-check pattern) and also writes a per-cycle observation
   segment to S3. Losing the whole MSK cluster loses zero data.
2. **The broker is on the path for *freshness*, never for *recording* or *serving*.** If
   Kafka is down, the recorder keeps recording (its lease and its writes are S3 only), and
   CloudFront keeps serving the last published views.
3. **The fallback is the rebuild path, which is tested anyway.** The projector can read
   observations from Kafka *or* from the S3 segments. "Rebuild from scratch" (§5.5) is the
   S3 mode. If Kafka is unreachable for 3 minutes while new S3 segments keep appearing, the
   projector switches to S3 mode by itself, under a new epoch, and pages. The cost is one
   extra cycle of lag (~60 s) until Kafka is back.

**Lab work** (§12) runs on the recorded log *after* the night, or as extra consumer groups
that can be killed at any time: an analytical store, a stream-processing rewrite of the
projector, and the "build your own replicated log" project fed with this log.

---

## 4. Ingestion: the poll loop

### 4.1 What is fetched

Always the **`.jws`**, never the `.json` (ADR-1). Same path, last segment `.json → .jws`. The
payload is byte-identical to the `.json` and carries an Ed25519 signature by the TSE's
`prod` key (research 02 §2).

| Tier | Files | When |
|---|---|---|
| 0 — config | `comum/config/ele-c.jws`, `ele2026/6258/config/mun-e006258-cm.jws`, `ele2026/6260/config/mun-e006260-cm.jws` | at start, then every 10 min (conditional) |
| 1 — coverage | `6258/dados/{br,ac…to,zz}/{uf}-e006258-ab.jws` (29), `6260/dados/{ac,am,df,es,rj,rn,to}/{uf}-e006260-ab.jws` (7) | each file at its own `Expires` + 1–3 s jitter |
| 1 — aggregates | `6258/dados/{br,uf,zz}/{x}-c0001-e006258-u.jws` (29), `6260/dados/{uf}/{uf}-c0003-e006260-u.jws` (7) | each at its own `Expires` + jitter |
| 2 — municipal | `6258/dados/{uf}/{uf}{cd}-c0001-e006258-u.jws` (5,757), `6260/dados/{uf}/{uf}{cd}-c0003-e006260-u.jws` (561) | only when the coverage row for that municipality changed (§4.2), or as a pending re-fetch (§4.4) |

`[VERIFY: on the first day 6258/6260 appear, confirm every path above against the new
mun-e006258-cm / ele-c "arq" templates, and that governor coverage really is per election
(6260) rather than shared with 6258]`.

### 4.2 Change detection (two tiers)

For each coverage file version, compare each row `{cdabr, dt, ht, s.st}` with the previous
accepted version of that file. A municipality whose `(dt, ht)` or `s.st` changed goes onto
the tier-2 queue. Coalescing is by path: a municipality that changes again while queued is
still fetched once.

The national/UF/abroad aggregate files are not gated on coverage. They are polled directly
at their `Expires`, because they feed the headline and must not wait one extra cycle.

### 4.3 Scheduler, budget and backoff

One process, one **priority queue of `(dueAt, path)`** and one **token bucket**:

- `dueAt` for tier 0/1 = the response's `Expires` (or `Date + max-age`) + uniform jitter
  1–3 s. **We never request a file before its edge copy expires** (invariant 4). This
  replaces a fixed 60 s clock and, on average, halves our staleness.
- Tier 2 items are due immediately when enqueued. Ordering among them: oldest change first,
  so every municipality is eventually fetched, with no starvation by size.
- **Token bucket: 100 tokens/s, burst 200; concurrency 16.** Timeouts: connect 3 s, total
  10 s. HTTP/2, `Accept-Encoding: gzip`, `If-None-Match: <last ETag>`, and an honest
  `User-Agent: apuracao-2026 (+contact URL)`.
- **AIMD on pushback:** any 429 or 503 halves the bucket rate (floor 5 req/s) and honours
  `Retry-After`. Every 30 s without errors adds +10 req/s, up to 100.
- **Per-file backoff:** on 5xx/timeout, exponential with full jitter, base 2 s, cap 60 s.
  A 404 on a file that existed before is recorded as an `absent` observation and re-polled
  at 60 s.
- **Circuit breaker:** if more than 20% of requests in the last 30 s failed, stop tier 2
  and poll only the national files (`br-…-u`, `br-…-ab`) every 60 s. Probe every 60 s and
  close the breaker after 3 consecutive cycles under 5% errors. While open, the site keeps
  showing the last good data with a "TSE indisponível desde hh:mm" notice.
- **No cache-busting** query strings, ever (research 02 §3).

Before the files exist (404) the recorder polls `ele-c.jws` and the two `cm` files every
5 min, and the national files every 60 s. It discovers the 2nd round by itself, so nobody
has to be awake for that.

### 4.4 Slow, failed, older or out-of-order versions

Every fetched body gets a sha256 and its header fields `idg`, `dg/hg`, `dt/ht`. Rules, per
path:

| Situation | Detected by | Action |
|---|---|---|
| Same bytes as the last version we stored | sha256 equal (or 304) | nothing. 304s are not observations, only metrics |
| New bytes, `idg` greater than the max accepted | normal | store, produce `version`, accept |
| New bytes, **`idg` lower** than the max accepted (another edge served an older copy, or a TSE rollback) | `idg` comparison | **store it** (it is a real published version), produce `version` with `regression: true`. The projector **does not move the current state backwards**. Alert if the same path regresses in 3 consecutive fetches |
| New bytes, **same `idg`** | `idg` equal, sha differs | store, produce with `anomaly: "same-idg-different-bytes"`, page, and the projector keeps the first one |
| Municipal `-u` is **older than the coverage row** that triggered it (`-u` `dt/ht` < `-ab` `dt/ht`): its own edge copy hasn't refreshed yet | timestamp comparison | store if new, keep the path in a **pending** set, re-fetch at its `Expires`. After 5 tries, mark it `stuck` and alert (warning only) |
| Signature invalid, or no `kid` match | Ed25519 verify | **store it** (raw log keeps everything) with `sig: "invalid"`. The projector excludes it from views and pages, because it means either corruption or a key rotation (§7.3) |
| Payload fails the Zod schema | parse | store with `schema: "failed"`, excluded from views, page |
| Timeout / 5xx after retries | HTTP | produce one `error` observation on entering the error state and one on recovery (transitions only). The UI shows that path as "falha ao buscar" with its last good value |
| 404 for a file expected to exist | HTTP | `absent` observation (transition only) |

`[VERIFY: idg is monotonic per path. Seen so far as a global generation counter
(2,835,808 … 2,854,936 across files of the same publication)]`.

### 4.5 Recorder leadership and redundancy

Two recorders run all the time in different AZs. Exactly one polls, the **lease holder**.

- **Lease:** the object `s3://apuracao26-raw/lease/recorder.json` containing
  `{holder, generation, expiresAt}`. It is acquired and renewed with S3 conditional writes:
  `If-None-Match: *` to create it, `If-Match: <etag>` to renew or take over. TTL 30 s,
  renewal every 10 s. A standby takes over when `expiresAt` has passed. Each observation
  carries the `generation` as a fencing token.
- The lease depends on **S3 only**, not on Kafka. Recording survives a broker outage.
- A split-brain (both polling for a few seconds) is harmless. Blobs are content-addressed,
  observation segments are per recorder, and duplicate `version` observations of the same
  `(path, sha256)` are idempotent in the projector. It costs the TSE a few extra requests.
- **Third, off-cloud recorder (optional):** the same container run on the user's machine with
  `RECORDER_ID=home`, writing to a separate prefix. It is insurance against an AWS-wide
  problem, and its recordings can be merged later because blobs are content-addressed.

---

## 5. History: the raw log and its projections

### 5.1 Raw log (immutable, kept forever)

Bucket `apuracao26-raw` (sa-east-1, private, versioning on, **S3 Object Lock in governance
mode, 10-year default retention**, SSE-S3).

| Key | Content | Written |
|---|---|---|
| `raw/v1/sha256/{h[0:2]}/{h}.jws` | the exact bytes received (after content-decoding), one object per distinct content | `PutObject` with `If-None-Match: *`. A `412` means "already stored", which is success. That is dedup and idempotency in one header |
| `obs/v1/{recorder}/{YYYY-MM-DD}/{HH}/{cycleStartUtc}-{cycleNo}.ndjson.gz` | the observations of one poll cycle, in fetch order | once per cycle, after the cycle's blobs are stored |
| `lease/recorder.json`, `lease/projector.json` | leases (§4.5, §5.4) | conditional writes |
| `checkpoints/projector/{epoch}/{offset:012d}.json.gz` | projector state + the offset it covers | every 50 publishes and on shutdown |
| `meta/keys/{kid}.jwk.json` | each TSE public key ever seen | when first seen |

An **Observation** is a state transition for one path, as seen by one recorder (contract in
§8): `version | absent | error | recovered`, with sha256, ETag, `idg`, TSE timestamps,
`fetchedAt`, recorder id, lease generation, `sig`, `schema`, `regression`, `anomaly`.

Ordering contract: within one recorder, observations are ordered by `(cycleNo, seqInCycle)`.
Across recorders there is **no** global order and none is needed, because the projector's
acceptance rule is by `idg` and sha, not by arrival.

### 5.2 The broker topics (learning path)

MSK, Kafka 3.x/4.x as offered by MSK `[VERIFY: latest MSK-supported Kafka version when
creating the cluster]`, 3 × `kafka.t3.small` across 3 AZs, TLS in transit, SASL/SCRAM auth
(`[VERIFY: @confluentinc/kafka-javascript + MSK SCRAM; IAM auth would need an OAUTHBEARER
token callback]`).

| Topic | Partitions | RF / min ISR | Retention | Key → value |
|---|---|---|---|---|
| `tse.observations.v1` | **1** | 3 / 2 | forever (`retention.ms=-1`) | TSE path → Observation JSON (~400 B, blob by reference) |
| `tse.cycles.v1` | 1 | 3 / 2 | forever | recorder id → cycle summary (counts, durations, errors) |
| `views.published.v1` | 1 | 3 / 2 | forever | `epoch` → published manifest summary (consumed by lab only) |

Producer: idempotent (`enable.idempotence=true`, `acks=all`), `linger.ms=20`.

**Why one partition:** the projector needs a single total order to cut consistent snapshots
(a `seq` is "everything up to offset N"). The whole night is ~50k messages, about 1/1000 of
what one partition handles. Partitioning (by election, by UF) only becomes interesting at
scale, and it is the first exercise in the lab. This is a teaching point, not a limitation
we'll hit.

### 5.3 Projections

All projections are pure functions in `packages/views`: `fold(state, observation, blob) →
state` and `render(state) → views`. They're deterministic: no wall clock, no randomness,
iteration in sorted key order. Any timestamp in a view comes from an observation.

| Projection | Built from | Output |
|---|---|---|
| **Current state** | latest accepted version per path | national, UF, abroad, municipal, governor views (§6.3) |
| **Timeline** | every accepted version of `br-c0001-e006258-u` (and of each UF aggregate) | one point per distinct national version: `{seq, tseTotalizedAt, observedAt, votes per candidate, valid, blank, null, sections %}`. Points exist only where we observed a version, and a gap longer than 3 min is an explicit gap marker |
| **Map frames** | current state at each `seq` | the map view of that `seq` (content-addressed, §6.2) |
| **Updates feed** | the difference between consecutive accepted versions | factual items with TSE time: national/UF lead changes, UF reaching 25/50/75/90/100% of sections, a candidate marked elected (`e: "s"`, `st`), all municipalities of a UF final, the TSE files becoming available. No commentary and no predictions |

`seq` = **the Kafka offset of the last observation folded into that publish**, within an
**epoch**. An epoch is one incarnation of the input log: epoch 1 = `tse.observations.v1`
from offset 0. A rebuild from S3, or a new topic, starts a new epoch. Within an epoch,
replaying offsets `0..N` produces byte-identical views. That is the replay test (§9.1).

### 5.4 The projector loop

1. Acquire `lease/projector.json` (same S3 lease as the recorder).
2. Load the latest checkpoint for the current epoch (`state + offset`), or start empty.
3. Assign partition 0 of `tse.observations.v1` manually (no consumer group: the lease is the
   leadership), seek to `offset + 1`.
4. For each observation: GET the blob from S3 by sha256 (same region, ~20 ms; LRU cache 200
   MB), re-verify the signature (~50 µs), parse, fold.
5. **Publish** when the state changed and either 2 s passed with no new observations or 10 s
   passed since the first unpublished change (debounce).
6. Checkpoint every 50 publishes. Offsets live **in the checkpoint**, not in a Kafka consumer
   group, so state and position are saved atomically: exactly-once *effects* on top of
   at-least-once delivery.

Publishing order makes torn reads impossible: **objects first, then the manifest, then the
pointer** (§6.2). The pointer write is conditional (`If-Match` on the pointer's current ETag)
and only moves forward (`(epoch, seq)` greater than the current one), so a briefly
double-active projector can't move it backwards.

### 5.5 Rebuild from scratch, and how long it takes

`pnpm --filter projector rebuild --source s3 --epoch <new>`:

1. List `obs/v1/*/…` segments (≈ 300 cycles × recorders), merge by `(fetchedAt, recorder,
   cycleNo, seqInCycle)`, and drop duplicate `(path, sha256)` pairs.
2. Fold everything, publishing each `seq` into the new epoch's prefix, then move the pointer
   (only if asked: `--promote`).

Estimate for a full night (~47k observations, ≤ 2.4 GB of blobs) on one 2-vCPU task:

| Step | Estimate |
|---|---|
| GET 47k blobs from S3, 64 in parallel at ~25 ms | ~20 s |
| JSON parse ≤ 2.4 GB, ~200 MB/s (coverage files dominate) | ~12 s, ~1 s if views skip coverage files (they only need br-ab) |
| 47k Ed25519 verifications at ~50 µs | ~3 s |
| Fold + render ~300 publishes, ~1,500 PUTs at 50 in parallel | ~15 s |
| **Total** | **≈ 1 minute; acceptance criterion: ≤ 5 min, measured** |

The same numbers make "rebuild" a usable emergency tool on the night (§10.2).

---

## 6. Fan-out to browsers

### 6.1 The user's hypothesis, challenged

> *Publish immutable, versioned JSON views (`/v/{seq}/…`) to object storage/CDN with long
> cache lifetimes, plus a tiny "latest seq" pointer (short TTL, or SSE).*

**Kept:** immutable views, long cache lifetimes, a tiny short-TTL pointer, and replay as
"load an older `seq`". That's the right shape: readers never touch compute, and the CDN
absorbs any multiple of traffic.

**Changed:**

1. **Content-address the views, don't copy them per `seq`.** `/v/{seq}/…` directories
   re-upload unchanged files every minute and give each a new URL, so the browser and the
   CDN refetch them. Instead each view is stored once at `/data/v1/o/{sha256}.json`, and a
   small immutable **manifest per `seq`** lists which hash each view had. Unchanged views keep
   their URL, so they're never refetched. Replay still is "load manifest N".
2. **Poll the pointer, don't push it (no SSE).** SSE means one open connection per viewer to
   something we run. 50k viewers = 50k long-lived connections on our compute, which breaks
   invariant 5, and CloudFront doesn't fan one upstream stream out to many viewers. A
   0.6 KB pointer with `s-maxage=5` costs the origin ~0.2 req/s no matter how many viewers,
   and staleness stays within the TSE's own 60 s. Cost and latency are compared in §11 and
   ADR-8.
3. **Pointer → manifest → objects is three round trips. Accept it, but keep it off the
   critical render.** The pointer carries the manifest hash. Views are fetched in parallel,
   and the client only fetches hashes it doesn't already hold.
4. **Herd on pointer flip.** When the pointer moves, every viewer fetches the same new
   objects within ~20 s. CloudFront collapses concurrent misses per edge, and Origin Shield
   collapses edges into one origin request. Clients also add 0–3 s jitter before fetching a
   new manifest.
5. **Never let an error be cached.** Objects are uploaded before anything references them,
   so a 404 for a referenced object is a bug. Error caching TTL on `/data/*` is set to 0 so a
   transient error is never cached for 10 s.
6. **The scrubber needs a cheap series, not 300 map downloads.** The chart and the scrubber
   positions come from timeline chunks (a few KB). The map for an older `seq` is fetched
   only when the scrubber rests on it (debounced 250 ms), and the neighbours are prefetched.
   Delta packs for smooth map animation are a nice-to-have (TASK plan, phase 6).

### 6.2 Public layout (`apuracao26-pub`, behind CloudFront)

| Path | Cache-Control | Content |
|---|---|---|
| `/`, `/_next/…` | HTML `max-age=60`; hashed assets `max-age=31536000, immutable` | Next.js static export |
| `/data/v1/latest.json` | `public, max-age=5, s-maxage=5, stale-while-revalidate=30, stale-if-error=86400` | the **pointer**: `{epoch, seq, manifest: sha256, publishedAt, tse: {generatedAt, totalizedAt}, health: {lastTseSuccessAt, breakerOpen, mode: "kafka"|"s3"}, pollSeconds}` (`pollSeconds` lets the runbook slow every client down without a deploy, §11.2) |
| `/data/v1/{epoch}/m/{seq:012d}.json` | `max-age=31536000, immutable` | **manifest**: hashes of every view at this `seq`, plus the timeline and feed chunk hashes |
| `/data/v1/o/{sha256}.json` | `max-age=31536000, immutable` | a **view** (content-addressed, gzip/brotli by CloudFront) |
| `/data/v1/{epoch}/index.json` | `max-age=30` | list of `seq`s with `tseTotalizedAt` (for the scrubber's track); also rebuilt as immutable chunks |
| `/data/v1/geo/br-mun-2025.{sha8}.topo.json` | `immutable` | the map geometry (~330 KB gzip) |
| `/data/v1/raw/{sha256}.jws` (nice-to-have) | `immutable` | the signed TSE source of a view, so anyone can verify it (§7.3) |

### 6.3 Views (all in `packages/contracts`, §8)

| View | Approx. size (gzip) | Content |
|---|---|---|
| `national-president` | ~3 KB | the 2 candidates (votes, TSE % string, elected flag), valid/blank/null, turnout/abstention, sections counted, TSE timestamps, status |
| `uf-president/{uf}` ×28 (27 + `zz`) | ~2 KB each | same, per UF, plus municipalities final/partial/not started (from `br-ab`) |
| `regions-president` | ~2 KB | 5 regions, computed from UF files (labelled as our sum, §7.4) |
| `map-president` | **~20 KB** | columnar arrays over the 5,571 municipalities, in geometry order: leader, margin (basis points), sections counted (basis points), status code |
| `governor/{uf}` ×7 | ~2 KB each | per-state governor headline + municipal columns for that UF |
| `timeline-chunk` | ~4 KB per 60 points | the timeline projection (§5.3) |
| `feed-chunk` | ~2 KB per 50 items | updates feed |

### 6.4 The web app

- **Next.js 16, App Router, `output: 'export'`** (static HTML/JS uploaded to the public
  bucket). Server Components render the static shell at build time. Live parts are small
  client leaves, per the user's global frontend rules. There's no server, so there's
  nothing for readers to overload.
- **TanStack Query**, one `queryOptions` factory per endpoint: `latestPointerQuery`
  (`refetchInterval` = the pointer's `pollSeconds`, default 20 s, paused when the tab is hidden), `manifestQuery(epoch, seq)` and
  `viewQuery(hash)` with `staleTime: Infinity` (immutable). All wrapped in named hooks
  (`useNationalResult()`, `useMapFrame(seq)`).
- **Replay = URL state**: `?seq=…` selects a manifest. A replay link is shareable and
  served entirely from cache.
- **Status is always visible:** "Atualizado às hh:mm:ss (TSE: hh:mm:ss)", turning amber
  after 3 min without a new `seq` and red after 10 min, with the reason from
  `pointer.health`.
- Analytics: **cookieless page counts (Umami)**, no ads, no consent banner needed
  `[VERIFY: reuse the user's existing Umami setup; Umami script on a cloudfront.net host]`.

---

## 7. Correctness and trust

### 7.1 Numbers

- All TSE numbers are strings. `packages/tse` parses them with **strict Zod schemas**:
  - `TseInt`: `/^\d+$/`, transformed to `number` and asserted ≤ `Number.MAX_SAFE_INTEGER`
    (the largest real value is ~158 M).
  - `TseDecimal`: `/^\d+(,\d+)?$/`, kept as **the original string** plus a `number` for
    sorting/colour only. **Displayed percentages are the TSE's own strings** (`pvap`,
    `pst`, `pc`) reformatted for pt-BR, so we never show 47.02% where the TSE shows 47,03%.
  - Derived quantities (gap in votes, margin) are computed from integers. Shown percentages
    we compute ourselves (regions, the margin colour scale) are labelled "calculado".
  - Dates: `dd/mm/yyyy` + `hh:mm:ss` → ISO 8601 with `-03:00` (Brasília, no DST).
- A schema failure never drops data: the raw blob is stored. The version is excluded from
  views, and we page.

### 7.2 Missing ≠ zero ≠ failed (invariant 6)

Every result unit (national, UF, municipality, governor UF) has one **status**:

| Status | Meaning | Shown as |
|---|---|---|
| `not_published` | the TSE file is 404 / not yet seen | "Aguardando dados do TSE", hatched, no numbers |
| `no_sections` | file exists, `s.st = "0"` | "0 seções apuradas", grey, numbers hidden |
| `counting` | `0 < st < ts` | numbers + "x% das seções" |
| `final` | `st = ts` and `tf = "s"` (`[VERIFY: meaning of tf / and values on the night]`) | numbers + "apuração encerrada" |
| `fetch_failed` | last attempt errored; a last good version may exist | last good numbers + "falha ao atualizar desde hh:mm", dimmed |

A zero is a number inside `counting`/`final`. A missing value is never rendered as `0`.

### 7.3 Signatures

- Verify every `.jws` with the TSE's Ed25519 key (WebCrypto, `crypto.subtle.verify`). The
  key is **pinned in the repo** (`packages/tse/keys/prod.jwk.json`, `kid
  sNbt9Q_fLS65zE1_ZLNV-XRRwPY`).
- If a file arrives with an **unknown `kid`**: fetch
  `/oficial/app/assets/assinatura-jws/prod.jwk.json`. If it contains that `kid`, store it
  under `meta/keys/`, accept, and page (so a human confirms the rotation). Otherwise
  `sig: "invalid"`.
- **"Verify this number"** (nice-to-have): each view lists the sha256 of its source `.jws`
  files, and the public bucket mirrors those `.jws` at `/data/v1/raw/{sha}.jws`. A reader
  can check a number against the TSE's signature in their own browser.

### 7.4 Reconciliation

- The **headline always comes from the TSE's national file**, never from our sums.
- Checks run on every publish and emit metrics; they never block a publish:
  1. Σ UF + `zz` per candidate vs `br` (same `dt/ht` only).
  2. Σ municipalities of a UF vs the UF file (same `dt/ht` only).
  3. `vv = Σ candidates`, `tv = vv + vb + tvn`, and `st ≤ ts` inside each file.
- **During the count**, files are generated at different instants, so cross-file sums
  legitimately differ. Drift is a metric, and alerts fire only if a mismatch persists for
  10 min between files with equal `dt/ht`. **When final**, check 1 must be exact, and any
  difference pages.
- Region totals are our sums of UF files, labelled as such.

### 7.5 Idempotency (invariant 3)

| Layer | Mechanism | Test |
|---|---|---|
| Blob store | content address + `If-None-Match: *` | write the same blob twice: second call returns 412 → treated as success, object unchanged |
| Observations | projector ignores a `(path, sha256)` it already accepted | produce the same observation twice: state unchanged |
| Kafka | idempotent producer | integration test with broker restarts |
| Views | content-addressed; `seq` = offset; deterministic render | replay offsets 0..N twice → byte-identical manifests |
| Pointer | conditional, forward-only | two projectors racing never move it backwards |

---

## 8. Contracts (`packages/contracts`)

Zod 4 schemas, exported as types. Schemas are versioned in the path (`/v1/`) and on every
object (`"v": 1`).

```ts
// TSE input shapes (parsed from the .jws payload)
TseResultFile        // -u: header (ele, t, f, tpabr, cdabr, dg, hg, idg, dt, ht, tf, and)
                     //     + carg[] → agr[] → par[] → cand[] (n, sqcand, nmu, vap, pvap, e, st)
                     //     + s (sections), e (electorate/turnout), v (valid/blank/null)
TseCoverageFile      // -ab: header + abr[] (tpabr, cdabr, dt, ht, s, e, munf/munpt/munnr for UF rows)
TseMunicipalityIndex // -cm: abr[] (cd, ds, mu[] (cd, cdi, nm, c, z[]))
TseElectionCatalog   // ele-c: arq[] templates, pl[] (cd, c, dt, e[] (cd, cdt2, nm, t, abr[].cp[]))
TseInt, TseDecimal, TseDate, TseTime   // the string-number primitives (§7.1)

// Internal log
Observation = {
  v: 1, kind: 'version' | 'absent' | 'error' | 'recovered',
  path: string,                    // 'ele2026/6258/dados/sp/sp71072-c0001-e006258-u.jws'
  election: '6258' | '6260', fileType: 'u' | 'ab' | 'cm' | 'c',
  scope: { level: 'br' | 'uf' | 'mu' | 'zz', uf?: string, mu?: string },
  sha256?: string, bytes?: number, etag?: string,
  idg?: string, tseGeneratedAt?: string, tseTotalizedAt?: string,
  sig?: 'valid' | 'invalid', kid?: string, schema?: 'ok' | 'failed',
  regression?: boolean, anomaly?: string, httpStatus?: number, error?: string,
  fetchedAt: string, recorder: string, leaseGeneration: number, cycleNo: number, seqInCycle: number,
}

// Published (all carry v, epoch, seq, sources: sha256[] of the .jws they came from)
LatestPointer, Manifest, NationalView, UfView, RegionsView, MapView,
GovernorView, TimelineChunk, FeedChunk, ResultStatus
```

`MapView` is columnar, so 5,571 rows stay small:
`{ geo: 'br-mun-2025@<sha8>', candidates: [{n, name}], leader: number[] /* -1 none, 0|1 */,
marginBp: number[], countedBp: number[], status: number[] /* ResultStatus codes */ }`, in
the geometry file's feature order. The geometry version is pinned in the view, so a geometry
change can never silently misalign colours.

Python/Go are not used, so no hand-mirrored shapes are needed.

---

## 9. Testing before the 25th (no live feed exists)

There is no TSE test environment (research 02 §1). The test bed is our own **fake TSE** fed
with real files.

### 9.1 Layers

| Layer | What | Pass criterion |
|---|---|---|
| Parsers | every file in `docs/research/samples/` + the full 1st-round capture (§9.2) through the Zod schemas | 100% parse, totals match the cross-check in research 01 §4 |
| Signatures | verify the captured `.jws` samples; flip one byte → invalid | exact |
| Folds | `packages/views` on real files | snapshot tests on real data only |
| Integration (testcontainers: **Redpanda** as the Kafka-API broker, **MinIO** as S3) | recorder → broker → projector → bucket, end to end | idempotency test, replay test, both recorders racing |
| Replay = live | rebuild from S3 segments vs the live projector's epoch | every view byte-identical except epoch/seq ids |

Redpanda/MinIO are real brokers/stores speaking the same protocols, not mocks. Production is
MSK/S3. A staging run against real MSK/S3 is part of the dress rehearsal (§9.4).

### 9.2 The fake TSE (`apps/fake-tse`)

1. **Capture the complete 1st-round final state once** (Phase 1): every `.jws` for `6257`
   president (5,757 + 29 + 29) and `6259` governor for all UFs, about 12k files, at a polite
   10 req/s (~20 min). This is real TSE-signed data, and it seeds the raw log as well.
2. The fake TSE serves those files with **TSE semantics**: per-file `max-age` counting down
   to a fixed `Expires`, `ETag` = MD5, `If-None-Match` → 304, gzip, 404 before a file
   "exists", configurable latency (p50 80 ms, p99 2 s), and injected 429/503/timeouts.
3. **Staged reveal at accelerated speed** (default ×20, so 17:00–01:00 runs in 24 min):
   each municipal file appears at its **real** `ht` from the 1st-round coverage files, and
   each coverage file is served with only the rows already revealed.
4. **Chaos:** kill a recorder, kill a broker, kill the projector, block S3 for 60 s, serve a
   previously served version again (regression), corrupt a signature.

> **Invariant check — needs the user's sign-off (§15 Q2).** Step 3 serves *coverage files
> with rows withheld*, i.e. files that are real row by row but not byte-identical to any
> file the TSE published. Every *number* is real and none is edited, but the file as a
> whole didn't exist. These files are test fixtures only: they are served on localhost or a
> staging distribution, the staging site carries a permanent "SIMULAÇÃO DE TESTE — dados
> reais do 1º turno reapresentados" banner, they are never written to the production
> buckets, and they fail signature verification by construction (the recorder runs with
> `TSE_KEY=test` in the harness).

**What the harness proves, with numbers:**

- Zero lost versions: every version the fake TSE served appears in the raw log.
- No path is requested before its `Expires`. Request rate ≤ 100/s, burst ≤ 200.
- The worst-case burst (all 6,318 municipal files changed in one window) drains in ≤ 70 s.
- Publish lag p95 ≤ 15 s from observation to pointer.
- The rebuild equals live, and the rebuild takes ≤ 5 min for the whole replay.
- With the broker killed: recording continues, and the projector switches to S3 mode within
  3 min.

### 9.3 Load and browser performance

- **CDN load** (k6 OSS, run from an EC2 instance in sa-east-1 against the staging
  distribution): a viewer model (pointer every 20 s, a new manifest + views per 60 s), 5,000
  virtual viewers (1:10 of the design peak), 15 min, **3 runs, medians reported**.
  Pass: edge p95 TTFB ≤ 150 ms from sa-east-1, cache hit ratio ≥ 99% on `/data/v1/o/*`, and
  origin requests ≤ 2/s (CloudFront metrics). Full 50k scale isn't generated: CloudFront
  capacity isn't the risk at this size, cost is, and §11 models it.
- **Map rendering** (Playwright, Chromium with 4× CPU throttle, mobile viewport, 5 runs,
  median): first full draw of 5,571 polygons ≤ 50 ms, recolour on a new frame ≤ 16 ms,
  pan/zoom frames ≤ 16 ms p95, JS heap ≤ 60 MB.
- **First load** on "Fast 4G" emulation: shell interactive ≤ 2.5 s, map drawn ≤ 4 s.

### 9.4 Dress rehearsal (2026-10-22)

The full accelerated replay end to end on **production AWS resources** (MSK, Fargate,
CloudFront) under a `staging` epoch and prefix, with alarms live and the runbook in hand.
The production pointer isn't touched.

---

## 10. Operating it

### 10.1 Observability

Structured JSON logs to CloudWatch Logs using **Embedded Metric Format** (metrics without a
metrics agent). Metrics:

| Metric | Dimension | Meaning |
|---|---|---|
| `tse_requests_total` | status class, tier | rate and errors |
| `tse_last_success_age_s` | file class (br, uf-agg, ab, mun) | per-class freshness. Per-file freshness lives in a `/data/v1/ops/freshness.json` (private) |
| `tse_pending_mun` / `tse_stuck_mun` | election | tier-2 backlog |
| `ingest_lag_s` | — | now − TSE `dg/hg` of the newest national version |
| `kafka_produce_errors`, `projector_offset_lag` | — | broker path health |
| `publish_lag_s` | — | observation `fetchedAt` → pointer write |
| `sig_invalid_total`, `schema_failed_total`, `regressions_total` | — | trust |
| `recon_drift_votes` | check id | §7.4 |
| `pointer_age_s` | from canaries | what a reader sees |

**Canaries:** a small scheduled Lambda (EventBridge, every 1 min) in `sa-east-1` and in
`us-east-1` fetches `latest.json` through CloudFront and publishes `pointer_age_s`. That's
~90k invocations over the window, inside the Lambda free tier. CloudWatch Synthetics would
do the same for ~$10 more, and was dropped for cost.

### 10.2 Alarms (SNS → email + SMS to the user)

| Alarm | Condition | Severity |
|---|---|---|
| Readers see stale data | `pointer_age_s` > 180 for 3 min (canary) | page |
| TSE national unreachable | `tse_last_success_age_s{br}` > 150 | page |
| TSE error rate | > 20% over 5 min, or breaker open | page |
| No recorder lease holder | lease expired > 60 s | page |
| Broker path broken | `projector_offset_lag` > 500 for 3 min, or projector in S3 mode | page |
| Trust | `sig_invalid_total` or `schema_failed_total` > 0, or `same-idg-different-bytes` | page |
| Stuck municipalities | `tse_stuck_mun` > 50 for 10 min | warn |
| Reconciliation | final check 1 ≠ 0 | page |
| Spend | AWS Budget at 50/80/100% of the agreed cap | email |

### 10.3 Runbook (abridged; the full one is written in Phase 5)

- **T-3 days:** freeze features. Run the dress rehearsal. Confirm alarms reach the phone.
- **From 2026-10-20, daily:** check whether `6258`/`6260` exist. When they do, capture a
  sample of each file type into `docs/research/samples/` and resolve the §4.1 `[VERIFY]`.
- **T-1 day (Sat 10-24, 12:00 BRT):** switch the night stack on (`cdk deploy -c night=on`:
  MSK + standby recorder + standby projector). MSK takes ~30 min to create
  `[VERIFY: creation time in sa-east-1]`, and was already created once successfully on 10-22.
  Check cluster health, switch the projector from S3 mode to Kafka mode, set the Budget alarm,
  and write the "not started" pointer (status `not_published`). If MSK fails to come up, the
  night runs in S3 mode, and nothing else changes.
- **Mon 10-26, 12:00 BRT:** switch the night stack off (`cdk deploy -c night=off`). Stop the
  primary recorder and projector on 10-27 after the final state is confirmed. The buckets and
  CloudFront stay, and cost cents.
- **Election day:** recording starts whenever the files appear (auto-discovery). Polls
  close at 17:00 BRT (`[VERIFY: unified closing time]`). Watch the dashboard from 16:30. Stop
  watching when every file is `final`. Keep recording until 2026-10-26 12:00 BRT.

| Symptom | Action |
|---|---|
| TSE 429/503 | Nothing: AIMD and the breaker handle it. If it persists > 10 min, lower `RATE_MAX` to 30 via an SSM parameter (read every cycle) |
| Recorder crashed | ECS restarts it. The standby takes the lease within 30 s. Confirm a new lease generation |
| MSK broker down | Nothing: RF 3 / min ISR 2 tolerates one. Two down → projector auto-switches to S3 mode, page. Fix MSK later |
| Projector crashed | ECS restarts it. The standby takes the lease and resumes from its checkpoint |
| Wrong data published | **Roll the pointer back**: rewrite `latest.json` to the last good `(epoch, seq)` (`pnpm ops pointer:set`). Immutability makes this a one-line rollback. Then fix and re-project into a new epoch |
| Everything on our side down | CloudFront serves the last pointer (`stale-if-error=86400`). The UI turns red after 10 min with "atualização interrompida". Restore, and the timeline shows the gap honestly |

### 10.4 Deployment

- **IaC: AWS CDK (TypeScript)** in `infra/`: VPC (public subnets for Fargate with public IPs,
  no NAT gateway; private subnets for MSK; S3 gateway endpoint), the two buckets, MSK,
  ECS cluster + services, CloudFront (OAC, Origin Shield sa-east-1, cache policies per path,
  error TTL 0 on `/data/*`), canary Lambdas, alarms, SNS, Budget.
- **The night stack is a switch, not a separate system:** a CDK context flag `night=on|off`
  creates or deletes MSK and the two standby tasks. Everything that costs money by the hour
  is behind it, except the one primary recorder and projector. Turning it on is tested on
  10-15 (smoke test) and 10-22 (rehearsal) before it matters.
- **CI** (GitHub Actions): lint, typecheck, unit + integration tests (testcontainers) on
  every push. On `main`: build ARM images to ECR, `cdk deploy`. The web app is built with
  `next build` (static export) and synced to the public bucket. Hashed assets go first, then
  HTML, then a CloudFront invalidation of `/index.html` and `/*.html` only.
- **Freeze rule:** no deploy between 2026-10-24 00:00 and 2026-10-26 12:00 BRT except via
  the runbook.

---

## 11. Hosting and cost (AWS, sa-east-1, paid from credits)

**Principle: AWS bills per hour that something is switched on, used or not. So nothing runs
before it has a job.** Only the recorder has a job weeks ahead (finding the 2nd-round files,
and soaking against the real TSE). Kafka and the standbys only have a job on the rehearsal
and the night. Development and integration tests run on local Docker (Redpanda + MinIO) at
no cost.

Prices are AWS's published São Paulo rates (research 02 §7).

### 11.1 What runs when

| Resource | Size | Switched on | Hours | Cost |
|---|---|---|---|---|
| Recorder (primary) | Fargate ARM 0.25 vCPU / 0.5 GB ($0.017/h) | Sun 10-11 → Tue 10-27 | 384 | ≈ $6.50 |
| Projector (primary) | Fargate ARM 0.5 vCPU / 1 GB ($0.034/h) | Sun 10-18 → Mon 10-26 (S3 mode until the night) | 192 | ≈ $6.50 |
| Recorder + projector (standbys) | same sizes ($0.051/h together) | Sat 10-24 12:00 → Mon 10-26 12:00 | 48 | ≈ $2.50 |
| **MSK smoke test** (auth, networking, client) | 3 × `kafka.t3.small` ($0.2208/h) | Thu 10-15, a few hours | ~4 | ≈ $1 |
| **MSK rehearsal** | same | Thu 10-22, 08:00 → 23:00 | 15 | ≈ $3.30 |
| **MSK election night** | same | Sat 10-24 12:00 → Mon 10-26 12:00 | 48 | ≈ $10.60 |
| MSK storage | 3 × 10 GB at $0.19/GB-month, only while the cluster exists | — | — | < $1 |
| Public IPv4 on tasks | $0.005/h each `[VERIFY: sa-east-1 rate]` | with the tasks | ~670 | ≈ $3.50 |
| S3 (≤ 5 GB, ~100k PUTs) | — | always | — | < $3 |
| CloudWatch Logs + metrics, canary Lambdas | `[VERIFY: sa-east-1 log ingestion rate]` | with the tasks | — | ≈ $3 |
| k6 load generator (EC2, rehearsal week) | one instance, a few hours | 10-19 → 10-21 | ~6 | ≈ $1 |
| **Total, everything except CloudFront** | | | | **≈ $40** |

The election night itself (24 h with everything on) is about $7 of servers. Most of the
remaining total is the recorder and projector running quietly for two weeks beforehand, and
the rehearsal.

If Kafka were dropped (S3 mode only), the total would be **≈ $25**. That is what the
learning choice costs: ~$15.

### 11.2 CloudFront: the only cost that grows with viewers

It is billed **per request** ($0.022 per 10,000 HTTPS requests in South America, after 10 M
free per month) and per GB ($0.110 after 1 TB free). Each viewer checks the pointer every
20 s, so requests, not bytes, are what grow.

| Peak concurrent viewers | Requests / data over a 5-hour night | Cost (pay-as-you-go) |
|---|---|---|
| 5,000 (realistic) | 9 M / 51 GB | **$0** (free tier) |
| 50,000 (design peak, §2.3) | 90 M / 510 GB | ≈ $176 |
| 250,000 (extreme) | 450 M / 2.5 TB | ≈ $1,130 |

Two caps, both decided before the night:

1. **Adaptive polling.** `latest.json` carries `pollSeconds` (default 20). If the canary or
   CloudFront metrics show more than ~10k concurrent viewers, raise it to 45 s from the
   runbook (one pointer write, no deploy). That roughly halves requests at the cost of up to
   25 s more staleness, still within the TSE's own 60 s cache.
2. **CloudFront flat-rate Pro plan ($15/month, no overage charges).** Its 10 M-request
   allowance tolerates a first spike of 3×, and beyond that "delivery may be adjusted", not
   billed. It turns the worst case into a fixed $15. `[VERIFY: whether AWS credits pay for
   flat-rate plans, and that a plan works on the default *.cloudfront.net hostname]`.

**Expected total for the election: ≈ $40, plus $0–15 for CloudFront with either cap in
place.** An AWS Budget alarm at $60 emails the user if something is left switched on.

---

## 12. Learning lab (off the critical path)

Each item has its own task doc before any code, and none of them runs on election night
unless it is a passive extra consumer group that can be killed without effect.

1. **Partitioning:** re-key `tse.observations` by UF across 12 partitions, and build
   consistent cuts with per-partition watermarks instead of a single offset. (Shows exactly
   why the night uses one partition.)
2. **Stream-processor rewrite:** the projector as a stateful stream job (Kafka Streams-style
   state stores and changelogs, or Flink). Compare its output byte for byte with
   `packages/views`.
3. **Analytical store:** load the log into DuckDB/ClickHouse. Change rate per municipality,
   time-to-final by UF, the shape of the count.
4. **Self-managed Kafka (KRaft) on EC2**, then broker-kill drills: ISR shrink, unclean leader
   election, `acks=1` vs `acks=all` data loss demonstrated.
5. **Build-your-own replicated log** (side-project idea 2): Raft-replicated, partitioned
   append-only log, with this night's ~50k observations as its real workload. "Replay"
   becomes reading your own log back.

---

## 13. After the count: the bulk seam (stretch, not for the 25th)

- **Sources:** per-section ballot-box files under `arquivo-urna/{pleito}/dados/{uf}/{mun}/{zona}/{secao}`
  (template `aux` in `ele-c`) and the open-data portal dataset `resultados-2026`
  (`dadosabertos.tse.jus.br`) `[VERIFY: formats, sizes, release dates for the 2nd round]`.
- **Seam:** a separate batch app, `apps/bulk`, writing **Parquet** to a separate prefix
  `s3://apuracao26-lake/…`, partitioned by `election/uf`. It never writes into `raw/`, `obs/`
  or the live topics, and it is never read by the live projector. Join keys: TSE `uf` +
  municipality `cd` + `zona` + `secao`, and `cdi` for IBGE.
- **Query:** Athena or local DuckDB. Results published as separate static views if ever
  shown.
- **The seam's contract** lives in `packages/contracts/bulk` once it exists. Nothing in the
  live system depends on it.

---

## 14. Decisions and rejected alternatives (ADRs)

**ADR-1 · Fetch `.jws`, not `.json`.** One request gives both the data and the TSE's proof.
The payload is byte-identical (verified). Cost: +35% bytes, ~50 µs per verification.
*Rejected:* `.json` plus a separate `.jws` fetch (2× requests, and two objects that can be
momentarily out of sync).

**ADR-2 · TypeScript (Node 24) everywhere.** IO-bound work at ~100 req/s. One language
shares the Zod contracts with the web app, and the user's stack is TS. *Rejected:* Go for
ingestion. It's a fine fit, but it forces hand-mirrored contracts for no performance need.
It stays a lab option.

**ADR-3 · Raw log = content-addressed S3 objects with Object Lock + per-cycle observation
segments.** Dedup and idempotency come from the key itself. Immutability is enforced by the
store, not by discipline. *Rejected:* a database as the log (more to run; blobs don't
belong in it), Kafka as the only log (rule 1 of §3.3).

**ADR-4 · MSK (3 × t3.small) on the critical path, by the user's choice, for learning.** The
numbers don't require it (§2.2). It's made safe by the claim-check pattern, S3 leases and the
S3 fallback mode. *Rejected:* MSK Serverless ($1.195/cluster-hour ≈ $870/month in São
Paulo), self-managed Kafka/Redpanda on EC2 for the night (patching and broker recovery
become our job on the one night that matters; moved to the lab), Kinesis (less transferable
learning, no consumer-controlled offsets in the same way), SQS (no replay, no ordering
across consumers), NATS JetStream (good, but the user's learning target is the Kafka model).
MSK exists only for ~67 hours in total (smoke test, rehearsal, night; §11.1), about $15.
`[VERIFY: AWS guidance on kafka.t3.small for production; fall back to kafka.m7g.large ×3
($0.976/h, ≈ $65 for the same 67 hours) only if t3.small is unsuitable]`.

**ADR-5 · No database.** State is ~10 MB, rebuildable in ~1 min, checkpointed to S3.
*Rejected:* Postgres/DynamoDB. They'd be one more thing to fail, back up and pay for with
no query need on the night.

**ADR-6 · One partition, offsets in the checkpoint, leadership by S3 lease.** A total order
gives consistent cuts, so `seq` = offset. Keeping offsets with state gives atomic
checkpoints. *Rejected:* consumer-group leadership. It would make recording/projecting
depend on the broker for coordination.

**ADR-7 · Per-file scheduling at `Expires` + jitter.** It is the fastest polite cadence
possible. *Rejected:* a fixed 60 s clock (up to 2× staleness for no saved requests),
cache-busting (loads the TSE origin, breaks invariant 4).

**ADR-8 · Fan-out by immutable content-addressed views + manifest per `seq` + a polled
pointer.** *Rejected:* SSE/WebSockets (an origin connection per viewer, breaks invariant 5;
re-evaluate only behind a managed pub/sub that fans out at the edge). Per-`seq` directory
copies (no dedup; every view refetched every minute). Next.js SSR/ISR (readers would
trigger compute). Vercel/Cloudflare R2 (R2 needs a domain on Cloudflare; the user chose AWS
credits and no domain).

**ADR-9 · AWS sa-east-1 + CloudFront's default `*.cloudfront.net` hostname.** Close to the
TSE's edge, Brazilian egress IPs (`[VERIFY: no geo-filtering by the TSE on election night;
our current tests ran from a Brazilian residential IP]`), credits cover it, and no domain is
needed now. A custom domain later is a CNAME + ACM certificate, no redesign.

**ADR-10 · Map: Canvas 2D with geometry pre-projected at build time.** One `Path2D` per
municipality, recolour = refill, hit-testing via an off-screen picking canvas. *Rejected:*
SVG (5,571 DOM nodes, pan/zoom janks on mid-range phones), WebGL/MapLibre/deck.gl (a large
bundle, a tile/style pipeline, overkill for a static choropleth). Geometry: IBGE Malha
Municipal 2025, simplified to ~0.4%, quantized 1e4, **~330 KB gzipped**, joined 5,571/5,571
on `cdi`, with the two RS lake areas drawn as water.

**ADR-11 · Kafka client `@confluentinc/kafka-javascript`.** Official, librdkafka-based,
maintained (Sept 2026 release). *Rejected:* `kafkajs` (last published Feb 2023).

**ADR-12 · Show the TSE's own percentage strings.** Our rounding never disagrees with the
official app. Everything we compute is labelled "calculado".

**ADR-13 · Next.js static export on the same distribution.** No CORS, one cache
configuration, no server to overload. *Rejected:* Vercel Hobby (it would work, but splits
hosting, and the data origin needs AWS anyway).

---

## 15. Open questions for the user

1. **How much AWS credit is available, and until when?** The plan costs ≈ $40 plus $0–15 of
   CloudFront with the caps in §11.2 (uncapped, $176 at 50k peak viewers). Do credits cover
   CloudFront flat-rate plans?
2. **Can the replay harness serve coverage files with rows withheld** (every number real,
   but the files never existed as such), under the test-only conditions of §9.2? If not, the
   harness can only reveal whole files, and the change-detection path is first exercised
   for real on the 25th.
3. **Is 50k concurrent viewers the right design peak?** A lower figure changes nothing
   architectural, only the cost table.
4. **Governor views:** must-have or nice-to-have for the 25th? (The plan treats them as
   nice-to-have; the recorder records them regardless.)
5. **Domain:** OK to launch on `dXXXX.cloudfront.net` and add a domain later?
6. **Umami:** reuse your existing Umami account/site, or a new one?
7. **Off-cloud third recorder** on your own machine on election night: yes or no?
8. **Should the raw `.jws` mirror be public** ("verify this number")? It republishes TSE
   files. They're public data, but it's your call.

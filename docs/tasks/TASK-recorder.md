# TASK: The recorder (Phase 1, must-have 1)

**Status (2026-10-08): live on AWS, gate met 3 days early.** Outcome and deviations are in §6.

Phase 1 of `TASK-implementation-plan.md`. **Gate: Sun 2026-10-11.** By Sunday night, the
recorder must be recording unattended on Fargate, or everything else pauses. This document
also covers the raw bucket and the deploy, which the plan had as a separate
`TASK-infra-raw-bucket.md`. They're one deliverable, so they get one contract.

## 1. Current scenario

Phase 0 is done. `packages/tse` builds every path, verifies `.jws` and validates payloads.
`packages/contracts` has `Observation`. CDK is bootstrapped in sa-east-1 with only
`BudgetStack`. `apps/recorder` and `apps/fake-tse` are empty shells. There's no S3 emulator
locally (MinIO's image is gone, `TASK-scaffold-monorepo.md` §6).

The design is `architecture.md` §4 (poll loop), §5.1 (raw log) and §4.5 (lease). The TSE
facts are research 01/02. Today the 2nd-round files (`6258`/`6260`) are 404, and the
1st-round files (`6257`/`6259`) are frozen at their final state.

What's missing: nothing records anything yet. **Every day without a recorder is a day the
2nd-round files could appear unrecorded.** The plan expects them from ~10-20, but nobody
knows for sure.

## 2. Planned changes

### 2.1 Scope for the gate (and what's deliberately not in it)

**In:**
- the poll loop of §4.1–4.4 (tiers 0–2, per-file `Expires` scheduling, token bucket, AIMD,
  per-file backoff, breaker, version rules);
- S3 content-addressed blobs + observation segments;
- the S3 lease;
- EMF metrics + one "recorder silent" alarm;
- the Fargate deploy;
- `apps/fake-tse` **v0**: serves the samples with TSE HTTP semantics, no staged reveal.

**Not in (later phases):**
- the Kafka producer (`TASK-kafka-log.md`, Phase 2, added as a second sink);
- the standby task (the night stack, 10-24);
- the full alarm set (Phase 4);
- the staged-reveal harness (Phase 2).

**What it records until the 2nd round appears:**
1. **The 1st round, once, in full.** A recorder that starts with no history sees every
   coverage row as "changed", so its first cycle fetches every municipal file. That *is*
   the capture: ~11.5k files, all 1st-round `-u`/`-ab` for president (`6257`, br + 27 UFs +
   zz) and governor (`6259` `c0003`, 27 UFs), at **10 req/s** (≈ 20 min).
2. **Then a slow soak of the same files.** They're frozen, so each 1st-round target is
   re-polled no more often than every **600 s**, not at its `Expires`: ~0.2 req/s, almost
   all 304s.
3. **Discovery of the 2nd round,** as §4.3 says: `ele-c` and the two `cm` files every 5 min,
   and `br-c0001-e006258-u` / `br-e006258-ab` / `rj-c0003-e006260-u` every 60 s, all 404
   for now. That's ~4 req/min. When one turns 200, its election's normal loop starts by
   itself, at `Expires` cadence, and an SNS email says so.

### 2.2 `apps/recorder` (hand-written; nothing generates this)

| Module | Responsibility |
|---|---|
| `config.ts` | env → typed config (Zod). Targets, e.g. `RECORDER_TARGETS=6257:1:600,6259:3:600,6258:1:expires,6260:3:expires` (election : office : cadence); `RATE_MAX` (default 10 now, 100 on the night); `RECORDER_ID`; bucket name; `FLUSH_MS` 5,000; `HEARTBEAT_MS` 60,000 |
| `schedule.ts` | the priority queue of `(dueAt, path, tier)`. `dueAt` = `Expires` (else `Date + max-age`) + uniform 1–3 s jitter, or the target's fixed cadence, whichever is later. Tier 2 is due on enqueue, oldest change first, coalesced by path |
| `budget.ts` | token bucket (rate, burst = 2 × rate) + concurrency 16 + AIMD (halve on 429/503 down to a 5 req/s floor, honour `Retry-After`, +10 req/s per 30 s without errors) + breaker (>20% failures over 30 s → only the national files every 60 s; close after 3 clean cycles under 5%) |
| `fetch.ts` | one conditional GET. `If-None-Match`, gzip, connect 3 s / total 10 s, HTTP/2 via an `undici` Agent with `allowH2` `[VERIFY: Akamai negotiates h2; fall back to keep-alive h1]`, `User-Agent: apuracao-2026 (+<repo URL>)`, **no query string, ever**. Checks `ETag` == MD5 of the decoded body (research 02 §3: a free integrity check) |
| `version.ts` | the rules table of §4.4: sha256 → same/new; `idg` compare → normal / `regression` / `same-idg-different-bytes`; `verifyJws` → `sig`; `parseTseFile` → `schema`; `-u` older than its triggering coverage row → pending (re-fetch at `Expires`, `stuck` after 5). Pure, so it's unit-tested without IO |
| `coverage.ts` | diff of a coverage version against the previous accepted one, by `{cdabr, dt, ht, s.st}`, giving the municipalities to enqueue as tier 2 |
| `store.ts` | blob `PutObject` to `raw/v1/sha256/{h0:2}/{h}.jws` with `If-None-Match: *` (412 = already stored = success). Observation segments: `obs/v1/{recorder}/{YYYY-MM-DD}/{HH}/{cycleStartUtc}-{cycleNo}.ndjson.gz`, flushed every `FLUSH_MS` when non-empty, and **always at least every `HEARTBEAT_MS`** (an empty segment means "alive, nothing changed", so a gap in segments means the recorder was down). A segment is written only after its blobs are stored. Unknown `kid`: fetch the JWK, store it under `meta/keys/`, page (§7.3) |
| `lease.ts` | `lease/recorder.json` `{holder, generation, expiresAt}`. Create with `If-None-Match: *`, renew or take over with `If-Match: <etag>`. TTL 30 s, renew every 10 s, `generation` on every observation. Losing the lease stops polling within one renewal period |
| `metrics.ts` | EMF JSON lines on stdout: `tse_requests_total{status,tier}`, `tse_last_success_age_s{class}`, `tse_pending_mun`, `tse_stuck_mun`, `sig_invalid_total`, `schema_failed_total`, `regressions_total`, `segments_written`, `lease_held` |
| `main.ts` | wiring, graceful SIGTERM (flush, release lease) |

State the recorder needs across restarts (last ETag / sha / `idg` per path, the last
accepted coverage version per file) is **rebuilt from its own raw log on start**: read the
newest segments back. It's never kept in a database. If that read fails, it starts empty,
which costs one capture's worth of conditional requests, mostly 304s.

### 2.3 `apps/fake-tse` v0

A small `node:http` server over `docs/research/samples/`:
- correct `Content-Type`, an `ETag` of MD5(body), `Cache-Control: max-age=N` counting down
  to a fixed `Expires`, `If-None-Match` → 304, gzip on request, 404 for anything else;
- a request log, so tests can assert politeness (no request for a path before its
  `Expires`, no query strings).

It never modifies a file. Staged reveal and withheld coverage rows (§15 Q2) are Phase 2.

### 2.4 Local S3: chosen by a conformance test, not by reputation

`packages/s3-conformance` (or a test file in the recorder) runs exactly the five calls the
recorder depends on:
1. `PutObject` with `If-None-Match: *` → 200;
2. the same again → **412**;
3. `PutObject` with `If-Match: <current etag>` → 200;
4. `If-Match: <stale etag>` → **412**;
5. `GetObject`/`ListObjectsV2` round-trip.

Candidates, in this order, all current on Docker Hub today:
- `rustfs/rustfs:1.0.1` (S3-compatible, Apache-2.0, 2026-10-03);
- LocalStack (`@testcontainers/localstack` 12.2.0);
- SeaweedFS.

**The first one that passes all five becomes the compose and testcontainers S3.** The same
suite then runs **once against the real `apuracao26-raw` bucket**, because Object Lock plus
conditional writes must be proven on real S3 too `[VERIFY: S3 conditional writes on an
Object Lock bucket. PutObject there may require Content-MD5 or a checksum header; the SDK
adds a CRC by default]`. If none passes, integration tests run against a scratch prefix in
real S3 (cents), and that gets recorded.

### 2.5 Infra (CDK): `RawStack` + `RecorderStack`

- **`RawStack`:** bucket **`apuracao26-raw-860897618882`** (the account id makes the global
  name unique; the architecture's `apuracao26-raw` may be taken). Settings:
  - sa-east-1, block all public access, SSE-S3, versioning;
  - **Object Lock, governance mode, 10-year default retention**;
  - `RemovalPolicy.RETAIN`;
  - lifecycle: `obs/` and `raw/` transition to Standard-IA after 30 days `[VERIFY: IA's
    128 KB minimum billable size makes it more expensive for 12 KB blobs. Likely skip IA,
    since the whole log is < 5 GB ≈ $0.12/month]`.
- **`RecorderStack`:**
  - a VPC with 2 public subnets, **no NAT**, and an S3 gateway endpoint;
  - an ECS cluster; Fargate **ARM64, 0.25 vCPU / 0.5 GB**, `desiredCount: 1`, public IP
    (to reach the TSE without a NAT, §10.4);
  - image from `ContainerImage.fromAsset` (built by `cdk deploy`; no ECR pipeline until
    CI deploys);
  - task role limited to `s3:GetObject/PutObject/ListBucket` on the raw bucket;
  - log group with 1-month retention;
  - circuit-breaker deployment.
- **One alarm now:** `segments_written` sum < 1 over 5 min → SNS → `ALERT_EMAIL`. That
  covers the recorder down, the lease lost, or S3 failing. The full alarm set comes in
  Phase 4.
- **Dockerfile** (`apps/recorder/Dockerfile`): `node:24-slim`, multi-stage, using
  `pnpm deploy --filter @apuracao/recorder --prod` `[VERIFY: pnpm 11 deploy flags for
  workspace packages]`, running as non-root.

### 2.6 Alternatives considered and rejected

- *A fixed 60 s poll clock:* rejected by the architecture already (§4.3). Per-file
  `Expires` halves staleness and never requests early.
- *Keeping recorder state in DynamoDB:* rejected. The raw log already has it, and a
  second store is a second truth.
- *Writing a segment per observation:* rejected. On the night that's ~47k tiny PUTs plus
  per-object overhead in the projector. 5 s batches add ≤ 5 s of latency in S3 mode only;
  the Kafka path sends immediately.
- *Polling the frozen 1st round at `Expires` for two weeks:* rejected as impolite for no
  information. 600 s still soaks the code path.
- *A separate `TASK-infra-raw-bucket.md`:* folded in here (one deliverable).
- *Kafka in Phase 1:* rejected. Raw-to-S3 is the invariant, and the broker is layered on in
  Phase 2 (plan §2.6).

## 3. Why

It's the only irreplaceable component: a missed night can't be re-recorded. Running it from
10-11 means two weeks of soak against the real TSE CDN, so failure modes show up before the
25th, and the 2nd round is discovered automatically whenever it appears.

Cost: Fargate ARM 0.25/0.5 ≈ $0.017/h (≈ $6.50 to 10-27) + public IPv4 ≈ $0.005/h + S3
cents + logs ≈ $1. Time: 10-08 → 10-11.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/recorder/src/*.ts` (+ tests), `Dockerfile`, `package.json` | new/edit | §2.2. Deps: `@apuracao/{contracts,tse}`, `@aws-sdk/client-s3`, `undici` |
| `apps/fake-tse/src/*.ts` (+ tests) | new/edit | §2.3 |
| `apps/recorder/test/s3-conformance.test.ts` | new | §2.4 |
| `infra/lib/{raw-stack,recorder-stack}.ts`, `infra/bin/infra.ts`, `infra/test/*` | new/edit | §2.5 |
| `infra/docker-compose.yml` | edit | add the chosen S3 emulator |
| `.env.example` | edit | `RECORDER_*`, `RATE_MAX`, `RAW_BUCKET`, `S3_ENDPOINT` (local only), `TSE_BASE_URL` (fake-tse in tests) |
| `docs/architecture.md` | edit | bucket name, segment flush/heartbeat, the 1st-round soak cadence, resolved `[VERIFY]`s |
| `docs/research/02-…` | edit | new facts seen against the live TSE (h2, ETag/MD5 on `.jws`, any 429) |
| `CLAUDE.md`, `README.md` | edit | status, the S3 emulator in the stack table, run commands |

## 5. Verification

**Local (before deploying):**
1. `pnpm turbo run lint check-types test build` is green, including:
   - `version.ts` unit tests for every row of §4.4. Inputs are derived from real samples:
     a real file, the same file with a different `idg` header string (re-serialised,
     signature then `invalid` by construction), the same bytes twice;
   - schedule/budget unit tests with a fake clock: never due before `Expires`; AIMD halves
     on 429 and recovers +10/30 s; the breaker opens at 21% and closes after 3 clean cycles.
2. **S3 conformance:** all 5 calls pass on the chosen emulator, and once on the real bucket.
3. **Integration (testcontainers: S3 emulator + fake-tse v0):**
   - a cold start fetches every sample path exactly once, stores every distinct blob once,
     and writes ≥ 1 segment whose observations parse as `Observation`;
   - a second pass gives **0 new blobs and 0 new `version` observations** (all 304:
     idempotency);
   - fake-tse's log shows **0 requests before a path's `Expires`** and **0 query strings**;
   - a restart rebuilds state from the log and makes no extra GET without `If-None-Match`;
   - two recorders on one bucket: exactly one polls. Killing it gives the other a lease
     with generation +1 within 30 s, and both segments' observations carry their own
     generation.

**Deployed (by Sun 10-11 23:59 BRT):**
4. `cdk deploy RawStack RecorderStack` succeeds; one task RUNNING.
5. The 1st-round capture: `aws s3 ls s3://apuracao26-raw-860897618882/raw/v1/sha256/
   --recursive | wc -l` ≈ 11.5k (the exact count goes in §6). CloudWatch
   `tse_requests_total` ≤ 10/s throughout. Zero `sig: invalid`, zero `schema: failed`, or
   each one explained.
6. The soak: 12 h after the capture, `tse_requests_total` averages ≤ 0.3 req/s, ≥ 95% of
   it 304s. A segment exists in every 60 s window (no gap > 60 s).
7. Lease takeover on AWS: start a 2nd task (`aws ecs run-task`), stop the 1st (`aws ecs
   stop-task`). A new generation appears in segments within 30 s, with no segment gap > 60 s.
   Then return to 1 task.
8. The alarm: stop the service (`desiredCount 0`) for 6 min, and the SNS email arrives.
   Restore.
9. AWS Cost Explorer on 10-12: ≤ $1 spent for 10-11.

## 6. Outcome and deviations (2026-10-08)

**Local verification (§5.1–5.3):** `pnpm turbo run lint check-types test build` 28/28.
The recorder has 26 unit tests and 7 integration tests (testcontainers RustFS + fake-tse v0,
stable over repeated runs): capture, idempotent second pass, politeness, restart, crash
takeover, and handover without duplicates. The S3 conformance suite passes on RustFS and on
the real bucket, including a governance-retention write.

**Deployed (§5.4–5.9):**

| Check | Result |
|---|---|
| 4. deploy | `RawStack` + `RecorderStack` deployed; 1 task RUNNING (ARM64, 0.25 vCPU / 0.5 GB) |
| 5. capture | **11,443** blobs = 11,443 expected paths (research 02 §9), all 200 with a valid `prod` signature; 10 req/s throughout; no 429/503; 03:26–03:47 UTC |
| 6. soak | 1st round at a 600 s minimum interval. Segment gaps ≤ 11 s through capture and two deploys. `[12 h figures: fill in on 10-08 evening]` |
| 7. takeover | Two real deploys. 2nd: old task stopped 03:55:48.59 (final snapshot 03:55:48.09); new task took generation 3 at 03:55:53.4 (**4.8 s**), restored that snapshot, and wrote **0 duplicate observations**. A crash takeover (no handover) is covered by the integration test (≤ TTL + renew) |
| 8. alarm | `apuracao26-recorder-silent` emails `ALERT_EMAIL` (subscription confirmed). Three stop tests: one 5-min period, missing = breaching → **16 min**; 2 × 2-min periods → **11.8 min**; 2 × 2-min periods over `FILL(m, 0)` → **4.9 min** (kept). CloudWatch is slow to treat *missing* data as breaching, so the alarm never sees missing data. The recorder was restored after each test and restored its shutdown snapshot each time (generations 4, 5, 6) |
| 9. cost | `[check Cost Explorer on 10-09]` |

**Findings and fixes along the way:**
- **Bug (caught by the politeness test):** activation and restarts could schedule a file
  before its `Expires`. Fixed in one place: every path's last `Expires` is a `notBefore`
  (persisted in the snapshot), and every scheduling call is clamped to it.
- **Bug (caught by the integration test):** accepted coverage data was re-validated with
  the input schema, failed silently, and no municipal file was ever fetched. Fixed.
- **Real TSE shape (research 02 §9):** files with no votes have `dt`/`ht` = `""` and no
  `cand.dvt`. 41 abroad cities, signed and valid, failed the schema. The contract now
  accepts both, and `zz29424` is a sample.
- **Duplicates on deploy:** the first deploy wrote 818 duplicate `version` observations
  (same sha), because the standby loaded the snapshot at process start, ~80 s before the
  handover. State now loads on each lease acquisition, and a leader never snapshots before
  loading. The second deploy wrote 0.
- **Commit hygiene:** `abeca3b` was committed with the infra suite failing (`cdk.out/`
  holds a staged copy of the repo, and Vitest ran its tests). Fixed in `c9a0c2d`, and
  commits are now gated on the pipeline's result.

**Deviations from the plan:**
- **Object Lock without default retention.** The recorder sets governance retention per
  object on `raw/` and `obs/`. A bucket default would have locked every lease renewal and
  snapshot (~140k object versions by the 25th) for 10 years.
- **State restore is from a snapshot** (`state/recorder/v1/snapshot.json.gz`, every 60 s
  and on shutdown), a projection of the log, rather than by replaying segments. A crash
  costs at most 60 s of re-fetching, recorded as duplicate `version` observations, which
  the projector already dedups by `(path, sha256)`.
- **Bucket name** `apuracao26-raw-860897618882` (the account id keeps it globally unique).
- **RustFS 1.0.1** is the local S3 (the first candidate to pass conformance).
- **The image is built by `cdk deploy`** (`ContainerImage.fromAsset`, `pnpm deploy
  --legacy`). There's no CI deploy yet, because there's no GitHub remote.
- **HTTP/2** is requested via undici `allowH2`. Whether Akamai negotiates it is not yet
  observed.


# TASK — Implementation plan (build order to 2026-10-25)

## 1. Current scenario

Research and architecture are done; no code exists. `docs/architecture.md` (2026-10-07)
defines the system: recorder ×2 → S3 raw log (+ MSK Kafka, on the user's choice) →
projector ×2 → immutable views on S3/CloudFront → a static Next.js dashboard. Facts it rests
on are in `docs/research/01-…` and `02-…`. The 2nd-round files (`6258`/`6260`) are still
404 and there is no TSE test environment, so everything before the 25th is tested against
real 1st-round files through our own fake TSE.

Today is **Wednesday 2026-10-07**. There are **18 days** to the 2nd round.

## 2. Planned changes

### 2.1 The must-have cut (if only this ships, the 25th is a success)

1. **Recording:** the recorder captures every version of every `6258`/`6260` file into the
   immutable S3 raw log, signature-checked, with a standby. It is *the* irreplaceable part,
   because a missed night can't be re-recorded. It ships first and runs longest.
2. **A live president map:** national headline (leader, %, votes, gap, sections counted),
   the municipality choropleth with its table alternative, the UF breakdown, the
   missing/zero/failed states, and the always-visible "last updated", served from
   CloudFront.
3. **Operability:** the alarms that page, the canary, the pointer rollback, and the runbook.

### 2.2 Should-have (built in this order once the must-have is green)

4. Turnout, abstention, blank/null panel (the data is already in the national view).
5. Timeline chart ("ao longo da apuração") + **scrubber** (replay by `seq`).
6. Updates feed.
7. Governor views for AC, AM, DF, ES, RJ, RN, TO (recorded regardless, from day one).

### 2.3 Nice-to-have (only if time remains, else after the 25th)

8. "Verify this number": the public `.jws` mirror + in-browser signature check.
9. Map delta packs for smooth scrubber animation.
10. Off-cloud third recorder on the user's machine.

Everything in `architecture.md` §12 (learning lab) and §13 (bulk ballot-box data) is
**after** 2026-10-26.

### 2.4 Phases and dates

Each phase starts with its own `docs/tasks/TASK-<slug>.md` (CLAUDE.md §1) and ends with
docs updated and a commit. Dates are the day a phase must be *done*.

| # | Phase | Window | Done when | Task doc |
|---|---|---|---|---|
| 0 | **Foundations** | Wed 10-07 → **Thu 10-08** | user signs off architecture + open questions; `aws login` works; `pnpm dlx create-turbo@latest` scaffold (`apps/`, `packages/`, `infra/`); CDK bootstrapped in sa-east-1; `packages/contracts` + `packages/tse` (URL builders, string-number parsing, `.jws` Ed25519 verification) passing on every sample | `TASK-scaffold-monorepo.md`, `TASK-contracts-and-tse-parsing.md` |
| 1 | **Recorder (must-have 1)** | Thu 10-08 → **Sun 10-11** | the recorder (per-file `Expires` scheduling, 100 req/s token bucket, AIMD, breaker, S3 content-addressed writes, per-cycle obs segments, S3 lease) is deployed to Fargate as **one** small task (0.25 vCPU / 0.5 GB; lease takeover is tested by starting a 2nd task briefly); the full 1st-round capture (~12k files at 10 req/s) is in the raw log; the recorder is soaking against the real TSE (all 304s) and auto-discovering `6258`/`6260` | `TASK-recorder.md`, `TASK-infra-raw-bucket.md` |
| 2 | **Log, projector, publishing** | Fri 10-09 → **Thu 10-15** | Kafka path built and tested on **local Redpanda** (no AWS cost); MSK defined in CDK behind the `night=on\|off` switch and **smoke-tested on 10-15 for a few hours, then deleted**; the recorder produces to `tse.observations.v1`; `packages/views` (pure fold/render); the projector with checkpoints, S3 lease, forward-only conditional pointer, and the **S3 fallback mode (= rebuild)**; the public bucket + CloudFront (OAC, Origin Shield, cache policies, error TTL 0) serving pointer/manifests/views; `apps/fake-tse` v1 (TSE semantics + staged reveal at ×20); the primary projector runs on Fargate in S3 mode from 10-18 | `TASK-kafka-log.md`, `TASK-projector-and-views.md`, `TASK-public-cdn.md`, `TASK-fake-tse.md` |
| 3 | **Web must-have (must-have 2)** | Mon 10-12 → **Sun 10-18** | Next.js 16 static export on the same distribution; headline; Canvas 2D map (pre-projected IBGE 2025 TopoJSON, ~330 KB gzip) with the table alternative; UF breakdown; status states; "last updated"; Umami; WCAG 2.2 AA review | `TASK-web-shell-and-data-hooks.md`, `TASK-map.md` |
| 4 | **Hardening (must-have 3)** | Fri 10-16 → **Wed 10-21** | integration (testcontainers Redpanda + MinIO), idempotency and replay-equals-live tests; chaos runs; k6 CDN load test (3 runs, medians); Playwright map perf (5 runs, medians); EMF metrics, canary Lambdas, alarms → SNS email/SMS, Budget alarm at $60; full runbook | `TASK-tests-and-chaos.md`, `TASK-observability.md`, `TASK-runbook.md` |
| 5 | **Should-haves** | Sat 10-17 → **Wed 10-21** (only after the 10-16 gate) | turnout panel → timeline + scrubber → feed → governor views, in that order; anything unfinished by 10-21 is cut | one task doc each |
| 6 | **Dress rehearsal** | **Thu 10-22** | `night=on` at 08:00 (MSK + standbys created from scratch, which also rehearses Saturday's switch-on); full accelerated replay on production AWS under a `staging` epoch, alarms firing to the phone, runbook steps exercised (kill recorder, kill a broker, pointer rollback) | `TASK-dress-rehearsal.md` |
| 7 | **Freeze + pre-flight** | Fri 10-23 23:59 freeze → Sat 10-24 | `night=off` after the rehearsal on 10-22 23:00; **`night=on` again Sat 10-24 12:00** (MSK + standbys), projector switched to Kafka mode; "not started" pointer published; 2nd-round files captured into `docs/research/samples/` if they appeared | — |
| 8 | **Election night** | **Sun 10-25** | recording from first file appearance; watch from 16:30 BRT until every file is final; recording continues to Mon 10-26 12:00 BRT | runbook |
| 9 | **Afterwards** | Mon 10-26 → Sat 11-01 | **`night=off` Mon 10-26 12:00** (MSK + standbys deleted); primary recorder and projector stopped Tue 10-27 once the final state is confirmed (buckets and CloudFront stay, at cents/month); export, write-up, cost check against the Budget; lab and bulk seam planning | `TASK-post-election.md` |

From **Tue 10-20**, every day: check whether `6258`/`6260` exist. The recorder discovers
them automatically, but the first real files must be captured into
`docs/research/samples/` and the `[VERIFY]` in `architecture.md` §4.1 resolved the same
day.

### 2.5 Gates (decided now, so they aren't argued at midnight)

- **10-11, recorder gate:** if the recorder isn't recording 1st-round files unattended on
  Fargate by Sunday night, everything else pauses until it does.
- **10-16, broker gate:** if the Kafka path (recorder → Kafka → projector) doesn't pass the
  integration and replay tests on local Redpanda, or the 10-15 MSK smoke test failed, by
  Friday 10-16, **election night runs the projector in S3
  mode** (already built as the fallback), and Kafka runs only as a passive extra consumer.
  The learning goal survives; the night doesn't depend on it.
- **10-21, scope gate:** whatever should-have is unfinished is cut. No feature work after
  10-21.
- **10-22, rehearsal gate:** any failed rehearsal step is fixed or turned into a runbook
  workaround before the freeze.

### 2.6 Alternatives considered for the build order

- *Web first, ingestion later:* rejected. A late recorder loses history permanently, while a
  late UI can still show a replay afterwards.
- *Kafka from day one, before the recorder writes to S3:* rejected. Raw-to-S3 is the
  invariant and must exist independently. The broker is layered on in Phase 2.
- *Build the scrubber before the map:* rejected. The user's must-have cut is "live president
  map plus recording".

## 3. Why

The date can't move. The order is set by what can't be recovered: a missed recording is
gone forever, a missing chart is not. Recording runs for two weeks before the night, so its
failure modes show up against the real TSE, not on the night. The broker gate keeps the
user's learning choice from becoming a single point of failure. Costs follow one rule:
nothing runs before it has a job, so MSK and the standbys exist only ~67 hours in total
(smoke test, rehearsal, night). Total ≈ $40 plus $0–15 of CloudFront with the caps in
`architecture.md` §11; Kafka's share of that is ~$15.

## 4. Affected files

Planned layout (each item is created by its phase's task doc, using the official
generators where one exists):

| File / dir | Change type | Notes |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json` | new | from `pnpm dlx create-turbo@latest` |
| `packages/contracts/` | new | Zod 4 schemas: TSE input shapes, `Observation`, published views (`architecture.md` §8) |
| `packages/tse/` | new | URL builders, string-number parsing, `.jws` verification, pinned `keys/prod.jwk.json` |
| `packages/views/` | new | pure `fold`/`render`, shared by the projector, rebuild and tests |
| `packages/config/` | new | shared tsconfig/eslint/prettier |
| `apps/recorder/` | new | poll scheduler, budget, S3 writes, lease, Kafka producer |
| `apps/projector/` | new | Kafka/S3 sources, checkpoints, publishing, pointer |
| `apps/fake-tse/` | new | replay harness with TSE HTTP semantics |
| `apps/web/` | new | `pnpm create next-app@latest`, static export, shadcn/ui, TanStack Query |
| `infra/` | new | AWS CDK app (`cdk init app --language typescript`) + `docker-compose.yml` (Redpanda, MinIO) for local runs |
| `scripts/` | new | `capture-first-round`, `ops pointer:set`, k6 scenarios, Playwright perf |
| `.env.example` | new | every variable the code reads |
| `docs/research/samples/` | edit | 2nd-round files when they appear |
| `CLAUDE.md`, `README.md` | edit | stack/status per phase |

## 5. Verification

Per phase, the exact proof (each phase's own task doc refines it):

| Phase | Command / observation |
|---|---|
| 0 | `pnpm turbo run lint typecheck test` green; the `packages/tse` test verifies all four captured `.jws` and rejects a one-byte-flipped copy; the contracts parse every file in `docs/research/samples/` |
| 1 | after the first week, AWS Cost Explorer shows ≤ $5 spent; `aws s3 ls s3://apuracao26-raw/raw/v1/sha256/ --recursive \| wc -l` ≈ 12k after the capture; CloudWatch shows `tse_requests_total` ≤ 100/s and no request before `Expires`; killing the lease holder (`aws ecs stop-task`) → new lease generation in ≤ 30 s, no gap in obs segments |
| 2 | the replay at ×20 through fake-tse: zero lost versions; publish lag p95 ≤ 15 s; `rebuild --source s3` ≤ 5 min and byte-identical to live; pointer reachable at `https://dXXXX.cloudfront.net/data/v1/latest.json` with the expected headers |
| 3 | Playwright: map first draw ≤ 50 ms, recolour ≤ 16 ms (4× throttle, median of 5); axe-core zero violations; every result reachable by keyboard via the table |
| 4 | k6 at 5,000 viewers × 3 runs: edge p95 ≤ 150 ms, hit ratio ≥ 99% on `/data/v1/o/*`, origin ≤ 2 req/s; each chaos scenario in `architecture.md` §9.2 passes; a test alarm reaches the phone |
| 6 | rehearsal checklist signed off in `TASK-dress-rehearsal.md` |
| 8 | after the night: the obs segments cover 17:00–final with no gap longer than 3 min (or each gap is explained); the final national view equals the TSE's final `br-c0001-e006258-u` byte for byte (from its sha256) |

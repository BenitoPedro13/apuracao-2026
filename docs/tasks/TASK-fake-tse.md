# TASK: fake-tse v1, staged reveal (Phase 2)

Phase 2 of `TASK-implementation-plan.md` (done by Thu 2026-10-15). `architecture.md` §9.2
items 2–4. It's the harness every later proof runs on: Kafka's integration and replay tests
(`TASK-kafka-log.md`), Phase 2's "replay at ×20, zero lost versions, publish lag p95 ≤ 15 s",
the chaos runs (Phase 4) and the dress rehearsal (10-22).

## 1. Current scenario

`apps/fake-tse` v0 (`TASK-recorder.md` §2.3) serves the 21 files in
`docs/research/samples/` with TSE HTTP semantics: a per-file `Expires` that `max-age`
counts down to, `ETag` = MD5, `If-None-Match` → 304, gzip, and 404 for anything else. Every
file is served in its final state from the first second. Missing:

- **The full 1st round.** The recorder captured all 11,443 files into
  `apuracao26-raw-860897618882` (research 02 §9), but they aren't on disk. The 21 samples
  trigger only one municipality.
- **Time.** Nothing appears or changes, so a recorder sees one version per file and the
  projector one publish. Nothing exercises tier 1 → tier 2, pending files, the debounce, or
  publish lag.
- **Faults:** latency, 429/503/timeouts, regressions, corrupted signatures.

Facts this rests on:
- Each UF `-ab` file has one row per municipality with its own `dt`/`ht` (for the 1st round,
  the instant that municipality was totalized). The br `-ab` file has one row per UF with
  `munf`/`munpt`/`munnr` (samples, research 01 §4).
- We hold **one** version per file: the final one. Aggregate `-u` files (br, UF, zz) have
  no intermediate versions to replay.
- The recorder only fetches municipal `-u` files when a coverage file it **accepted**
  (valid signature and schema) shows a changed row (`apps/recorder/src/recorder.ts`,
  tier 1 → tier 2).

## 2. Planned changes

### 2.1 `scripts/export-capture.ts`: the capture on disk

Read-only on the raw bucket. For every 1st-round path, take the highest-`idg` valid version
from the observation log (the projector's acceptance rule, imported from
`packages/views`) and write its `.jws` to `.capture/ele2026-1t/<path with / → _>`, the
`samples/` naming. `.capture/` is gitignored: ~600 MB of TSE files don't belong in git,
and the raw bucket stays the source. Prints file counts per group, which must equal research
02 §9 (11,443).

### 2.2 Staged reveal (`apps/fake-tse/src/reveal.ts`)

A pure function `snapshot(capture, tReal) → Map<path, bytes>`: what the TSE was serving at
real instant `tReal` (Brasília time on 2026-10-04), given only final files.

- **Municipal `-u` files** appear at their **row's `dt/ht` in their UF's `-ab`** (the
  instant the TSE said that municipality was totalized), byte-identical, with the TSE's
  signature. 404 before. *Changed while building:* the plan said "at their own `ht`, which
  equals the row", but it doesn't always: `sp71072`'s final file says 05/10 12:51:05 (a
  re-totalization the next day) while its row says 04/10 21:50:33. A file with no row instant
  (the 41 abroad cities with no votes) appears with its coverage file's final version.
- **Aggregate `-u` files** (br, UF, zz) appear at their own final `dt/ht` (`dg/hg` when
  empty), byte-identical. So the national headline is `not_published` until the end of the
  replay. That's the truth about what we hold; **nothing is interpolated** (invariant 1).
- **Coverage `-ab` files** are rebuilt at each reveal step from the final file: rows with
  `ht ≤ tReal` are kept verbatim, later rows are **removed**, not zeroed (a zero would be an
  invented number). Served from the replay's start (with no rows at first). The header's
  `dg`/`hg` become the instant of the latest revealed row (not `tReal`: the bytes must stay
  the same between reveals, or every poll would be a new version); `idg` becomes
  `finalIdg − 1_000_000 + step`, so it increases per step and stays below the real final
  `idg`, which is served unmodified once `tReal ≥` the file's own `hg`.
  *Changed while building:* the br `-ab` follows the same rule (a UF row appears verbatim at
  its own `ht`, i.e. when that UF is complete). The plan said to recompute `munf/munpt/munnr`
  per UF, but the same row also carries `pmunf/pmunpt/pmunnr` and the UF's `s`/`e` totals,
  and the 1st-round files can't tell partial from not started: a recomputed `munpt = 0`
  would be a number the TSE never published, inside a row that otherwise claims to be real.
- **Signing:** rebuilt coverage files can't carry the TSE's signature. fake-tse generates an
  **ephemeral Ed25519 test key** at start (`kid` `fake-tse-<random>`), signs them with it,
  and serves its public JWK at `/oficial/app/assets/assinatura-jws/test.jwk.json`. Real
  files keep the TSE's `prod` signature.
- **Trusting the test key:** the recorder and the projector get `TSE_TEST_JWK_URL`. They
  fetch that JWK at start and add it to the key ring. Both **refuse to start** if it's set
  while `RAW_BUCKET` is `apuracao26-raw-860897618882`, so a test-signed file can never reach
  the production log (the condition of the user's approval, `architecture.md` §9.2).

Clock: `tReal = replayStart + (now − startedAt) × speed`, default `replayStart` 2026-10-04
17:00 BRT (polls close) and `speed` 20 (17:00 → 01:00 in 24 min). `POST /_control/clock`
sets `speed`, pauses, or jumps to an instant, for tests. *Added while building:* a quiet
stretch between consecutive events longer than 10 replay minutes is cut to 10 minutes
(`--max-gap-min`). Without it the replay would end at 01:00 and never reach MA's last
municipality (01:56), the abroad aggregate (09:19) or the final br files (12:51 the next
day), which the "final views equal the real log" check needs. `GET /_control/state` and
`GET /_control/log?from=n` let an out-of-process harness follow the replay.

### 2.3 TSE semantics kept from v0

`Expires`/`max-age`, `ETag`, 304, gzip, the request log with `early`. A file's ETag changes
whenever its served bytes change. The edge window (`maxAgeSeconds`) is in **replay** seconds
divided by `speed`, so at ×20 the 60 s TSE window is 3 s of wall time (rounded to whole
seconds, like `Expires` itself: a sub-second phase truncates to an earlier header and makes
a polite client look early). Like the real edge, a window serves what the origin had when
it opened. A 404 carries `max-age` and no `Expires`, as in v0
`[VERIFY: the TSE edge's 404 headers on the night]`. The log adds `sha256`, the reveal
`version` (`final`, `step-k`, `+badsig`) and `tReal` to each entry. Without `reveal`,
fake-tse behaves exactly as v0 (the recorder's and projector's integration tests use that).

### 2.4 Faults (`apps/fake-tse/src/faults.ts`)

Configured at start or via `POST /_control/faults`, all seeded (reproducible):

| Fault | Parameter | Effect |
|---|---|---|
| latency | p50, p99 (default 80 ms, 2 s) | log-normal delay before responding |
| errors | rate of 429 / 503 / timeout (hang 30 s) | per request, `Retry-After` on 429 |
| regression | a path list | serve the previous reveal step's bytes again (lower `idg`) |
| bad signature | a path list | flip one byte inside the signature |

### 2.5 Harness (`apps/fake-tse/src/main.ts`, `scripts/replay.ts`)

`node apps/fake-tse/dist/main.js --capture .capture/ele2026-1t --speed 20 --port 8080` runs
the server (`--static` for v0, `--faults '<json>'`). `scripts/replay.ts` runs a whole replay
locally (docker compose RustFS, then fake-tse, recorder and projector **each as its own
process**, as in production), waits for the replay to end and the pipeline to go quiet,
runs `projector rebuild` on the same raw log, then prints the §9.2 numbers: lost versions,
early requests, peak rate, publish lag p50/p95, rebuild = live, and (with `--real <dir>`)
the national view against the real-log rebuild. Only the recorder's TSE-facing timings are
divided by the speed (probe and absent retries, jitter); the pipeline's own (flush 5 s, tail
2 s, debounce 2–10 s) stay at production values, so publish lag is in wall seconds under
20× the night's event rate. `scripts/` became a workspace package so both scripts are
type-checked and linted.

### 2.6 Alternatives considered and rejected

- *Zeroed future rows instead of removed rows:* rejected. A zero is a number the TSE never
  published for that moment.
- *Interpolated intermediate versions of aggregate files:* rejected, invariant 1.
- *Leaving rebuilt coverage files unsigned and running the recorder without signature
  checks:* rejected. It would test a code path production never runs, and an "accept
  invalid" flag is one misconfiguration away from the production log.
- *Committing the capture to git:* rejected (~600 MB). The raw bucket is the source, and the
  export script is reproducible.
- *Serving the capture from S3 instead of disk:* rejected. The harness must run offline and
  in CI-like conditions without AWS credentials once exported.

## 3. Why

Without time, none of the night's behaviour can be tested before the night: tier-2
triggering, pending files, the burst of thousands of municipal files, debounce and publish
lag, broker failover. This turns the 1st round's real files into a 24-minute rehearsal.
Cost: ~1.5 days. AWS: one export of ~11.4k GETs ≈ $0.005.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `scripts/export-capture.ts` | new | §2.1 |
| `scripts/replay.ts` | new | §2.5 |
| `scripts/{package,tsconfig}.json`, `scripts/eslint.config.js`, `pnpm-workspace.yaml` | new/edit | `scripts/` is a workspace package (type-checked, linted) |
| `.gitignore` | edit | `.capture/`, `.replay/` |
| `apps/fake-tse/src/{reveal,faults,sign,server,main,index}.ts` (+ `reveal.test.ts`, `replay.test.ts`) | new/edit | §2.2–2.5 |
| `apps/fake-tse/package.json` | edit | depends on `@apuracao/tse`, `@apuracao/contracts` |
| `packages/s3kit/src/production.ts` | new | `refuseTestKeyInProduction`: raw **and** public production buckets |
| `packages/tse/src/jws.ts` | edit | `fetchJwk` |
| `apps/recorder/src/config.ts`, `recorder.ts` (+ test) | edit | `TSE_TEST_JWK_URL`, refused on the production bucket, never persisted to `meta/keys/` |
| `apps/projector/src/config.ts`, `projector.ts` (+ test) | edit | the same; also refused with `PUB_BUCKET=apuracao26-pub` |
| `apps/projector/package.json`, `src/index.ts` | edit | `exports`, and `blobKey`/`BlobReader`/`mapLimit` exported for the scripts |
| `.env.example`, `README.md`, `docs/architecture.md` §9.2, `docs/research/02-…` §9 | edit | variables, how to run a replay, the `idg` rule, the `-u` vs row instant finding |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green, with:
   - `reveal` unit tests on the samples: before a municipality's `ht` its `-u` is absent;
     after, it's byte-identical to the sample. A rebuilt `-ab` has exactly the rows with
     `ht ≤ tReal`, each byte-identical as JSON to the final file's row; its `idg` increases
     per step and stays below the final `idg`; at the end the served `-ab` is the original
     file byte for byte.
   - The rebuilt file verifies with the test key and **fails** with the TSE key.
   - The recorder and the projector exit non-zero with `TSE_TEST_JWK_URL` set and
     `RAW_BUCKET=apuracao26-raw-860897618882`.
2. `export-capture` writes 11,443 files; `parseTseFile` + `verifyJws` pass on all.
3. **A full ×20 replay** (`scripts/replay.ts`, ~24 min), 3 runs, medians:
   - zero lost versions: every `(path, sha256)` fake-tse served with status 200 is in the
     raw log;
   - 0 requests before `Expires`, peak ≤ 100 req/s;
   - the final views equal `projector rebuild` on the same raw log, byte for byte, and the
     final national view equals the one from the real log (`TASK-projector-and-views.md`
     §5 item 3);
   - publish lag (observation `fetchedAt` → pointer `refreshedAt` naming that `seq`) p95
     ≤ 15 s.

## 6. Outcome (2026-10-08)

1. **Done.** `pnpm turbo run lint check-types test build`: 34/34 tasks green. fake-tse has
   20 tests on the real samples (`reveal.test.ts`, `replay.test.ts`, `server.test.ts`):
   absent before the row instant and byte-identical after; rebuilt `-ab` rows exactly
   `ht ≤ tReal` and verbatim (277 SP rows at 19:00:00); `idg` per step below the final; the
   original file from its own `hg`; test key valid, TSE key `invalid`; 429 + `Retry-After`,
   regression to `idg − 1`, corrupted signature; clock pause/jump/done. The recorder and
   projector refuse `TSE_TEST_JWK_URL` with `apuracao26-raw-860897618882` (and the projector
   with `PUB_BUCKET=apuracao26-pub`), tested on `loadConfig`, which `main.js` calls at start.
   The recorder's and projector's integration tests (fake-tse without `reveal`) still pass.
   - Found while building: a sub-second `Expires` phase made the polite recorder look early
     (the header truncates to the second). Phases and windows are whole seconds now.
2. **Pending: `aws login` has expired.** `node scripts/export-capture.ts` is written and
   type-checked, not yet run.
3. **Smoke only so far.** On the 21 samples at ×200 (`--capture docs/research/samples
   --speed 200`, 2.4 min, 1 run): 0 lost versions, 0 early requests, 0 query strings, peak
   166 req/s in one second (burst allowance 200), busiest 60 s 99.4 req/s, publish lag p50
   6.7 s / p95 8.4 s, rebuild = live on every view. The full ×20 replay on the export, 3
   runs with medians, and the national view against the real-log rebuild
   (`TASK-projector-and-views.md` §5 item 3, also waiting on `aws login`) are pending.

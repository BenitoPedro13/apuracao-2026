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

- **Municipal `-u` files** appear at their own `ht` (the `dt`/`ht` of the file, which equals
  its row in the UF `-ab`), byte-identical, with the TSE's signature. 404 before.
- **Aggregate `-u` files** (br, UF, zz) appear at their own final `ht`, byte-identical. So
  the national headline is `not_published` until the end of the replay. That's the truth
  about what we hold; **nothing is interpolated** (invariant 1).
- **Coverage `-ab` files** are rebuilt at each reveal step from the final file: rows with
  `ht ≤ tReal` are kept verbatim, later rows are **removed**, not zeroed (a zero would be an
  invented number). The header's `dg`/`hg` become `tReal`; `idg` becomes
  `finalIdg − 1_000_000 + step`, so it increases per step and stays below the real final
  `idg`, which is served unmodified once `tReal ≥` the file's own `hg`. The br `-ab`'s
  `munf/munpt/munnr` are recomputed by counting the revealed rows of each UF, and the
  municipality rows' `s`/`e` blocks are left verbatim.
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
sets `speed` or pauses, for tests.

### 2.3 TSE semantics kept from v0

`Expires`/`max-age`, `ETag`, 304, gzip, the request log with `early`. A file's ETag changes
whenever its served bytes change. The edge window (`maxAgeSeconds`) is in **replay** seconds
divided by `speed`, so at ×20 the 60 s TSE window is 3 s of wall time.

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
the server. `scripts/replay.ts` runs a whole replay locally (docker compose RustFS, fake-tse,
recorder, projector to a directory), then prints the §9.2 numbers: lost versions, early
requests, peak rate, publish lag p50/p95.

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
| `.gitignore` | edit | `.capture/` |
| `apps/fake-tse/src/{reveal,faults,sign,server,main}.ts` (+ tests) | new/edit | §2.2–2.5 |
| `apps/recorder/src/config.ts`, `recorder.ts` | edit | `TSE_TEST_JWK_URL`, refused on the production bucket |
| `apps/projector/src/config.ts`, `projector.ts` | edit | the same |
| `scripts/replay.ts` | new | §2.5 |
| `.env.example`, `README.md`, `docs/architecture.md` §9.2 | edit | variables, how to run a replay, the `idg` rule for rebuilt files |

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

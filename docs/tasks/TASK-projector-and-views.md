# TASK: Projector and views (Phase 2, part 1)

Phase 2 of `TASK-implementation-plan.md` (Phase 2 must be done by Thu 2026-10-15). This part
turns the raw log into the published views, in **S3 mode** (reading observation segments
straight from the raw bucket). That's the mode the night can't do without (gate 10-16:
Kafka may only be added on top). The Kafka source is `TASK-kafka-log.md`; the public
bucket + CloudFront + the projector's deploy are `TASK-public-cdn.md`.

## 1. Current scenario

The recorder is live (`TASK-recorder.md` §6). `apuracao26-raw-860897618882` holds 11,443
signed 1st-round files and their observations, and gains the 2nd round when it appears.
Nothing reads the log: `packages/views` and `apps/projector` are empty shells, and the
published view contracts don't exist yet (`TASK-contracts-and-tse-parsing.md` §2.2 deferred
them to here).

Facts this rests on (from the samples and the capture):
- Every result file is a full snapshot. A version is accepted by highest `idg` per path
  (`architecture.md` §4.4).
- The TSE's `cand.seq` is **the same in every file** (Flávio = 1, Lula = 2 even in São
  Paulo, where Lula leads), so it's a stable candidate order. The local leader is computed
  from `vap`.
- Percentages are the TSE's strings, over `vvc` (research 02 §8). Files with no votes have
  `dt`/`ht` = null and no `dvt` (research 02 §9).
- Municipality TSE code → IBGE `cdi` comes from the `-cm` index (5,571 domestic, all
  distinct).

## 2. Planned changes

### 2.1 View contracts (`packages/contracts/src/views/`)

All views carry `v: 1`, `kind`, `sources: sha256[]` (the `.jws` they came from)
and a `status` (§7.2: `not_published | no_sections | counting | final | fetch_failed`). A
missing value is `null` with a status saying why, never `0` (invariant 6). Counts are
integers. Percentages are `{ raw: "47,03" }` TSE strings, and anything we compute is a
separate field named `…Calc` (ADR-12).

| View | Content |
|---|---|
| `ResultView` (national, per UF, abroad; per office) | status; TSE `generatedAt`/`totalizedAt`/`idg`; sections `{total, counted, pct}`; electorate `{total, turnout, turnoutPct, abstention, abstentionPct}`; votes `{total, valid, validWithSubJudice (vvc), blank, blankPct, null, nullPct, subJudice}`; `candidates[]` in TSE `seq` order: `{n, name, party, votes, pct, elected, situation}`; for UFs, municipalities `{final, partial, notStarted}` from the `br-…-ab` row |
| `RegionsView` | the 5 IBGE regions as **our sums** of UF files (labelled computed), with percentages over `vvc`, plus the UFs each sum covers and their statuses |
| `MapView` | columnar over the 5,571 municipalities **in ascending `cdi` order**: `cdi[]` (via `MapIndexView`, §2.4; the geometry built in `TASK-map.md` uses the same order), `leader[]` (candidate index or -1), `marginBpCalc[]`, `countedBp[]`, `status[]` (codes). Nulls for missing, never 0 |
| `MunicipalityView` (per UF) | the rows of the table alternative to the map (invariant 7): name, `cdi`, status, sections, candidates' votes and TSE %. ~645 rows for SP |
| `Manifest` | `{v, epoch, seq, publishedAt (from the newest observation), views: {name: sha256}}` |
| `LatestPointer` | as `architecture.md` §6.2: `{epoch, seq, manifest, publishedAt, tse, health, pollSeconds}` |

**Deferred** (rebuildable from the raw log at any time, so they don't block recording):
`TimelineChunk` (should-have #5) and `FeedChunk` (#6).

### 2.2 `packages/views`: pure fold and render

- `fold(state, input)` takes one observation plus its **re-verified, re-parsed** blob. The
  projector re-checks signature and schema with the *current* contracts, so the 41 files
  recorded as `schema: failed` before the zero-vote fix (research 02 §9) project
  correctly.
- Acceptance per path: highest `idg` among valid + schema-ok versions. A tie on `idg` with
  different bytes keeps the version with the earliest `fetchedAt`. `error`/`absent`
  observations set `fetch_failed`/`not_published` while keeping the last good version.
- `render(state, {epoch, seq})` → `Map<name, bytes>`: **canonical JSON** (sorted keys,
  no wall clock, no randomness), so the same state gives byte-identical bytes.
- **Order independence:** current-state views depend only on the set of accepted versions,
  not the order they arrived in. That makes a rebuild equal the live projection whatever
  order segments are listed in, and it's tested as a property (§5).
- Status derivation (§7.2): no accepted version → `not_published`; `s.st = 0` →
  `no_sections`; `st < ts` → `counting`; `st = ts` and `tf = "s"` → `final`; latest
  observation `error` → `fetch_failed` (with the last good numbers).
  `[VERIFY: tf/and values during a live count, on the first 2nd-round files]`.
- Reconciliation (§7.4) as a pure function: the identities of research 02 §8 per file; Σ
  municipalities vs UF and Σ UFs + zz vs br, only between equal `dt/ht`. It returns drift
  metrics and never blocks.
- Election config: `{president: '6257' | '6258', governor: '6259' | '6260'}`. Development
  and tests run on the real 1st round (12 president candidates); the night runs on
  `6258`/`6260` (2 candidates). Nothing assumes 2 candidates.

### 2.3 `apps/projector` (S3 mode)

- **Source:** list `obs/v1/` segments. Process them in key order per recorder, and merge
  recorders by `cycleStart`. Track the last key read per recorder, so a live tail only
  reads new segments (one `ListObjectsV2` per 2 s with `StartAfter`). Drop duplicate
  `(path, sha256)` pairs.
- **Blobs:** GET by sha256 from the raw bucket, 32 in parallel, LRU cache of 200 MB.
- **`seq`:** in S3 mode, the count of distinct accepted inputs folded in this epoch.
  Epoch 1 is `s3-1`; the Kafka mode gets its own epoch in `TASK-kafka-log.md`.
- **Publish:** debounce (2 s quiet or 10 s max). Then objects first
  (`/data/v1/o/{sha256}.json`, `If-None-Match: *`), then the manifest, then the pointer.
  The pointer write is conditional (`If-Match`) and **forward-only** in `(epoch, seq)`.
- **Checkpoint** (state + last segment key per recorder) every 50 publishes and on
  shutdown, at `checkpoints/projector/{epoch}/…` in the raw bucket.
- **Lease:** `lease/projector.json`, the recorder's lease, moved into a shared
  `packages/s3kit` (Lease + write-once put) that both apps import.
- **CLI:** `projector rebuild --source s3 --epoch <e> [--out s3://bucket | dir]` folds the
  whole log once, publishes the final state, and prints timings.
- **Not here:** the deploy, the public bucket and CloudFront (`TASK-public-cdn.md`).
  Until then it publishes to a local RustFS bucket or a directory.

### 2.4 Amendments made while building (2026-10-08)

Found when reading the code this builds on. Each replaces the text above where they differ.

1. **Views don't carry `epoch`/`seq`.** A view that contains its `seq` changes on every
   publish, so its sha256 changes and content addressing (`architecture.md` §6.1 item 1:
   "unchanged views keep their URL") never works. Views carry `v`, `kind` and `sources`;
   only the `Manifest` carries `epoch`/`seq`. Same state → same view bytes → same URL.
2. **`MapView` carries no `cdi[]`.** Sending 5,571 codes in every map frame costs ~15 KB
   gzipped per publish. A separate `MapIndexView` (`cdi[]`, `name[]`, `uf[]`, ascending
   `cdi`) changes only when the `-cm` index does, so browsers fetch it once. `MapView`
   pins it by `index: sha256` of the joined `cdi` list, plus `count`.
3. **Computed values are named `…Calc`** (ADR-12), so `MapView.marginBp` is
   `marginBpCalc`: (leader − runner-up) / `vvc` in basis points, from integers.
   `countedBp` is the TSE's own `pst` string read as basis points ("47,03" → 4703), not a
   computation. Regions use `pctBpCalc`.
4. **`leader = -1`** means no single leader: no votes, a tie, or no data. `status`
   says which: `marginBpCalc` is `0` for a tie with votes and `null` without votes or data.
5. **`seq` counts folds that changed the state** (a new accepted version, or a path's
   health changing), not only accepted versions, since `fetch_failed` changes views too.
6. **Fetch health is order-independent.** Per path, the observation with the greatest
   `(fetchedAt, recorder, cycleNo, seqInCycle)` decides: `error` → `fetch_failed` (with
   the last good numbers), `absent` → `not_published` (numbers `null`: the TSE withdrew
   the file), `version`/`recovered` → healthy.
7. **The S3 tail looks back 10 min.** The recorder's `flush()` runs on a `setInterval`
   without awaiting the previous one, so a slow segment PUT can land after a later key.
   `StartAfter = lastKey` would skip it forever. The tail lists from 10 min before the
   newest key it has seen and skips keys it has already processed.
8. **What is folded:** the president and governor elections' `-cm` indexes, their `-u`
   files for the configured offices, and the president election's `br-…-ab`. Everything
   else (catalog, UF `-ab` files) is skipped and counted. The state election has no
   `br-…-ab`, so governor `ResultView.municipalities` is `null`. A governor `MapView` is
   deferred to `TASK-map.md`; `MunicipalityView` already covers governor per UF.
9. **The pointer is refreshed every 60 s** with the same `seq` and a new
   `health.recorderSeenAt` (the newest segment's `cycleStart`), so a quiet TSE doesn't
   look like a dead pipeline. Forward-only: a write needs `(epoch equal, seq ≥ current)`;
   a pointer in another epoch is replaced only with `--promote`.

### 2.5 Alternatives considered and rejected

- *Views ordered by geometry feature order (architecture §8):* rejected for now. The
  geometry doesn't exist yet (Phase 3). Ascending `cdi` is a shared, checkable order with
  no dependency, and `TASK-map.md` builds the TopoJSON in the same order.
- *`seq` = segment index:* rejected. It counts heartbeats. Distinct accepted inputs only
  move when the data does.
- *Building the timeline and feed now:* rejected. They're rebuildable from the immutable
  log at any time, and the must-have cut is the live map.
- *A database for projector state:* rejected (`architecture.md` ADR). Checkpoints in S3
  are enough for ~11k paths.

## 3. Why

Without this, the recorder's data reaches nobody. It produces every number the dashboard
shows, and it's where invariants 1 (real data only) and 6 (missing ≠ zero) become code.
Doing it in S3 mode first means the night never depends on Kafka.

Cost: ~2 days (10-08 → 10-10). AWS: S3 GETs for a full rebuild ≈ 11k × $0.0004/1k ≈
$0.005.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `packages/contracts/src/views/*.ts` (+ tests) | new | §2.1 |
| `packages/views/src/*.ts` (+ tests) | new | fold, render, status, reconcile, canonical JSON |
| `packages/s3kit/` | new | Lease + write-once put, moved out of `apps/recorder` |
| `apps/recorder/src/{lease,store}.ts` | edit | import from `packages/s3kit` |
| `apps/projector/src/*.ts`, `test/*` | new | source, publish, checkpoint, CLI |
| `.env.example` | edit | `PROJECTOR_*`, `PUB_BUCKET`, `ELECTIONS` |
| `docs/architecture.md` | edit | `seq` in S3 mode, `cdi` order for `MapView`, any resolved `[VERIFY]` |
| `CLAUDE.md`, `README.md` | edit | status, commands |

## 5. Verification

1. `pnpm turbo run lint check-types test build` is green, with:
   - **Views from real files:** folding the 10 samples gives the national view with Flávio
     56,104,503 (`"47,03"`), Lula 53,879,538, `vv` 119,300,788, turnout `"78,92"`, status
     `final`. The `zz29424` file gives a municipality with status `final` and all-zero
     votes, and its `dt`/`ht` render as `null`, not `""`.
   - **Determinism:** rendering the same state twice is byte-identical. Folding the same
     inputs in 20 random permutations gives byte-identical views.
   - **Idempotency:** folding an input twice changes nothing.
   - **Missing ≠ zero:** a UF with no accepted file renders `not_published` with null
     numbers.
2. **Integration (testcontainers RustFS + fake-tse + recorder + projector):**
   - views appear, and the pointer moves only forward;
   - two projectors: one publishes, and the pointer never goes backwards;
   - after a kill/restart from the checkpoint, the final views are byte-identical to an
     uninterrupted run (**replay = live**).
3. **The real log** (`projector rebuild --source s3` against
   `apuracao26-raw-860897618882`, publishing to local RustFS):
   - **all 11,443 files fold with 0 signature failures and 0 schema failures** (the 41
     zero-vote files included);
   - the national numbers equal item 1;
   - `MapView` has 5,571 entries, all `final`, with a leader set for every one (the 41
     zero-vote files are abroad cities, outside the domestic map; they appear in the
     `zz` `MunicipalityView` as `final` with all-zero votes and leader -1);
   - Σ municipal `vap` per UF equals the UF file per candidate (all files final, equal
     `dt/ht` or not, since the count is over);
   - Σ UFs + zz = br per candidate;
   - `MapView` ≤ 25 KB gzipped;
   - wall time ≤ 5 min, **median of 3 runs** reported.

## 6. Outcome (2026-10-08)

- **Item 1 (unit, real samples): passed.** `packages/views` 20 tests: national view
  (Flávio 56,104,503 `"47,03"`, Lula 53,879,538, `vv` 119,300,788, turnout `"78,92"`,
  `final`); `zz29424` `final` with all-zero votes, leader -1, `totalizedAt: null`; 20
  random permutations byte-identical; folding twice changes nothing; a UF without a file
  is `not_published` with null numbers; a tampered `.jws` never reaches a view.
- **Item 2 (integration, RustFS + fake-tse + recorder + projector): passed**, 3 runs in a
  row: views appear; the pointer only moves forward, also with two projectors and with a
  pointer of another epoch (moved only with `PROMOTE`); a rebuild equals the live
  projector; kill → restart from the checkpoint gives views byte-identical to a rebuild.
- **Item 3 (the real log on AWS): done 2026-10-08**, publishing to a local directory
  (`.replay/real/pub`) rather than RustFS. 3 runs: wall 39.4 / 32.2 / 30.7 s (median
  32.2 s; ~90% of it is the 11,387 blob GETs from a laptop in Brazil to sa-east-1),
  910 segments, 12,261 observations, `seq` 11,387, **0 rejected** (signature or schema, the
  41 zero-vote files included), reconciliation 0 identity failures and 56/56 comparable
  sums equal (Σ municipal = UF per candidate, Σ UFs + zz = br), and the 114 views
  identical across the three runs. 11,443 − 11,387 = the 56 files the views don't fold (the
  catalog and the 55 UF/zz coverage files). The national view is the sample's br file
  (byte-identical), so it equals item 1. `MapView`: 5,571 entries, all `final`.
  **The criterion "a leader set for every one" was wrong:** 2 municipalities are exact
  ties in the TSE's files, and the view correctly gives them leader −1 and margin 0:
  Crixás do Tocantins (TO, 73555), Lula 679 × Flávio Bolsonaro 679 of 1,422 valid votes,
  and Trabiju (SP, 62448), 574 × 574 of 1,243. The map must draw a tie as a tie (not as
  "no data"): recorded in `architecture.md` §6 (map view) for the web task.
- Found while building:
  - A projector that took over the lease and restored a checkpoint never wrote a pointer
    until the data changed. A new leader now publishes once on takeover.
  - The recorder's S3 conformance test exceeded vitest's 5 s default when the projector's
    container suite ran in parallel; it now has a 30 s timeout like its siblings.
- `pnpm turbo run lint check-types test build`: 32/32 tasks, 164 tests.

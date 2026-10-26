# TASK: the recorder never gives up on a stale municipal file

Found on the 2nd-round night, 2026-10-25, while building `TASK-history-2026.md`:
**224 of 5,757 municipal president files are stuck at an older version in our raw log**. 41 of
them are stuck at the empty pre-election file of 24/10. The TSE serves them final.

## 1. Current scenario

- Tier-2 municipal files are fetched only when their row in the UF coverage file (`-ab`)
  changes (`recorder.ts`, "Tier 1 → tier 2"). The trigger carries the row's instant. A
  fetch whose `dt/ht` is older than it is *pending* and retried on the file's `Expires`,
  `PENDING_MAX_TRIES` = 5 times. After that, `tse_stuck_mun` is counted and the trigger is
  **dropped for good**: the row doesn't change again once the municipality is final, so
  nothing ever re-fetches it.
- Example, `ele2026/6258/dados/se/se31259-c0001-e006258-u.jws`:
  - Our log has one observation: fetched 2026-10-25T23:55:59Z, idg 3948924,
    generated 24/10/2026 19:32:29, sha `1bae7fe9…`, 0/86 sections.
  - The TSE's `last-modified` is 23:55:54Z, 5 s earlier: the CDN still served the old
    body after the coverage file had changed.
  - The live `.jws` at 01:08Z: idg 4129590, generated 25/10/2026 20:55:33, 86/86, sha
    `bdbffc5c…`.
- **Impact:**
  - The live map and municipality table show older numbers for those 224 (3.9%).
  - The national and UF numbers come from their own files and are right.
  - The raw log lacks the final versions, so the history page's 2nd round can't be
    summed from it (`build-history.ts` now refuses: municipal sums ≠ UF files).
  - No data is lost: the TSE keeps serving the final files.
- A restart doesn't help: the snapshot keeps the coverage rows, so nothing looks changed.

## 2. Planned changes

- `version.ts`: `PathState.totalizedAt`, the accepted version's `dt/ht` instant. A `304`
  answering a trigger with no pending tries sets it to the trigger's instant, since
  the TSE confirms we hold its current file.
- `coverage.ts`, pure, both unit-tested:
  - `pendingPlan(tries, cfg)` → `'fast' | 'slow' | 'give-up'`: the first
    `PENDING_MAX_TRIES` on the file's `Expires` (≥ `ABSENT_RETRY_S`), then every
    `STUCK_RETRY_S` (300 s) up to `STUCK_MAX_TRIES` (288, so 24 h) more, then give up.
  - `staleMunicipal(coverage, states)`: every municipality whose coverage row has an
    instant later than its accepted `totalizedAt`, or that has none.
- `recorder.ts`:
  - Pending tier-2 files follow `pendingPlan`. `tse_stuck_mun` is counted on entering
    "slow", and `tse_gave_up_mun` plus a `page`-level log on giving up.
  - `initialize()` runs the sweep after `restore()`: it triggers each stale municipal file
    with its row's instant and schedules it now. The budget (≤ `RATE_MAX`) paces them.
    On the first start with this code every municipal path lacks `totalizedAt`, so each
    is re-fetched once, conditionally (`If-None-Match`): mostly `304`s, at most ~7,000
    requests (5,757 president + the 7 governor-runoff UFs' municipalities) at the
    budget's rate.
- `config.ts`: `STUCK_RETRY_S` (300), `STUCK_MAX_TRIES` (288). `.env.example` gets both.

**Rejected:**
- Re-fetching every municipal file on a fixed timer: ~5,757 requests every period,
  forever, against invariant 4.
- A one-off backfill script outside the recorder: blobs and observations would come from
  a second writer, and the gap would come back the next time the CDN lags.
- Editing the S3 snapshot by hand tonight: a manual write to the live recorder's state
  during the count.

## 3. Why

It completes the raw log (invariant 2) and the live map, and the history page's 2nd round
depends on it. Cost: a few hours. Request cost: under 1 req/s for tonight's 224, plus one
conditional pass over the municipal files on the first start. **Deploy:** the recorder
image is hand-run (`TASK-recorder.md` §6), after the freeze lifts (10-26 12:00 BRT), by the
user.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `apps/recorder/src/version.ts` (+ test) | edit | `totalizedAt` |
| `apps/recorder/src/coverage.ts` (+ test) | edit | `pendingPlan`, `staleMunicipal` |
| `apps/recorder/src/recorder.ts` | edit | wiring, metrics |
| `apps/recorder/src/config.ts`, `.env.example` | edit | two settings |
| `docs/architecture.md` §4.2, `TASK-recorder.md` | edit | the rule, and this incident |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green. The unit tests cover tonight's
   sequence:
   - A stale 200 arrives after the trigger, then 5 stale answers: pending moves to
     slow, not dropped.
   - A final 200 clears it.
   - After 288 slow tries it gives up.
   - A restored snapshot with no `totalizedAt` triggers every row with an instant.
   - A `304` to a trigger with no pending tries records the trigger's instant.
2. The recorder integration suite (testcontainers + fake-tse) is still green.
3. After the deploy, read-only, within 30 min: re-run `export-capture.ts --round 2`. Then
   `build-history.ts` must report that the municipal files equal every UF file and the
   national file, and se31259 must be at idg 4129590 (or later).

## 6. Outcome and a second cause (2026-10-25, 23:00–23:50 BRT)

- **First deploy** (task definition `:5`, 22:40): the sweep re-checked 17,041 files (the
  1st-round targets are still active) at `RATE_MAX` 10, in ~28 min. Of the 224 stuck files,
  all but Salvador (`ba38490`) came back final.
- **The TSE CDN never answered 304** tonight: every conditional GET got a 200
  `[VERIFY: If-None-Match vs the CDN's ETag]`.
- **A second cause: `idg` isn't monotonic after the count.** BA's coverage file of
  23:27:04 has idg 4241311, lower than an earlier version's 4247814. The recorder doesn't
  accept a lower idg, so the coverage index kept Salvador's 21:54 row and never triggered a
  fetch of its final file (100%, 23:26:38, idg 4254246, +39/+263 votes). There were hundreds
  of these "regressions" tonight. The projector orders by generation time, so the live site
  was unaffected.
- **Fix:**
  - `mergeCoverage`: rows are merged by their own instant, from every signed, schema-valid
    version.
  - `PathState.totalizedAt` is the latest instant of any trusted version, including a
    same-bytes re-fetch.
  - The 304 "confirmation" is removed.
  - The sweep is scheduled 30 s behind tier 1.
- **Also fixed by this:** the 1,003 governor 1st-round files (6259) left pending with
  10-16 coverage instants.

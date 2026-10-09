# TASK: one Node, one tzdata, everywhere (and Rabat's hour fixed)

Found by the projector's Fargate smoke test (`TASK-public-cdn.md` §9.6, 2026-10-09).

## 1. Current scenario

- Abroad stamps are read in each place's local time (`TASK-time-zones.md`): for the 220
  abroad `mu` codes, `packages/tse/src/timezone.ts` maps the code to an IANA zone
  (`scripts/abroad-zones.json` → `src/data/utc-offsets.json`) and asks **the runtime's
  `Intl`** for that zone's offset at the instant. So the offset, and with it the bytes of
  every view carrying an abroad `totalizedAt`, depend on the **tzdata built into Node**.
- Node is not pinned anywhere: `package.json` says `"node": ">=24"`, CI `node-version: 24`,
  both Dockerfiles `FROM node:24-slim`. On 2026-10-09 that meant:

  | Where | Node | `process.versions.tz` | `Africa/Casablanca` on 2026-10-05 |
  |---|---|---|---|
  | the laptop (rebuilds, `1t-final` seed) | 24.19.0 | 2026b | GMT+01:00 |
  | `node:24-slim` (recorder, projector images) | 24.21.0 | **2026c** | GMT+00:00 |
  | CI (`setup-node` `24`) | the newest 24.x at run time | varies | varies |

- tzdb 2026c (2026-07-08): *"Morocco moves to permanent +00 on 2026-09-20"*
  ([tzdb NEWS](https://data.iana.org/time-zones/tzdb/NEWS)). **2026c is right.** The
  published `1t-final` (seeded from the laptop) shows Rabat (`mu` 30406,
  `municipalities/president/zz` row 103) at `2026-10-05T12:51:05+01:00`, an hour off;
  the Fargate fold gives `+00:00`. 197 of 198 views are otherwise byte-identical.
- So "a rebuild is byte-identical to live" (`architecture.md` §5.3, the replay test) holds
  only on the same tzdata, and nothing enforces that.
- `epochs.json` pins `1t-final` to manifest `d6e1a951…` (`seq` 11,468). Manifests are
  write-once, so `1t-final` can't be re-seeded at the same `seq` with different bytes.
  `scripts/publish-epochs.ts` can add or update an entry, not remove one.
- The web app picks a round by `?turno=<epoch>`; an unknown epoch falls back to the live
  pointer (`apps/web/src/data/rules.ts:128`).

## 2. Planned changes

### 2.1 Pin Node 24.21.0 (tzdata 2026c) in every place that runs our code

Node 24.21.0 is the newest 24.x (2026-09-07, [index](https://nodejs.org/dist/index.json));
it carries tzdata 2026c (checked with `docker run node:24.21.0-slim`).

- **`package.json`:** `devEngines.runtime: {name: "node", version: "24.21.0", onFail:
  "download"}` ([pnpm](https://pnpm.io/package_json), added in pnpm 10.14): `pnpm install`
  fetches that Node and pnpm scripts run on it, with the version and checksum in the
  lockfile. `engines.node` stays `>=24` (it's about consumers, and we publish nothing).
- **`.github/workflows/ci.yml`:** `node-version: 24.21.0`.
- **`apps/recorder/Dockerfile`, `apps/projector/Dockerfile`:** `FROM node:24.21.0-slim`
  (both stages). By tag, not digest: Docker Hub re-pushes a tag for OS patches, and the
  tag fixes the Node version (and so the tzdata), which is what matters here.
- `fake-tse` runs from the repo (pnpm), so it follows `devEngines`.

### 2.2 A guard: the projector refuses the wrong tzdata

pnpm 11 applies `devEngines` to scripts only; a bare `node …` (how the user runs the ops
scripts and rebuilds) still uses the system Node (pnpm ≥ 12.0.0-rc.2 changes that). So:

- **`packages/tse/src/timezone.ts`:** `export const TZDATA = '2026c'` and
  `assertTzdata()`, which throws unless `process.versions.tz === TZDATA`, with a message
  naming the Node version to use. Equality, not `>=`: the point is that every runtime
  produces the same bytes. A future bump changes the constant and the three pins in one
  commit.
- **`apps/projector/src/main.ts`:** `assertTzdata()` first, for `run` and `rebuild` alike.
  The recorder doesn't render times (it stores bytes), so it doesn't call it.
- **A test in `packages/tse`:** `Africa/Casablanca` at 2026-10-05T12:51:05 local is
  `+00:00`, and `assertTzdata()` passes. CI fails if its Node ever drifts.

### 2.3 Re-seed the 1st round under a new epoch, `1t-final-2`

- **`scripts/publish-epochs.ts`:** `--replaces <epoch>`: the new entry takes the old
  one's slot in a single write (validated with `EpochsIndex`, `--dry-run` as today), so
  the selector never shows two "1º turno". It never touches the epoch's objects.
  (Planned as a separate `--remove`; changed during the build: two writes would leave a
  window with both entries.)
- Ops, run by the user after my dry runs (memory: deploys are the user's):
  1. `node apps/projector/dist/main.js rebuild --source s3 --epoch 1t-final-2 --out
     s3://apuracao26-pub-860897618882 --promote` on Node 24.21.0 (the guard refuses
     anything else);
  2. `node scripts/publish-epochs.ts --epoch 1t-final-2 --label "1º turno" --replaces
     1t-final`.
- Expected: the `1t-final-2` manifest's `views` equal the Fargate `smoke-1t` manifest's
  (`a7967e46…`) view for view, i.e. `1t-final` plus Rabat's fixed row.
- `1t-final`'s objects stay in the bucket (immutable; harmless). A shared
  `?turno=1t-final` link falls back to the live pointer, which is the 1st round until
  `6258` appears, so the links shared today keep working.

### 2.4 Alternatives considered and rejected

- *Promote the Fargate `smoke-1t` manifest as it is:* the bytes are right, but a
  test-named epoch would live in the index and in `?turno=` links for good.
- *Our own offset table for abroad zones (no `Intl` at render time):* fully independent of
  the runtime, but it re-implements tzdb rules for 220 places and goes stale the same way
  (Morocco changed its rule twice since 2018). The pin plus the guard gives the same
  determinism with no new data to maintain.
- *Pin by image digest:* stricter than needed (the tzdata comes with the Node version),
  and it would block OS security patches.
- *`>=` on the tzdata version:* lets two runtimes disagree again.
- *Leave `1t-final` and note the error:* invariant 1 is about real data; a wrong local
  time on a published row is a wrong fact, and the fix is ~an hour.

## 3. Why

The night's projector (Fargate) and any rebuild or replay must give the same bytes, or the
replay test and "rebuild to recover" (`architecture.md` §5.5, the runbook) silently stop
meaning anything. It also removes a wrong timestamp from the live site. Cost: about an
hour of work; the rebuild is ~35 s and a few cents of S3 requests. The running recorder
isn't redeployed for this (it doesn't render times); its next deploy picks up the pin.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `package.json`, `pnpm-lock.yaml` | edit | `devEngines.runtime` (§2.1) |
| `.github/workflows/ci.yml` | edit | `node-version: 24.21.0` |
| `apps/recorder/Dockerfile`, `apps/projector/Dockerfile` | edit | `node:24.21.0-slim` |
| `packages/tse/src/timezone.ts`, `packages/tse/src/index.ts` | edit | `TZDATA`, `assertTzdata()` |
| `packages/tse/test/timezone.test.ts` (or the existing tz test) | edit | Casablanca + guard |
| `apps/projector/src/main.ts` | edit | the guard at startup |
| `scripts/publish-epochs.ts` | edit | `--replaces` |
| `CLAUDE.md` (toolchain quirks), `README.md` | edit | the pin and why; the live epoch name |
| `docs/tasks/TASK-time-zones.md` | edit | a note: offsets depend on the pinned tzdata |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green on Node 24.21.0 (CI shows the
   version in `setup-node`); the new test passes.
2. The guard: `node apps/projector/dist/main.js rebuild …` under Node 24.19.0 exits
   non-zero with the message naming 24.21.0, before any S3 call.
3. A local rebuild into a directory under 24.21.0: `municipalities/president/zz` row 103
   is `+00:00`, and all 198 view hashes equal the `smoke-1t` manifest's.
4. After the user's re-seed: `latest.json` → `epoch: "1t-final-2"`; `epochs.json` has one
   entry, `1t-final-2` / "1º turno"; the live page (`index.html`) loads, and
   `index.html?turno=1t-final` shows the same 1st round.
5. `docker build` of the projector image: `node -p process.versions.tz` inside it prints
   `2026c`.

## 6. Outcome (2026-10-09)

Done. CI green on `a868a17`.

1. `pnpm turbo run lint check-types test build`: 38/38 on Node 24.21.0 via `devEngines`
   (`pnpm exec node -p process.versions.tz` → `2026c`; bare `node` is still 24.19.0). The
   new Rabat test calls `assertTzdata()` and passes.
2. Bare `node apps/projector/dist/main.js rebuild …` on 24.19.0: exit 1, `tzdata 2026b in
   Node 24.19.0, expected 2026c: run on Node 24.21.0`, before any S3 call.
3. `pnpm exec node apps/projector/dist/main.js rebuild --source s3 --epoch 1t-final-2
   --out <dir>` against the real raw log: `seq` 11,468 in 45.5 s; **all 198 view hashes
   equal the Fargate `smoke-1t` manifest's**; vs `1t-final` only
   `municipalities/president/zz` differs, Rabat `2026-10-05T12:51:05+00:00`.
4. The re-seed, run by the user: `rebuild … --epoch 1t-final-2 --promote` in 43.7 s,
   `seq` 11,468, 198 views put, 0 rejected, reconcile 56/56 sums equal, pointer `moved`,
   manifest `9bf5506c…`; `publish-epochs --replaces 1t-final` wrote one entry. Live:
   `latest.json` → `1t-final-2`; `epochs.json` → `[1t-final-2, "1º turno"]`; the live
   manifest's views equal the Fargate `smoke-1t`'s, Rabat `+00:00`. Headless Chrome on
   `index.html` and on `index.html?turno=1t-final`: both load the 1st round, no page error.
   Found on the way, **not from this task**: on the S3 REST endpoint (plan B) the office
   links are `/?cargo=…`; clicking works (client-side), but the address bar then holds a
   URL that answers **403** on reload or when shared, and Next's prefetch of `/` logs 403s.
   CloudFront's default root object fixes it; until then it needs its own small fix.
5. `docker build` of the projector image: `node -p` inside → `24.21.0 2026c`.

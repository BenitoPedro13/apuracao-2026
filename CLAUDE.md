# Workflow Guidelines — Apuração 2026

> Ported from the `blessed-moon` / `renewable-pulse` workflow (plan before you touch anything,
> lean on official CLIs and generators, treat documentation as part of the deliverable),
> retargeted to this project. Section 0 is project-specific; sections 1–4 are the portable rules.
>
> **The philosophy in one line:** plan before you write, lean on existing tooling while you
> work, and treat documentation as part of the deliverable when you finish.

---

## 0. Project context — Apuração 2026

A live, public dashboard for counting the votes in Brazil's 2026 elections: a national
headline, a municipality-level map, regional breakdowns, a turnout panel, an "over the count"
chart and a **timeline scrubber that replays the count**. It also serves as a deliberate
exercise in **distributed, data-heavy systems**: polling ingestion against a rate-limited
CDN, an append-only history of every published version, idempotent projections, and fan-out
to many concurrent readers on election night. Visual reference: seuimposto.com's
"Apuração 2026 by pandora" (screenshot the user shared on 2026-10-07).

**Hard deadline: the 2nd round is on Sunday 2026-10-25.** It covers president (Lula × Flávio
Bolsonaro) plus governor in AC, AM, DF, ES, RJ, RN and TO. Anything not live and load-tested
by then waits for post-election replay and analysis. Scope decisions are made against this
date.

**Status (2026-10-08):** Phase 0 and Phase 1 are done. **The recorder is live on AWS**
(`TASK-recorder.md` §6): it captured all 11,443 1st-round files, soaks against the TSE CDN,
and will discover the 2nd round by itself. Next: Phase 2, starting with
`docs/tasks/TASK-projector-and-views.md`. **The web app** (`apps/web`) shows the night's
panels from the published views (`TASK-web-shell-and-data-hooks.md`, 2026-10-08), with the
municipality map (`TASK-map.md`) and its visual identity (`TASK-visual-identity.md`), both
2026-10-08. Senado and Deputados are a 1st-round archive (`TASK-legislative-archive.md`,
2026-10-09): the recorder captures their 81 UF files (`:uf` targets), the projector renders
`legislative/*` views for the `6259` epoch only, and the page switches office with `?cargo=`.
CI (`.github/workflows/ci.yml`) runs on every push to `main`. Read in this order:

1. `docs/research/01-tse-results-feed.md` and `02-signatures-cache-and-map-mesh.md`: the
   verified facts about the TSE feed (URLs, file shapes, caching, signed `.jws` siblings,
   codes) and the IBGE map mesh, with real captured files in `docs/research/samples/`.
2. `docs/architecture.md`: the system design (capacity numbers, components, storage keys,
   contracts, failure modes, testing, cost, ADRs, decisions).
3. `docs/tasks/TASK-implementation-plan.md`: the phased build order to 2026-10-25, the
   must-have cut and the gates. Each phase gets its own task document (§1).

**Hard constraint: every number shown traces back to a real TSE-published file.** No
synthetic, simulated or interpolated vote counts, anywhere. A gap (an unrecorded period, a
failed fetch) is shown as missing, never smoothed over. Replaying real captured files is
fine. Fabricating a count is not.
Sums of real TSE records are fine when labelled as ours: a timeline of "boletins recebidos
até hh:mm" summed from the TSE's published BU files (research 03) is accepted (user,
2026-10-08), always labelled as BU receipts, never as the TSE's live count at that time.

### Stack

Decided in `docs/architecture.md` (2026-10-07). Version numbers are a snapshot, not a pin:
verify against each tool's current docs before installing (§2.0).

| Layer | Choice | Notes |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | `apps/{recorder,projector,fake-tse,web}`, `packages/{contracts,tse,views,s3kit,config}`, `infra/` |
| Language | TypeScript **7** on Node 24, everywhere | ADR-2: IO-bound, shares Zod contracts with the web app |
| Ingestion | `apps/recorder`, Fargate ARM in sa-east-1 (1 task from 10-11, + a standby 10-24 → 10-26), S3-lease leader | fetches the TSE **`.jws`** (signed, payload = the `.json`), per-file `Expires` scheduling, ≤100 req/s |
| History / log | S3 `apuracao26-raw-860897618882`: content-addressed blobs (`If-None-Match: *`), Object Lock (governance retention set per object on `raw/`, `obs/`), observation segments every 5 s + 60 s heartbeat | the source of truth (invariant 2). **Live since 2026-10-08** |
| Broker | Amazon MSK, 3 × `kafka.t3.small`, topic `tse.observations.v1` (1 partition, RF 3) | **learning choice on the critical path** (user, 2026-10-07): never the only copy, S3 fallback mode, gate on 10-16. **Exists only when switched on** (CDK `night=on`: 10-15 smoke test, 10-22 rehearsal, 10-24 → 10-26); development uses local Redpanda |
| Kafka client | `@confluentinc/kafka-javascript` | `kafkajs` rejected (unmaintained since 2023) |
| Projections | `packages/views` (pure fold/render) run by `apps/projector`, Fargate ×2 | no database; state checkpointed to S3 |
| Fan-out | S3 `apuracao26-pub` + CloudFront (`*.cloudfront.net`, Origin Shield) | immutable content-addressed views, manifest per `seq`, 5 s pointer polled every 20 s; no SSE |
| Web | Next.js 16 static export, shadcn/ui, TanStack Query; map in Canvas 2D | frontend rules are in the user's global `~/.claude/CLAUDE.md` and apply unchanged |
| Map geometry | IBGE Malha Municipal 2025 → mapshaper 0.7.80 (`scripts/build-geometry.ts`) → TopoJSON, Albers, 306 KB gzip, shipped with the site | joins 5,571/5,571 on `cdi`; drawn with Canvas 2D + `d3-zoom` |
| Contracts | Zod 4 in `packages/contracts` | no non-TS services, so nothing to hand-mirror |
| Infra | AWS CDK (TypeScript), GitHub Actions | sa-east-1; paid from the user's AWS credits ($100, valid to ~2027-04); ≈ $40 total, CloudFront $0 at the expected ~100 viewers (`architecture.md` §11). Nothing that bills by the hour runs before it has a job |
| Observability | CloudWatch EMF metrics, canary Lambdas (every 1 min), SNS email/SMS | `architecture.md` §10 |
| Analytics | Umami, cookieless, no ads | user decision 2026-10-07 |
| Local / tests | docker compose + testcontainers: Redpanda (Kafka API), RustFS 1.0.1 (S3 API; replaced MinIO, whose image can no longer be pulled; chosen by the recorder's S3 conformance suite) | real brokers/stores, never mocks; Vitest 5 everywhere |

### Toolchain quirks (found while scaffolding, 2026-10-07)

- **TypeScript 7 + ESLint:** typescript-eslint supports only TS `<6.1.0`, so (as
  `create-turbo` does) ESLint parses TS with Babel. `no-undef`/`no-unused-vars` are off
  for `.ts`, and `tsc` covers them (`noUnusedLocals`, `noUnusedParameters`). There's no
  type-aware lint until typescript-eslint supports TS 7.
- **pnpm 11 supply-chain policy:** packages younger than `minimumReleaseAge` are refused.
  Pin the newest version that passes it rather than adding an exclusion. Dependency build
  scripts need an `allowBuilds` entry in `pnpm-workspace.yaml` (only `esbuild` today).
- **Task names:** `build`, `lint`, `check-types` (the generator's name), `test`. Run all of
  them with `pnpm turbo run lint check-types test build`.
- **Next.js + TS 7 lint (2026-10-08):** `eslint-config-next` pulls typescript-eslint, so
  `apps/web` doesn't use it; it applies `@next/eslint-plugin-next`, `react-hooks` and
  `jsx-a11y` (strict) on the Babel-parsed base config. Babel presets are resolved by path
  from the config package (`import.meta.resolve`), never by name from the cwd. `next build`
  type-checks with the `tsc` CLI (experimental `useTypeScriptCli`); `check-types` stays the gate.
- **Docker contexts are the repo root** (recorder, projector): anything big and local
  must be in `.dockerignore` too, not only `.gitignore`, or CDK's asset hashing reads it
  (the 553 MB IBGE download timed the infra tests out, 2026-10-08).
- **Browser perf tests run Chrome's new headless** (`channel: "chromium"`): the default
  headless shell rasterizes canvas in software and misreports frame times.
- **Browser bundles:** import `@apuracao/tse/codes`, not `@apuracao/tse` (its index pulls the
  5,757-entry time-zone table). `contracts` and `tse` are `sideEffects: false`.

### How to write in this repo

- **Never invent a TSE field, file name, URL or behavior.** Write `[VERIFY: what to check and
  where]` inline instead, and resolve it against a real response captured into
  `docs/research/samples/` before code depends on it.
- **Be specific to the point of discomfort:** exact URLs, exact poll intervals, exact
  numbers. No acceptance criterion may rest on "works" or "fast enough". State the
  requests per second, the p95 latency, the number of concurrent readers.
- **Sources over memory.** Anything about the TSE, IBGE, a library or a hosting platform is
  checked against the live source, and the source is linked.

### Invariants — never break these without changing the spec first

1. **Real data only** (the hard constraint above).
2. **Raw snapshots are immutable and kept forever.** Every distinct version of every TSE
   file we fetch is stored byte-for-byte, keyed by its identity (path + `idg`/ETag/content
   hash). Everything else (aggregates, map views, the timeline) is a *projection* that can be
   rebuilt from the raw log. A projection is never the source of truth.
3. **Idempotent ingestion.** Fetching or processing the same file version twice changes
   nothing.
4. **Be a polite client to the TSE.** Conditional GETs (`If-None-Match`), polling no faster
   than the CDN's `max-age`, a hard request budget per cycle well under the published rate
   limit, and backoff on 4xx/5xx. Our readers are never proxied straight through to the TSE.
5. **Readers never touch the ingestion path.** Viewer traffic is served from precomputed,
   cacheable artifacts. A traffic spike must not be able to slow ingestion, and an ingestion
   stall must not take the site down (it shows "last updated at …").
6. **Missing is not zero.** "No sections counted yet", "fetch failed" and "zero votes" are
   three different states in contracts and UI.
7. **WCAG 2.2 AA.** The map is never the only way to read a result (a table/list alternative
   is required), and color (party red/blue) is never the only carrier of meaning.

### Tests

- **Integration tests against real infrastructure** (testcontainers or equivalent), never a
  mocked database or broker.
- **Parsers are tested against the real captured files** in `docs/research/samples/`, never
  hand-built fixtures.
- **Idempotency is a test:** ingest the same file version twice and assert nothing changed.
- **Replay is a test:** rebuild a projection from the raw log and assert it equals the live
  projection.
- **Load claims need a load test** with medians of repeated runs, never a single run.

---

## 1. Plan before executing — write a task document first

**Rule:** Before editing or creating **any** code file, write a task document at
`docs/tasks/TASK-<slug>.md`. No exceptions for "small" changes.

Required sections, in order:

1. **Current scenario**: how it works today, and what's missing or blocked.
2. **Planned changes**: file by file, plus alternatives considered and rejected.
3. **Why**: what it unblocks and what it costs.
4. **Affected files**: a table of `File | Change type | Notes`.
5. **Verification**: the exact commands and observations that prove it works.

Write the document, summarize it in 2–3 lines, and wait for alignment on anything
significant before writing code. Keep it in sync if the plan changes. The task document is
the contract.

## 2. Use CLIs, generators, and SDKs — don't write everything by hand

### 2.0 Assume your framework knowledge is outdated — check first, every time

1. Go to the tool's own current docs first (Next.js, Turborepo, shadcn/ui, the chosen
   database/broker/host).
2. Use the official CLI to scaffold: `pnpm create next-app@latest`, `pnpm dlx shadcn@latest
   add …`, `pnpm dlx create-turbo@latest`, and so on.
3. Take the current stable major as authoritative over anything written here, and update
   this file's stack table to match (§3).
4. One package manager (**pnpm**), never mixed.

Hand-writing is for what no generator covers: the poller, the diffing, the projections, the
map rendering. Match the style of the surrounding code.

## 3. Update documentation after executing

A task isn't done until every doc it affects is updated:

- **`CLAUDE.md`**: if the stack, architecture or an invariant changes.
- **`docs/architecture.md`**: if a `[VERIFY]` resolves or scope changes.
- **`docs/research/`**: if a new fact about the TSE is observed (add the captured sample too).
- **`.env.example`**: every environment variable the code reads.
- **`README.md`**: status line, setup and scripts.

When unsure, grep for the thing you changed across these files.

## 4. Project conventions

Monorepo (pnpm workspaces + Turborepo). The layout, as decided in `docs/architecture.md`:

```
apps/
  recorder/     poller: per-file Expires scheduling → .jws fetch + verify → S3 raw log → Kafka
  projector/    folds observations (Kafka, or S3 in fallback/rebuild mode) → publishes views
  fake-tse/     test harness: serves real captured files with TSE HTTP semantics, staged reveal
  web/          Next.js dashboard (static export)
packages/
  contracts/    Zod schemas for TSE file shapes (parsed), Observation, and our published views
  tse/          TSE URL builders, codes, string-number parsing, .jws verification; one place
  views/        pure fold/render functions shared by projector, rebuild and tests
  s3kit/        S3 lease + write-once put, shared by recorder and projector
  config/       shared tsconfig / eslint / prettier
infra/          AWS CDK app + docker compose (Redpanda, RustFS) for local runs
scripts/        one-off captures, ops commands, k6 and Playwright perf scenarios
docs/
  research/     verified facts + samples/ (real captured TSE files)
  tasks/        task documents (§1)
  architecture.md
```

### 4.1 Commit conventions

- **Commit automatically once a task document's work is complete and verified** (build,
  lint and tests passing). Don't wait to be asked each time. This doesn't cover destructive
  git operations (force-push, `reset --hard`), which still need explicit confirmation.
- **No `Co-Authored-By` trailer.** User preference for every repo.

---

## TL;DR

Research (`docs/research/`) → architecture (`docs/architecture.md`, done) → task doc
(`docs/tasks/TASK-<slug>.md`) → align → build with official generators → update docs →
commit (no `Co-Authored-By`). **Never broken:** real TSE data only, raw snapshots immutable
and replayable, idempotent ingestion, polite to the TSE, readers isolated from ingestion,
missing ≠ zero, WCAG 2.2 AA. **Deadline:** 2nd round, 2026-10-25.

# Apuração 2026

**A live vote-count dashboard for Brazil's 2026 elections, built on the TSE's official,
signed results feed — and a recorder that keeps every version of every file, so the count
can be replayed minute by minute afterwards.**

[**Open the dashboard →**](https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/index.html)

Every number on screen traces back to a TSE-signed file stored byte for byte. There are no
projections, no "who will win" calls, and no interpolation between versions that were
actually observed: a gap in the record is shown as a gap.

> **Status (2026-10-09).** The recorder has been live on AWS since 2026-10-08: it captured
> the 1st round and will discover the 2nd-round files on its own. The dashboard shows the
> 1st round's final results. **Deadline: 2nd round, Sunday 2026-10-25.**

## What's on the page

| View | URL | What it shows |
|---|---|---|
| Presidente | `/` | Headline (leader, %, votes, gap), UF and municipality tables, regions, turnout, blank/null votes, freshness, and a municipality map |
| Governadores | `?cargo=governador` | Tiles, the closest races, a map by state that opens into municipalities |
| Senado, Câmara, Assembleias | `?cargo=…` | A 1st-round archive from the 81 signed UF files, with hemicycles for the Câmara and Senado |
| Eleições anteriores | `?historico` / `?ano=` | Presidential elections 1994–2022, municipality by municipality, organised as questions: your town, who decided, bellwethers, the 2006 realignment, where third candidates' votes went |

## Highlights

- **Provably faithful.** The recorder stores each TSE `.jws` with its signature in an
  Object-Lock S3 bucket, content-addressed by SHA-256. Anyone can re-verify a number.
- **Readers never touch the backend.** The site is a static export; the data is immutable
  views on S3 behind CloudFront. A traffic spike can't slow ingestion, and an ingestion
  stall can't take the site down.
- **Rebuildable from the log.** The projector is a pure fold over the raw log
  (`packages/views`), so the published views can be rebuilt from scratch at any time.
- **Rehearsed on real data.** `fake-tse` replays the captured 1st round on an accelerated
  clock with the TSE CDN's caching semantics, for end-to-end runs before the night.
- **A self-imposed rate ceiling** (100 req/s sustained, 16 in flight) well under the TSE's
  published limit, with conditional requests so an unchanged cycle costs ~1 req/s.
- **Accessible and measured.** Playwright e2e on the build checks TSE numbers, polling,
  states, axe and keyboard use; performance runs on Fast 4G + 4× CPU, median of 3.

## Architecture

```
TSE CDN (signed .jws)
   │  conditional GETs, rate-limited, lease-guarded
   ▼
recorder (Fargate) ──► S3 raw log (Object Lock, sha256-addressed)
                           │
                           ▼
                    projector (Fargate, S3 mode) ──► S3 public views ──► CloudFront ──► web (Next.js static export)
```

A message broker (MSK/Kafka) between recorder and projector is designed in
[`docs/architecture.md`](docs/architecture.md) §3.3 as a learning component that can never
lose data — S3 stays the source of truth. It is not deployed yet.

| Path | What |
|---|---|
| `apps/recorder` | Polls the TSE feed, verifies, writes each new version to the raw bucket |
| `apps/projector` | Folds the raw log into the published views |
| `apps/fake-tse` | Replays captured files with TSE CDN semantics |
| `apps/web` | The dashboard: Next.js static export, TanStack Query, Canvas 2D map over the IBGE mesh |
| `packages/contracts` · `tse` · `views` · `s3kit` · `config` | Shared schemas (zod), TSE parsing, the fold, S3 helpers, config |
| `infra/` | AWS CDK app (sa-east-1): budget, raw, recorder, public CDN, projector stacks — see [`infra/README.md`](infra/README.md) |

**Stack:** TypeScript · pnpm + Turborepo · Node 24 · Next.js · TanStack Query/Table · d3-zoom ·
zod · AWS CDK · ECS Fargate · S3 · CloudFront · Docker (Redpanda + RustFS locally).

## Getting started

Requires Node 24, pnpm 11 (pinned in `packageManager`) and Docker. Environment variables
are listed in [`.env.example`](.env.example).

```sh
pnpm install
pnpm turbo run lint check-types test build                # everything; the second run is a cache hit
docker compose -f infra/docker-compose.yml up -d --wait     # local Redpanda (Kafka) + RustFS (S3)
node apps/fake-tse/dist/main.js --static                    # the real samples, final, with TSE CDN semantics
```

### The web app

```sh
pnpm dev                                                    # http://localhost:3000, reading the live bucket
pnpm --filter @apuracao/web serve-data                      # .replay/real/pub on :3001, then
NEXT_PUBLIC_DATA_BASE_URL=http://127.0.0.1:3001 pnpm dev    # …the same page on local real data
pnpm --filter @apuracao/web build                           # → apps/web/out (static export)
pnpm --filter @apuracao/web test:e2e                        # Playwright on the build: TSE numbers, polling, states, axe, keyboard
pnpm --filter @apuracao/web perf:build && pnpm --filter @apuracao/web test:perf   # Fast 4G + 4× CPU, median of 3
node scripts/deploy-web.ts [--dry-run]                      # upload out/ to the public bucket (never data/, never deletes)
```

### Replaying the 1st round

The capture lives on disk, not in git ([`TASK-fake-tse.md`](docs/tasks/TASK-fake-tse.md)).
Export it once from the raw bucket (read-only, needs `aws login`), then replay it locally at
×20 (~30 min per run):

```sh
node scripts/export-capture.ts                     # → .capture/ele2026-1t/ (11,443 files)
node scripts/replay.ts --runs 3                    # RustFS + fake-tse + recorder + projector; prints the §9.2 numbers
node apps/fake-tse/dist/main.js --capture .capture/ele2026-1t --speed 20 --port 8080   # the server alone
```

The replay's rebuilt coverage files are signed with a throwaway test key that only a
recorder/projector given `TSE_TEST_JWK_URL` trusts, and both refuse to start with it against
a production bucket.

### Data builds

```sh
node scripts/build-geometry.ts                                       # map geometry from the IBGE zip in data/ibge/ (output committed)
pnpm exec node scripts/capture-history.ts [--bucket <raw> [--write]] # TSE 1994–2022 president zips → .capture/odsele/ (2 GB; S3 archive user-run)
pnpm exec node scripts/build-history.ts --check                      # → apps/web/public/history/ (committed); --check re-derives research 05's numbers
pnpm exec node scripts/publish-epochs.ts --epoch 1t-final-2 --label "1º turno" [--replaces <old>] [--dry-run]   # the round selector's index
```

Ops scripts run with `pnpm exec node` so they use the pinned Node 24.21.0 (tzdata 2026c,
[`TASK-tzdata-pin.md`](docs/tasks/TASK-tzdata-pin.md)).

### Operating on AWS (sa-east-1)

```sh
# Rebuild the views from the raw log (read-only on raw; publishes to a directory or a bucket)
RAW_BUCKET=apuracao26-raw-860897618882 ELECTIONS=president=6257,governor=6259 \
  pnpm --filter @apuracao/projector rebuild --source s3 --epoch rebuild-1 --out ./pub

aws logs tail /apuracao26/recorder --region sa-east-1 --follow | grep -v '"_aws"'
aws s3 ls s3://apuracao26-raw-860897618882/raw/v1/sha256/ --recursive | wc -l   # stored versions
ALERT_EMAIL=… pnpm --filter @apuracao/infra exec cdk deploy RecorderStack       # redeploy
```

The site is served over S3 HTTPS until CloudFront is verified
([`TASK-public-cdn.md`](docs/tasks/TASK-public-cdn.md) §8). The 1st round's final results:
[`data/v1/latest.json`](https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/data/v1/latest.json).

## Documentation

| Doc | |
|---|---|
| [`docs/research/01-tse-results-feed.md`](docs/research/01-tse-results-feed.md) | How the TSE feed actually behaves |
| [`docs/research/02-signatures-cache-and-map-mesh.md`](docs/research/02-signatures-cache-and-map-mesh.md) | Signatures, CDN caching, the IBGE mesh |
| [`docs/research/05-historical-results.md`](docs/research/05-historical-results.md) | The 1994–2022 archive files |
| [`docs/architecture.md`](docs/architecture.md) | The system design, capacity numbers and invariants |
| [`docs/tasks/TASK-implementation-plan.md`](docs/tasks/TASK-implementation-plan.md) | Build order to 2026-10-25 |
| [`docs/tasks/`](docs/tasks/) | One document per change: map, visual identity, legislative archive, history, … |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repo |

---

Built by [Blessed Moon Studio](https://blessed-moon.vercel.app). Results data: Tribunal
Superior Eleitoral (TSE). Map mesh: IBGE.

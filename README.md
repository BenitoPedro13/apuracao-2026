# Apuração 2026

A live vote-count dashboard for Brazil's 2026 elections, built on the TSE's official results
feed. It records every published version of every file, so the count can be replayed
minute by minute.

**Status:** the recorder is live on AWS (2026-10-08). It captured the 1st round, soaks
against the TSE CDN, and will discover the 2nd-round files by itself. The projector (S3
mode) folds that log into the published views (`docs/tasks/TASK-projector-and-views.md`).
The 1st round's final results are public at
`https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/data/v1/latest.json`
(plan B, S3 over HTTPS until CloudFront is verified: `docs/tasks/TASK-public-cdn.md` §8).
fake-tse replays the 1st round's real files on an accelerated clock, for end-to-end runs
before the night (`docs/tasks/TASK-fake-tse.md`). The web app (`apps/web`, Next.js static
export) shows the night's panels from those views: headline, UF and municipality tables,
regions, status and freshness (`docs/tasks/TASK-web-shell-and-data-hooks.md`), and is live
at `https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/index.html`; the map is
next (`TASK-map.md`).
**Deadline:** 2nd round, Sunday 2026-10-25.

- What we know about the data: [`docs/research/01-tse-results-feed.md`](docs/research/01-tse-results-feed.md),
  [`docs/research/02-signatures-cache-and-map-mesh.md`](docs/research/02-signatures-cache-and-map-mesh.md)
- The system design: [`docs/architecture.md`](docs/architecture.md)
- The build order to 2026-10-25: [`docs/tasks/TASK-implementation-plan.md`](docs/tasks/TASK-implementation-plan.md)
- How to work in this repo: [`CLAUDE.md`](CLAUDE.md)

Planned stack: TypeScript monorepo (pnpm + Turborepo) on AWS sa-east-1: a Fargate recorder
writing the TSE's signed `.jws` files to S3, Amazon MSK (Kafka), a projector publishing
immutable views to S3 + CloudFront, and a Next.js static dashboard.

## Setup

Requires Node 24, pnpm 11 (the version is pinned in `packageManager`), and Docker.

```sh
pnpm install
pnpm turbo run lint check-types test build   # everything; the second run is a cache hit
docker compose -f infra/docker-compose.yml up -d --wait   # local Redpanda (Kafka) + RustFS (S3)
node apps/fake-tse/dist/main.js --static                 # the real samples, final, with TSE CDN semantics
```

Replaying the 1st round (`docs/tasks/TASK-fake-tse.md`). The capture lives on disk, not in
git: export it once from the raw bucket (read-only, needs `aws login`), then replay it
locally at ×20 (~30 min per run):

```sh
node scripts/export-capture.ts                     # → .capture/ele2026-1t/ (11,443 files)
node scripts/replay.ts --runs 3                    # RustFS + fake-tse + recorder + projector; prints the §9.2 numbers
node apps/fake-tse/dist/main.js --capture .capture/ele2026-1t --speed 20 --port 8080   # the server alone
```

The replay's rebuilt coverage files are signed with a throwaway test key that only a
recorder/projector given `TSE_TEST_JWK_URL` trusts, and both refuse to start with it against
a production bucket.

The web app:

```sh
pnpm dev                                           # http://localhost:3000, reading the live bucket
pnpm --filter @apuracao/web serve-data             # .replay/real/pub on :3001, then
NEXT_PUBLIC_DATA_BASE_URL=http://127.0.0.1:3001 pnpm dev   # …the same page on local real data
pnpm --filter @apuracao/web build                  # → apps/web/out (static export)
pnpm --filter @apuracao/web test:e2e               # Playwright on the build: TSE numbers, polling, states, axe, keyboard
pnpm --filter @apuracao/web perf:build && pnpm --filter @apuracao/web test:perf   # Fast 4G + 4× CPU, median of 3
node scripts/deploy-web.ts [--dry-run]             # upload out/ to the public bucket (never data/, never deletes)
node scripts/publish-epochs.ts --epoch 1t-final --label "1º turno" [--dry-run]   # the round selector's index
```

Layout: `apps/{recorder,projector,fake-tse,web}`, `packages/{contracts,tse,views,s3kit,config}`,
`infra/` (AWS CDK app: see [`infra/README.md`](infra/README.md)). Environment variables
are listed in [`.env.example`](.env.example).

Rebuilding the views from the raw log (read-only on the raw bucket; publishes to a
directory or a bucket):

```sh
RAW_BUCKET=apuracao26-raw-860897618882 ELECTIONS=president=6257,governor=6259 \
  pnpm --filter @apuracao/projector rebuild --source s3 --epoch rebuild-1 --out ./pub
```

Operating the recorder (sa-east-1):

```sh
aws logs tail /apuracao26/recorder --region sa-east-1 --follow | grep -v '"_aws"'
aws s3 ls s3://apuracao26-raw-860897618882/raw/v1/sha256/ --recursive | wc -l   # stored versions
ALERT_EMAIL=… pnpm --filter @apuracao/infra exec cdk deploy RecorderStack       # redeploy
```


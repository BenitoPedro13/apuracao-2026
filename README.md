# Apuração 2026

A live vote-count dashboard for Brazil's 2026 elections, built on the TSE's official results
feed. It records every published version of every file, so the count can be replayed
minute by minute.

**Status:** the recorder is live on AWS (2026-10-08). It captured the 1st round, soaks
against the TSE CDN, and will discover the 2nd-round files by itself. The projector (S3
mode) folds that log into the published views (`docs/tasks/TASK-projector-and-views.md`).
Next: the public CDN and the Kafka log (Phase 2).
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
node apps/fake-tse/dist/main.js 8080 60                   # the real samples, with TSE CDN semantics
```

Layout: `apps/{recorder,projector,fake-tse}`, `packages/{contracts,tse,views,s3kit,config}`,
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


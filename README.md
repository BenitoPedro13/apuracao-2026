# Apuração 2026

A live vote-count dashboard for Brazil's 2026 elections, built on the TSE's official results
feed. It records every published version of every file, so the count can be replayed
minute by minute.

**Status:** monorepo scaffolded (2026-10-07); the packages are empty shells. Next: Phase 0
part 2, contracts and TSE parsing. AWS bootstrap is waiting on `aws login`.
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
docker compose -f infra/docker-compose.yml up -d --wait   # local Redpanda (Kafka API)
```

Layout: `apps/{recorder,projector,fake-tse}`, `packages/{contracts,tse,views,config}`,
`infra/` (AWS CDK app: see [`infra/README.md`](infra/README.md)). Environment variables
are listed in [`.env.example`](.env.example).


# Apuração 2026

A live vote-count dashboard for Brazil's 2026 elections, built on the TSE's official results
feed. It records every published version of every file, so the count can be replayed
minute by minute.

**Status:** architecture proposed (2026-10-07), awaiting sign-off. No code yet. Next: Phase 0
of the implementation plan (monorepo scaffold, contracts, TSE parsing).
**Deadline:** 2nd round, Sunday 2026-10-25.

- What we know about the data: [`docs/research/01-tse-results-feed.md`](docs/research/01-tse-results-feed.md),
  [`docs/research/02-signatures-cache-and-map-mesh.md`](docs/research/02-signatures-cache-and-map-mesh.md)
- The system design: [`docs/architecture.md`](docs/architecture.md)
- The build order to 2026-10-25: [`docs/tasks/TASK-implementation-plan.md`](docs/tasks/TASK-implementation-plan.md)
- How to work in this repo: [`CLAUDE.md`](CLAUDE.md)

Planned stack: TypeScript monorepo (pnpm + Turborepo) on AWS sa-east-1: a Fargate recorder
writing the TSE's signed `.jws` files to S3, Amazon MSK (Kafka), a projector publishing
immutable views to S3 + CloudFront, and a Next.js static dashboard.

# infra

AWS CDK app for Apuração 2026 (sa-east-1), plus the local docker compose stack.

Stacks today:

- `BudgetStack`: one calendar-year cost budget ($100 credit, measured before credits) that
  emails `ALERT_EMAIL` at $60 and $85 of actual spend.
- `RawStack`: the raw log bucket `apuracao26-raw-<account>` (Object Lock, retained).
- `RecorderStack`: VPC (public subnets, no NAT, S3 gateway endpoint), ECS cluster, the
  recorder service, the `apuracao26-alerts` topic and its alarms. Exports the cluster to
  `ProjectorStack`.
- `PublicStack`: the public bucket `apuracao26-pub-<account>` (private, unversioned,
  retained) behind one CloudFront distribution: OAC, Origin Shield in sa-east-1, Price
  Class All, `CachingOptimized` honouring each object's own `Cache-Control`, error caching
  TTL 0 (`docs/tasks/TASK-public-cdn.md`).
- `ProjectorStack`: the projector on Fargate ARM (0.5 vCPU / 1 GB), S3 mode. **0 tasks unless
  `-c projector=on`** (nothing bills by the hour before it has a job). Context `elections`
  (default `president=6258,governor=6260`), `epoch` (default `2t-1`) and `promote`
  (`true` replaces the 1st-round seed's pointer: the runbook switch when `6258` appears).

The `night` context (`on|off`, default `off` in `cdk.json`) will gate MSK and the standbys
from Phase 2 (`docs/architecture.md` §11.1). It is unused for now.

## Commands (from the repo root)

```sh
pnpm --filter @apuracao/infra test                                   # template assertions
pnpm --filter @apuracao/infra exec cdk synth BudgetStack
pnpm --filter @apuracao/infra exec cdk bootstrap aws://<account>/sa-east-1
ALERT_EMAIL=you@example.com pnpm --filter @apuracao/infra exec cdk deploy BudgetStack
ALERT_EMAIL=… pnpm --filter @apuracao/infra exec cdk deploy PublicStack
ALERT_EMAIL=… pnpm --filter @apuracao/infra exec cdk deploy ProjectorStack -c projector=on   # from 10-18
ALERT_EMAIL=… pnpm --filter @apuracao/infra exec cdk deploy ProjectorStack -c projector=on -c promote=true   # when 6258 appears

docker compose -f infra/docker-compose.yml up -d                     # Redpanda + RustFS
docker compose -f infra/docker-compose.yml down -v
```

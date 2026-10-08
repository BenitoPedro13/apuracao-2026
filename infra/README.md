# infra

AWS CDK app for Apuração 2026 (sa-east-1), plus the local docker compose stack.

Stacks today:

- `BudgetStack`: one calendar-year cost budget ($100 credit, measured before credits) that
  emails `ALERT_EMAIL` at $60 and $85 of actual spend.

The `night` context (`on|off`, default `off` in `cdk.json`) will gate MSK and the standbys
from Phase 2 (`docs/architecture.md` §11.1). It is unused for now.

## Commands (from the repo root)

```sh
pnpm --filter @apuracao/infra test                                   # template assertions
pnpm --filter @apuracao/infra exec cdk synth BudgetStack
pnpm --filter @apuracao/infra exec cdk bootstrap aws://<account>/sa-east-1
ALERT_EMAIL=you@example.com pnpm --filter @apuracao/infra exec cdk deploy BudgetStack

docker compose -f infra/docker-compose.yml up -d                     # Redpanda + MinIO
docker compose -f infra/docker-compose.yml down -v
```

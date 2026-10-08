# TASK: Scaffold the monorepo (Phase 0, part 1)

**Status (2026-10-07): done.** Deviations from the plan are in §6.

Phase 0 of `TASK-implementation-plan.md`, must be done by **Thu 2026-10-08**. Part 2 is
`TASK-contracts-and-tse-parsing.md` (written after this one lands).

## 1. Current scenario

The architecture was signed off on 2026-10-07 (`architecture.md` §15). The repo holds only
docs and the captured samples. There is no `package.json`, no workspace, no CI and no AWS
infrastructure. The AWS CLI (2.37.4) is installed, but its session has expired
(`aws sts get-caller-identity` → "Your session has expired"). CDK has never been
bootstrapped in sa-east-1, and no AWS Budget exists, so the $100 credit has no guardrail yet.

Local toolchain, checked today: Node 24.19.0, pnpm 11.21.0. Current npm versions, checked
today: `create-turbo`/`turbo` 2.11.7, `aws-cdk` 2.1145.0, `aws-cdk-lib` 2.272.0, `zod`
4.6.5, `next` 16.4.0, `typescript` 7.0.2, `vitest` 5.0.3.

What this blocks: everything. Phase 1 (the recorder, gate 10-11) needs a workspace to live
in, `packages/tse` to build URLs, and a bootstrapped CDK environment to deploy to.

## 2. Planned changes

In order. Every step uses the official generator, and nothing is hand-written that a
generator covers.

1. **Turborepo scaffold.** Run `pnpm dlx create-turbo@latest . --package-manager pnpm` (or
   in a temp dir, then move the files in if it refuses a non-empty directory). Delete the
   example `apps/docs` and `apps/web` and the example `packages/ui`. Keep
   `packages/typescript-config` and `packages/eslint-config`, renamed into
   `packages/config` (one package, as the layout in CLAUDE.md §4 says). Root scripts:
   `build`, `lint`, `typecheck`, `test`, `format`, all delegated through `turbo run`.
   `turbo.json` tasks: `build` (outputs `dist/**`), `typecheck`, `lint`, `test` (dependsOn
   `^build`).
2. **Empty packages and apps** with `package.json`, `tsconfig.json` (extends
   `@apuracao/config`), `src/index.ts`, and a Vitest smoke test, so the pipeline runs end to
   end. Packages: `packages/contracts`, `packages/tse`, `packages/views`. Apps:
   `apps/recorder`, `apps/projector`, `apps/fake-tse`. Scope `@apuracao/*`, ESM
   (`"type": "module"`), Node 24 (`engines`).
   `apps/web` is **not** created here. It comes from `pnpm create next-app@latest` in
   Phase 3 (`TASK-web-shell-and-data-hooks.md`), so it gets the generator's current
   defaults on the day it's needed.
3. **Testing:** Vitest 5 in each package, with a root `vitest.config.ts` using
   `projects`. `[VERIFY: Vitest 5's workspace/projects config key at vitest.dev before
   writing it]`.
4. **TypeScript 7.** `latest` is now 7.0.2 (the native compiler). Use it for
   `typecheck` (`tsc --noEmit`) if typescript-eslint and the CDK's toolchain accept it.
   `[VERIFY: typescript-eslint's supported TS range, and that cdk synth runs under TS 7]`.
   If either refuses, pin the newest 6.x everywhere (one version across the workspace) and
   record why in CLAUDE.md.
5. **CDK app in `infra/`.** Run `cdk init app --language typescript` (via `pnpm dlx
   aws-cdk@latest`), then convert it to a pnpm workspace member. One stack for now,
   `BudgetStack`, holding **two AWS Budgets on actual cost: $60 and $85** (of the $100
   credit, `architecture.md` §15 Q1), emailing designmainnet@gmail.com. No other resources.
   The `night=on|off` context switch is declared in `cdk.json` but unused until Phase 2.
   Note: budgets on *actual* cost track usage before credits are applied
   `[VERIFY: whether a cost budget counts credits by default, and set "exclude credits"
   so it measures what the credit is paying for]`.
6. **`infra/docker-compose.yml`** with Redpanda and MinIO, pinned to exact image tags
   `[VERIFY: current stable tags on Docker Hub / redpanda.com]`, for local development.
   Not used until Phase 1/2, but it costs nothing and unblocks testcontainers.
7. **CI:** `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` and
   `pnpm turbo run lint typecheck test build` on Node 24. There's no deploy job yet.
8. **Repo hygiene:** `.gitignore` (node_modules, dist, cdk.out, .turbo, `.env*` except
   `.env.example`), an empty `.env.example`, Prettier from the scaffold.
9. **AWS (needs the user):** the user runs `! aws login`, then
   `pnpm --filter infra exec cdk bootstrap aws://<account>/sa-east-1` and
   `cdk deploy BudgetStack`. Both are free. Bootstrap creates an S3 staging bucket and
   IAM roles that cost cents.

**Alternatives considered and rejected:**

- *Nx instead of Turborepo:* rejected because the architecture already chose Turborepo
  (CLAUDE.md stack table), and it's lighter.
- *Keep separate `typescript-config` and `eslint-config` packages from the scaffold:*
  rejected in favour of the single `packages/config` that CLAUDE.md §4 describes, so there
  is one place for shared config.
- *Create `apps/web` now:* rejected. It's three phases away, and creating it later gets
  the generator's current output.
- *Budgets by hand in the console:* rejected. Infrastructure lives in CDK, so it's
  reviewable and reproducible.

## 3. Why

It unblocks Phase 0 part 2 (contracts and `.jws` verification) and Phase 1 (the recorder,
gate 10-11). The budget alarms go first because from 10-11 something bills every hour, and
the credit is $100 against a plan of ≈ $40 + $0–15. Cost: about half a day, and ~$0 of AWS.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json` | new | from `create-turbo` |
| `packages/config/` | new | tsconfig bases (node, library) + eslint flat config + prettier |
| `packages/{contracts,tse,views}/` | new | empty packages with a smoke test |
| `apps/{recorder,projector,fake-tse}/` | new | empty apps with a smoke test |
| `vitest.config.ts` | new | root projects config |
| `infra/` | new | `cdk init` output + `BudgetStack` + `docker-compose.yml` |
| `.github/workflows/ci.yml` | new | lint, typecheck, test, build |
| `.gitignore`, `.env.example` | new | |
| `CLAUDE.md` | edit | status line; stack table versions (TS, Vitest, CDK) if they differ |
| `README.md` | edit | status, setup (`pnpm install`, `pnpm turbo run test`), scripts |

## 5. Verification

1. `pnpm install --frozen-lockfile` on a clean clone succeeds.
2. `pnpm turbo run lint typecheck test build` exits 0. Six packages/apps run a test each
   (6 passing smoke tests). A second run reports `FULL TURBO` (cache hits).
3. `pnpm --filter infra exec cdk synth BudgetStack` emits two `AWS::Budgets::Budget`
   resources with limits 60 and 85 USD and an email subscriber.
4. `docker compose -f infra/docker-compose.yml up -d` gives a Redpanda broker that answers
   `rpk cluster info` and MinIO healthy on :9000. Then `down`.
5. After the user's `aws login`: `cdk bootstrap` succeeds; `cdk deploy BudgetStack`
   succeeds; `aws budgets describe-budgets --account-id <id>` lists both budgets.
6. CI goes green on the pushed commit (if a GitHub remote exists; there's none today).

## 6. Outcome and deviations (2026-10-07)

Verification 1–4 pass: a frozen-lockfile install; `pnpm turbo run lint check-types test
build` runs 28/28 tasks and then `FULL TURBO` (28 cached); the synth emits one
`AWS::Budgets::Budget` (100 USD, ANNUALLY, `IncludeCredit: false`, ACTUAL alerts at 60 and
85); Redpanda v26.2.4 is healthy (`rpk cluster info` shows 1 broker). Verification 5 passes:
`cdk bootstrap aws://860897618882/sa-east-1` succeeded; `cdk deploy BudgetStack` succeeded;
`aws budgets describe-budgets` lists `apuracao26-credit` (100 USD, ANNUALLY,
IncludeCredit false, actual spend so far in 2026 $3.19) with ACTUAL notifications at 60 and
85. The budget is account-wide, so other projects' spend in this account (e.g.
`renewable-pulse`, which has its own $20/month budget) counts toward it. Verification 6
waits on a GitHub remote.

Deviations, each recorded in CLAUDE.md "Toolchain quirks" where it's a lasting rule:

- **TS 7 confirmed** for the whole repo: both `create-turbo` and `cdk init` generate
  `typescript@7.0.2`. typescript-eslint doesn't support TS 7 (peer `<6.1.0`), so ESLint
  parses TS with Babel, as the generator does. `no-undef`/`no-unused-vars` are off for `.ts`,
  and `tsc` enforces `noUnusedLocals`/`noUnusedParameters` instead. The generator's ESLint
  base had no `files` glob for `.ts` and silently linted nothing, so one was added.
- **The task is named `check-types`, not `typecheck`** (the generator's name).
- **No root Vitest `projects` config.** Turbo already runs `vitest run` per package, so a
  root config would be a second orchestrator.
- **One budget instead of two:** a single annual $100 cost budget with two notifications
  ($60, $85). It's the same alerts with one resource. The alert address comes from
  `ALERT_EMAIL` (required on every synth, so a deploy can't go out with a placeholder) and
  isn't committed.
- **CDK is Vitest, not Jest** (one test runner in the repo). `aws-cdk` is pinned to
  2.1144.0, because 2.1145.0 is younger than pnpm 11's `minimumReleaseAge`.
- **MinIO dropped from compose:** `minio/minio` can't be pulled from Docker Hub or quay.io.
  The S3 emulator is chosen in `TASK-recorder.md`, tested against `If-None-Match: *` and
  `If-Match` writes.
- **The `esbuild` build script is allowed** (`allowBuilds` in `pnpm-workspace.yaml`),
  because `tsx` needs it to run the CDK app.


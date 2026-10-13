# TASK: deploy the site from CI on every green push to main

Asked for by the user on 2026-10-13 ("podemos fazer deploy automático com CI?", "não quero ter
que rodar comandos sempre que atualizar"). Until now every site update ended with the user
typing `! node scripts/deploy-web.ts`, because Claude's own AWS access to the public bucket is
(deliberately) blocked.

## 1. Current scenario

- `.github/workflows/ci.yml` runs `pnpm turbo run lint check-types test build` on every push to
  `main` and on pull requests. It builds `apps/web/out/` and throws it away.
- `scripts/deploy-web.ts` uploads that export to `apuracao26-pub-860897618882` (hashed assets
  first, immutable; then HTML/payloads with `max-age=60`), never deletes, refuses anything under
  `data/`, and compares the pointer's ETag before and after. It needs AWS credentials (`aws
  login` on the user's machine).
- The workflow has no AWS identity, no `id-token` permission and no deploy job. There is no
  GitHub OIDC provider or deploy role in `infra/` (CDK stacks: Budget, Raw, Recorder, Public,
  Projector). `[VERIFY: aws iam list-open-id-connect-providers: an account holds one provider per
  URL, so if token.actions.githubusercontent.com already exists, the stack imports it]`.
- The repo is `github.com/BenitoPedro13/apuracao-2026`; the plan-B bucket serves the site
  (`TASK-public-cdn.md` §8).

## 2. Planned changes

### 2.1 `infra/lib/ci-stack.ts` (new): a role GitHub can assume, and nothing else

- `iam.OpenIdConnectProvider` for `https://token.actions.githubusercontent.com`, client id
  `sts.amazonaws.com` (or `fromOpenIdConnectProviderArn` if §1's `[VERIFY]` finds one). No
  access keys are stored anywhere.
- Role `apuracao26-web-deploy`, trust policy conditioned on **exactly**
  `token.actions.githubusercontent.com:sub = repo:BenitoPedro13/apuracao-2026:ref:refs/heads/main`
  and `:aud = sts.amazonaws.com`. Pull requests (even from forks) and other branches can't
  assume it. Max session 1 hour.
- Permissions, least privilege for what `deploy-web.ts` does: `s3:PutObject` on
  `arn:…:apuracao26-pub-<account>/*`, `s3:GetObject` on `…/data/pointer*` only (the ETag check
  is a HEAD, which needs it), and an explicit **Deny** `s3:*` on `…/data/*` for writes. No
  `s3:DeleteObject`, no `s3:ListBucket`, nothing on the raw bucket, ECR, ECS or CDK.
- `bin/infra.ts` adds `new CiStack(app, 'CiStack', { env, pubBucket: pub.bucket, repo })`.
  Deployed once by the user (`cdk deploy CiStack`), like every other stack; it bills nothing.

### 2.2 `.github/workflows/ci.yml`: a `deploy` job after `check`

- `check` also uploads `apps/web/out` as an artifact (`actions/upload-artifact`), so the deploy
  ships **exactly the build that just passed lint, types and tests**, not a second build.
- `deploy`: `needs: check`; `if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  && vars.DEPLOY_WEB != 'off'`; `permissions: { id-token: write, contents: read }`;
  `concurrency: { group: deploy-web, cancel-in-progress: false }` (two pushes queue, never
  interleave). Steps: checkout, pnpm + Node 24.21.0 (as `check`), `pnpm install --frozen-lockfile
  --filter @apuracao/…` for what the script imports (`@apuracao/contracts`, the AWS SDK),
  download the artifact into `apps/web/out`, `aws-actions/configure-aws-credentials` with
  `role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}` (a repository *variable*: a role ARN isn't a
  secret), then `pnpm exec node scripts/deploy-web.ts --dry-run` and the real run.
- **Kill switch:** `DEPLOY_WEB=off` (a repository variable, one click or `gh variable set`)
  stops automatic deploys without a commit, e.g. to freeze the site on election night.
  `workflow_dispatch` lets a deploy be re-run by hand from the Actions tab.
- Pin the actions by major (`@v5`, as the file does today); `[VERIFY: current major of
  aws-actions/configure-aws-credentials and actions/upload-artifact against their releases]`.

### 2.3 Scope: the site only

Only `deploy-web.ts` moves to CI. **Not** moved, on purpose: `publish-epochs.ts` (writes the
election's views: a mistake there is a wrong number on the public page, invariant 1), the CDK
stacks, and the recorder/projector images. They stay hand-run and approved; this role couldn't
do them anyway.

### 2.4 Alternatives considered and rejected

- **A long-lived IAM user's access key in GitHub secrets:** the thing OIDC exists to avoid; a
  leaked key writes to the bucket until someone notices.
- **Letting Claude run the deploy:** blocked by design (production write); and the user wants it
  to happen without anyone typing.
- **Amplify / Vercel / CloudFront-side hosting for the site:** a different hosting decision,
  two weeks before the deadline, for a problem a 40-line workflow solves.
- **A second `next build` in the deploy job:** two builds can differ (env, cache); shipping the
  tested artifact removes the question.
- **Deploying only when `apps/web/**` changed:** the upload is idempotent and takes seconds;
  skipping logic is one more thing to get wrong. (Revisit if the run time matters.)
- **Required reviewers on a GitHub Environment:** brings back a manual click per deploy, which
  is what the user asked to drop. The kill switch covers the "freeze" case.

## 3. Why

Every push that passes the gate goes live in about a minute with no one at a terminal; the
live site can't drift from `main`. The risk is a bad commit reaching the public page: it
already can't merge red (the job needs `check`), the dry run catches content-type problems
first, the previous hashed assets stay in the bucket, and a rollback is `git revert` + push.
Cost: ~1 hour, $0 (OIDC and the role are free; Actions minutes are a few per push).

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `infra/lib/ci-stack.ts` | new | OIDC provider (or import) + `apuracao26-web-deploy` role |
| `infra/bin/infra.ts` | edit | `new CiStack(...)` |
| `infra/test/ci-stack.test.ts` | new | the trust condition, the allowed actions, the `data/*` deny |
| `.github/workflows/ci.yml` | edit | artifact upload, `deploy` job, kill switch |
| `scripts/deploy-web.ts` | edit | header comment: CI runs it; the pointer ETag note is non-fatal |
| `infra/README.md` | edit | `cdk deploy CiStack` once, `gh variable set AWS_DEPLOY_ROLE_ARN` |
| `README.md`, `CLAUDE.md` | edit | status: the site deploys from CI; what stays manual |
| `docs/architecture.md` | edit | §10.4 (deployment) |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green, including the new infra test against the
   synthesized template: the role's trust is exactly the `main` subject; no `Delete*`, no
   `ListBucket`; a Deny covers `data/*`.
2. Workflow syntax: `actionlint` over `.github/workflows/` (or the first run on a branch, where
   the deploy job is skipped by its `if`).
3. One-time, by the user: `cdk deploy CiStack`, then
   `gh variable set AWS_DEPLOY_ROLE_ARN --body <ARN from the stack output>`.
4. Push to `main`: `check` green → `deploy` runs; its log lists the same files as the local dry
   run and ends with "pointer ETag … unchanged"; `curl -sI` on `index.html` and a changed asset
   shows the new `last-modified`.
5. Negative: a push to a branch or a pull request doesn't start `deploy`; with
   `DEPLOY_WEB=off` a push to `main` skips it; the role refuses a `PutObject` under `data/`
   (`aws s3api put-object` with the assumed role in a one-off check).

## 6. Outcome (2026-10-13, built and verified locally; the one-time AWS setup is the user's)

Built as planned, with these differences (each found while building):

- **The freeze rule is enforced, not only the kill switch.** `architecture.md` §10.4 already
  said "no deploy between 2026-10-24 00:00 and 2026-10-26 12:00 BRT except via the runbook",
  and §2.2 would have let CI ignore it. The `deploy` job has a `freeze` step; inside the window
  the later steps are skipped and the job stays green (bounds checked at the second on both
  edges with GNU `date`). `workflow_dispatch` is frozen too: inside the window the runbook is
  the hand-run script.
- **The job is inert until `AWS_DEPLOY_ROLE_ARN` is set** (`vars.AWS_DEPLOY_ROLE_ARN != ''`
  in the job's `if`), so pushing this commit doesn't turn CI red before the role exists.
- **The pointer is `data/v1/latest.json`**, not the `data/pointer*` I first wrote: the role's
  only read is that exact key (a test pins it to the contracts' `POINTER_KEY` value's path).
- **`CiStack` doesn't depend on `PublicStack`:** the bucket is referenced by name
  (`apuracao26-pub-<account>`); a reference made CDK add a cross-stack output to `PublicStack`,
  which would have touched the stack that serves the site on `cdk deploy CiStack`.
- **`PutObject` is granted explicitly**, not with `grantPut()` (which adds retention,
  legal-hold and tagging actions the script doesn't use).
- **Install:** the job runs the full `pnpm install --frozen-lockfile` plus
  `turbo run build --filter=@apuracao/contracts` (the script imports it from `dist/`), not a
  filtered install. No provider existed in the account (`aws iam list-open-id-connect-providers`
  returned an empty list), so the stack creates it (`OidcProviderNative`, no Lambda).
- Action majors checked against their latest releases: `configure-aws-credentials@v6`,
  `upload-artifact@v7`, `download-artifact@v8`; the file's older `@v5` ones are unchanged.

Verified: `actionlint` clean; `infra` tests 17/17 (the trust is exactly the `main` subject,
the allowed actions are exactly `s3:PutObject` + `s3:GetObject`, the deny covers `data/*`, the
template has no `GetStackOutput`); `cdk synth CiStack`; the whole gate green.
**One-time setup, done by the user 2026-10-13:** `cdk deploy CiStack` (created the provider,
the role and its policy; nothing else changed) and `gh variable set AWS_DEPLOY_ROLE_ARN`. The
first push to `main` after that is §5 item 4.

### 6.1 First live run (2026-10-13): refused, and why

The first push after the setup failed in `configure-aws-credentials`:
`Not authorized to perform sts:AssumeRoleWithWebIdentity`, every retry. The trust condition
(§2.1) assumed the OIDC subject `repo:BenitoPedro13/apuracao-2026:ref:refs/heads/main`, but this
repository uses **immutable subjects** (`gh api repos/…/actions/oidc/customization/sub` →
`use_immutable_subject: true`, `sub_claim_prefix: repo:BenitoPedro13@74267887/apuracao-2026@1408788185`),
so its tokens carry the owner and repository IDs. §2.1's `[VERIFY]` covered the provider, not
the subject format; the local tests could only check the template against my own assumption.
Fix: `CiStack` takes the whole `subjectPrefix` (with how to read it in a comment) and the role
trusts `<prefix>:ref:refs/heads/main`. The IDs are the safer form: a repository deleted and
recreated under the same name doesn't inherit the trust. The `cdk diff` is that one condition.

### 6.2 Verified live (2026-10-13)

- **Run after the fix:** `check` and `deploy` green. The log shows `Authenticated as … :GitHubActions`,
  the dry run, then the real run: `53 immutable + 21 short-lived objects`, the pointer's ETag
  `fa06d220…` unchanged before and after. `index.html` and `historico.html` answer with
  `Last-Modified` 22:15:32 GMT (the run's upload); the archive's `og:image` is live.
- **What the role can and can't do** (`iam simulate-principal-policy` on the deployed role, read-only):
  `PutObject` on `index.html`, `historico/opengraph-image` and `_next/static/*` allowed;
  `GetObject` on `data/v1/latest.json` allowed; `PutObject` under `data/` **explicitDeny**;
  `GetObject` on any other `data/` key, `DeleteObject`, `ListBucket` and `PutObject` on the raw
  bucket all denied. (My first attempt looped in zsh, which doesn't word-split unquoted
  variables, so every case came back `implicitDeny`, `PutObject` on `index.html` included;
  the direct call said `allowed` and the loop was rerun under bash.)
- **Gate inert without the variable:** the push before `AWS_DEPLOY_ROLE_ARN` existed ran
  `check` green and `deploy` skipped.
- **Kill switch:** with `DEPLOY_WEB=off` set, a push to `main` ran `check` green and `deploy`
  skipped; the variable was then deleted and automatic deploys resumed.
- Not exercised live: the freeze window (its edges were checked with GNU `date`; the real
  window starts 2026-10-24) and the `pull_request` case (the job's `if` excludes it and the
  role's trust only accepts `refs/heads/main`).

# TASK: public bucket, CloudFront and the projector on Fargate (Phase 2)

Phase 2 of `TASK-implementation-plan.md` (done by Thu 2026-10-15; the primary projector runs
on Fargate from Sun 10-18). `architecture.md` §6.2 (public layout), §10.4 (deployment),
§11 (cost). `TASK-projector-and-views.md` left three things to this task: the public bucket,
CloudFront, and the projector's deploy.

## 1. Current scenario

- The projector publishes the views, manifests and pointer of `architecture.md` §6.2
  through a `Publisher`: `S3Publisher` (write-once `If-None-Match: *`, conditional pointer
  `If-Match`, the `Cache-Control` of §6.2 set on every object) or `DirPublisher` (local).
  It has only ever published to a directory. A rebuild of the real 1st-round log takes
  ~32 s from a laptop (`TASK-projector-and-views.md` §6, item 3).
- There is no public bucket, no CloudFront distribution, no projector image or service.
  The CDK app has `BudgetStack`, `RawStack` and `RecorderStack` (VPC with public subnets
  only, S3 gateway endpoint, ECS cluster, the `apuracao26-alerts` topic).
- Phase 3's web app (from Mon 10-12) is served from the same distribution, and needs real
  views behind it to develop against.

Facts this rests on, checked on 2026-10-08:

| Fact | Source |
|---|---|
| `CachingOptimized` (`658327ea-…`): min TTL 1 s, default 86,400 s, max 31,536,000 s; honours the origin's `Cache-Control`/`s-maxage` inside those bounds; no query strings or cookies in the key; gzip + brotli cached separately | [Managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html) |
| Error responses are cached for the **error caching minimum TTL (10 s by default)**, set per distribution (custom error responses), not per path. 404, 500, 502, 503, 504 are cached; 403 only with a `Cache-Control` header | [4xx/5xx handling](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/HTTPStatusCodes.html) |
| On an expired object, an origin 5xx makes CloudFront serve the stale copy; `stale-if-error` extends that (bounded by the max TTL) | same page; research 02 §7 |
| Origin Shield is offered in `sa-east-1`; for an origin in a Region that has it, enable it in that Region. Requests whose regional edge cache is in the Shield's Region skip it and aren't charged. GET/HEAD with a TTL < 3,600 s count as dynamic (always through the Shield) | [Origin Shield](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/origin-shield.html) |
| Origin Shield, South America: **$0.0160 per 10,000 requests** | [Pay-as-you-go pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| **Only Price Class All includes South American edge locations** (100 and 200 don't) | same page |
| `S3BucketOrigin.withOriginAccessControl(bucket, { originAccessLevels })` in `aws-cdk-lib` 2.272.0 (installed); OAI is legacy | `infra/node_modules/aws-cdk-lib/aws-cloudfront-origins/lib/s3-bucket-origin.d.ts` |
| Flat-rate plans: an existing distribution can subscribe; an upgrade takes effect immediately, prorated; a paid plan **requires an AWS WAF web ACL on the distribution** (included in the plan); a cancelled paid plan runs to the end of the billing cycle; Origin Shield is listed as a **Premium-tier** feature; OAI and legacy cache settings block subscribing (we use neither) | [Flat-rate plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html) |

## 2. Planned changes

### 2.1 `infra/lib/public-stack.ts` (new): bucket + distribution

- **Bucket `apuracao26-pub-${account}`** (not `apuracao26-pub`: S3 names are global, and
  the raw bucket already uses the account suffix). Private (`BLOCK_ALL`), SSE-S3,
  `enforceSSL`, **unversioned** (views are content-addressed and write-once; the pointer is
  the only mutable object and a rollback is a rewrite, `architecture.md` §10.3), retained on
  stack deletion. `refuseTestKeyInProduction` already matches `apuracao26-pub-*`.
- **Distribution:** one S3 origin with **OAC** (`READ` + `LIST`, so a missing key is a
  404, not a 403), **Origin Shield in `sa-east-1`**, Price Class All, HTTP/2 and 3,
  `redirect-to-https`, compression on, default root object `index.html`, default
  `*.cloudfront.net` hostname (ADR-9).
- **One cache policy for every path: `CachingOptimized`.** Every object carries its own
  `Cache-Control` from the publisher (pointer `s-maxage=5`, everything else immutable or
  `max-age=60` for HTML), and the policy honours it from 1 s up. Per-path behaviours would
  only restate the headers. The 1 s floor is fine: nothing we publish asks for less.
- **Error caching TTL 0 for 404 (and 403, 500, 502, 503, 504)**, distribution-wide. The
  architecture's "error TTL 0 on `/data/*`" can't be per path: CloudFront sets it per
  distribution. TTL 0 everywhere costs at most an origin GET per miss, which is the point.
  No custom error page now: the web task decides what a 404 shows.
- **No WAF, no real-time logs, no Lambda@Edge, no CloudFront Function.** A WAF is $5/month
  plus rules on pay-as-you-go, and comes bundled only if the flat-rate plan is bought (§2.5).
- Outputs: bucket name, distribution id and domain.

### 2.2 `apps/projector/Dockerfile` (new) and `infra/lib/projector-stack.ts` (new)

- The image mirrors `apps/recorder/Dockerfile` (`pnpm deploy --prod --legacy`, Node 24 slim,
  ARM64, `USER node`), with `CMD ["node", "dist/main.js", "run"]`.
- **Fargate ARM 0.5 vCPU / 1 GB** (`architecture.md` §11.1), in `RecorderStack`'s VPC and
  cluster (exported as stack properties; adds CloudFormation exports, changes no existing
  resource), public subnet with a public IP, no NAT.
- Environment: `RAW_BUCKET`, `PUB_BUCKET`, `AWS_REGION`, `ELECTIONS`, `EPOCH`; no
  `TSE_TEST_JWK_URL` (and the config would refuse it).
- **IAM, least privilege:** raw bucket `s3:GetObject` + `s3:ListBucket`, and `s3:PutObject`
  on `checkpoints/projector/*` and `lease/projector.json` only, so the projector can't touch
  `raw/`, `obs/` or the recorder's lease; public bucket `s3:GetObject`, `s3:PutObject`,
  `s3:ListBucket`.
- `desiredCount` from a context value `projector=on|off` (default `off`): nothing that bills
  by the hour runs before it has a job (`architecture.md` §11). It's switched on for the
  smoke test (§5 item 4), then from 10-18.
- Log group `/apuracao26/projector`, one month. Alarms are `TASK-observability.md`
  (Phase 4), except one now: **projector silent** (no `published` and no pointer refresh
  for 5 min) is left to that task too, because the projector doesn't emit EMF metrics yet.

### 2.3 `infra/bin/infra.ts`

`new PublicStack(...)`, `new ProjectorStack(...)` with the raw bucket, the public bucket,
and the recorder's VPC and cluster.

### 2.4 Seed: the 1st round's real final views, published once from a laptop

`projector rebuild --source s3 --epoch 1t-final --out s3://apuracao26-pub-<account>`
against the real raw log (~32 s, no compute running). That gives Phase 3 real views behind
CloudFront from day one, and it's the first end-to-end proof of the public path. Every
number is a real TSE number from a signed file (invariant 1); the manifest names the
elections (`6257`/`6259`), so the web app can label it as the 1st round.

### 2.5 The flat-rate cap (`architecture.md` §11.2), re-checked

The runbook step "switch on Pro reactively above 5k viewers" now has two known
prerequisites: a **WAF web ACL must be associated** at subscription (bundled in the plan),
and **Origin Shield may have to be disabled** (it's listed as Premium-only; the docs don't
say whether Pro refuses it or ignores it). Both are distribution updates that take minutes
to propagate. Still open, to verify before 10-15 with the console's subscribe dialog
(without confirming): `[VERIFY: whether AWS promotional credits pay for a flat-rate plan]`,
`[VERIFY: whether Pro can be subscribed with Origin Shield enabled]`. The architecture's
fallback stands: if subscribing can't be done in minutes, subscribe on 10-24 for $15.

### 2.6 Alternatives considered and rejected

- *Per-path cache behaviours with custom cache policies* (`/data/v1/latest.json` 5 s,
  `/data/v1/o/*` immutable, …): rejected. The objects already carry those headers, and the
  managed policy honours them; two sources of truth for one TTL is a way to get it wrong.
- *A separate VPC/cluster for the projector:* rejected. It duplicates a free VPC for no
  isolation gain (both tasks only talk to S3), and a second S3 gateway endpoint to manage.
- *Versioning on the public bucket:* rejected. Nothing in it is overwritten except the
  pointer, whose history is the manifests; versions would only accumulate pointer writes
  (one every ≤ 60 s).
- *OAI:* legacy, and it blocks the flat-rate plans.
- *Price Class 100/200 to save cost:* rejected. Neither includes South America, where every
  viewer is.
- *Running the projector now so the site is "live":* rejected. Its job starts 10-18; until
  then the seed (§2.4) serves the web task at $0.

## 3. Why

It's the whole fan-out design (`architecture.md` §6): readers only ever touch CloudFront,
which is what keeps invariant 5 true at any audience. It unblocks Phase 3 (a real URL with
real views), the k6 CDN load test (Phase 4), the canaries, and the dress rehearsal. Cost:
the bucket and an idle distribution cost cents; the projector is ~$0.034/h only while
switched on (≈ $6.50 for 10-18 → 10-26); Origin Shield ≈ $0 at the expected audience
(viewers in Brazil use the São Paulo regional edge cache, which is the Shield's Region, so
they skip it). ~1 day of work.

## 4. Affected files

| File | Change type | Notes |
|---|---|---|
| `infra/lib/public-stack.ts` | new | §2.1 |
| `infra/lib/projector-stack.ts` | new | §2.2 |
| `infra/lib/recorder-stack.ts` | edit | expose `vpc` and `cluster` (no resource change) |
| `infra/bin/infra.ts` | edit | §2.3 |
| `infra/test/public-stack.test.ts`, `infra/test/projector-stack.test.ts` | new | template assertions |
| `infra/cdk.json` | edit | `projector: "off"` context default |
| `apps/projector/Dockerfile` | new | §2.2 |
| `infra/README.md`, `README.md`, `.env.example` | edit | stacks, deploy commands, `PUB_BUCKET` value |
| `docs/architecture.md` §6.2, §10.4, §11.2 | edit | bucket name, error TTL is distribution-wide, the flat-rate prerequisites |

## 5. Verification

1. `pnpm turbo run lint check-types test build` green. Template assertions: the bucket
   blocks all public access and has no public policy; the distribution has exactly one
   origin with OAC and `OriginShield {Enabled: true, OriginShieldRegion: sa-east-1}`,
   `PriceClass_All`, cache policy `658327ea-f89d-4fab-a63d-7e88639e58f6`, compression on,
   `ErrorCachingMinTTL: 0` for 403/404/500/502/503/504, no WAF; the projector task is ARM64
   0.5 vCPU / 1 GB with `desiredCount` 0 under `projector=off`; its role has no
   `s3:PutObject` on the raw bucket outside `checkpoints/projector/*` and
   `lease/projector.json`.
2. `cdk deploy PublicStack`, then the seed (§2.4). Through `https://<id>.cloudfront.net`:
   - `/data/v1/latest.json` → 200, `cache-control` as published, `x-cache` a `Miss` then a
     `Hit` within 5 s, and a `Miss` again after > 5 s; `content-encoding` absent (0.6 KB is
     below CloudFront's 1,000-byte compression floor);
   - a view `/data/v1/o/{sha}.json` → 200, `content-encoding: br` with
     `accept-encoding: br`, `immutable`;
   - a missing key → 404 twice in a row, both `x-cache: Error from cloudfront`, i.e. the
     second didn't come from cache (TTL 0);
   - the bucket's own URL → 403 (no public access).
3. The seed's views equal the local real-log rebuild (`.replay/real/pub`) byte for byte
   (same view hashes; the manifests differ only in epoch).
4. `cdk deploy ProjectorStack -c projector=on` for one hour: the task acquires the lease,
   folds the real log, publishes to the public bucket under a new epoch (it doesn't move
   the `1t-final` pointer without `PROMOTE`: it logs `behind`/another epoch), checkpoints,
   and a forced stop + restart resumes from the checkpoint. CloudWatch shows no
   `projector loop error`. Then `projector=off`.
5. Cost check the next day in Cost Explorer: CloudFront, S3 and Fargate lines for 10-08/09
   under $0.50 together.

## 6. Decision (user, 2026-10-08): (a)

What the site shows **between 10-18 and the first 2nd-round file** (the projector's
`ELECTIONS` from 10-18):

- **(a) The 1st round's final result until 2nd-round files exist** (recommended; **chosen**). The
  `1t-final` seed stays the pointer; the projector runs with `ELECTIONS=president=6258,governor=6260`
  under epoch `2t-1` and is promoted (`PROMOTE=true`, the runbook's deliberate switch) when
  the recorder discovers `6258` (the `apuracao26-election-6258-live` alarm). The site is
  never empty, and every number is real.
- **(b) The 2nd round from 10-18:** the pointer moves to `2t-1` at once, and the site shows
  "não publicado" for a week. Simpler (no switch on the night), but an empty site for 7 days.

## 7. Outcome (in progress)

- **Blocked on AWS (2026-10-08):** the first `cdk deploy PublicStack` failed creating the
  distribution: *"Your account must be verified before you can add new CloudFront
  resources. To verify your account, please contact AWS Support … (Status Code: 403,
  Request ID: dfd7877b-8ba8-42df-ab60-7f480c1f456c)"*. The stack rolled back; the retained
  (empty) bucket and the `ROLLBACK_COMPLETE` stack were deleted, so the retry is one
  `cdk deploy PublicStack`. A support case is needed (user). Until it's resolved, nothing in
  this task can deploy (`ProjectorStack` references the public bucket). The web task can
  develop against a local `PUB_DIR` (`.replay/real/pub` holds the real 1st-round views).
- Done and verified locally: template assertions (10/10 infra tests), lint, types, all five
  stacks synthesize; `RecorderStack`'s resources are unchanged except the image hash (its
  code changed in `ac18a9c`); the Docker context is 788 KB (was 1.5 GB with `.capture/` and
  `.replay/`).

## 8. Plan B: S3 directly over HTTPS until CloudFront is verified (user, 2026-10-08)

The support case is open. Until AWS verifies the account, readers fetch straight from the
bucket's REST endpoint, `https://apuracao26-pub-<account>.s3.sa-east-1.amazonaws.com/`
(HTTPS, in São Paulo). CloudFront goes in front of the same bucket later; only the base
URL changes.

### 8.1 Changes

- **`infra/lib/public-stack.ts`:** the distribution only with context `cdn=on` (default
  `off` while blocked). With `cdn=off`: a bucket policy allowing anonymous `s3:GetObject`
  on every object (no `ListBucket`, so a missing key is a 403 to readers, and writes stay
  the projector's only); `blockPublicAccess` relaxed for policies only (`BLOCK_ACLS`
  stays); a CORS rule allowing `GET`/`HEAD` from any origin (data is public; lets the web
  app run from `localhost` against real data). With `cdn=on` the bucket goes private again
  behind OAC, as in §2.1.
- **`apps/projector/src/publisher.ts`, `S3Publisher`:** views and manifests are stored
  **gzipped** (`Content-Encoding: gzip`, level 9). S3 doesn't compress, and CloudFront did;
  browsers decode transparently. Keys and hashes stay those of the uncompressed canonical
  JSON (content addressing is unchanged, so a rebuild still compares byte for byte);
  `getBytes` gunzips. The pointer stays uncompressed (0.6 KB). `DirPublisher` unchanged.
- **The web app** (Phase 3, recorded here so it isn't lost): the data base URL is
  configuration; `/` doesn't serve `index.html` on the REST endpoint, so the entry URL is
  `/index.html` until CloudFront; the client keeps the last good data on errors and backs
  off (the browser's stand-in for `stale-if-error`).
- **Cost cap:** S3 has no flat-rate plan. The Budget alarms ($60/$85) stay; the runbook's
  lever is raising `pollSeconds` (one pointer write). At ~100 viewers the night costs
  ~$0.06 (sa-east-1: GET $0.56 per million, transfer out $0.15/GB after the free 100 GB,
  AWS Price List API, 2026-10-08).
- **Not here:** request collapsing and edge caching don't exist without CloudFront; the
  50k design peak waits for it (the pointer alone would be ~2,500 GET/s on one key).

### 8.2 Verification

1. Template tests: `cdn=off` → no distribution, a policy whose only `Allow` to `*` is
   `s3:GetObject`, ACLs still blocked, CORS GET/HEAD; `cdn=on` → §5 item 1 unchanged.
   `S3Publisher` against RustFS: a view is stored with `Content-Encoding: gzip`, its key is
   the sha256 of the uncompressed bytes, `getBytes` returns the uncompressed bytes.
2. `cdk deploy PublicStack` (cdn=off), then the seed (§2.4). Over HTTPS, anonymously:
   `latest.json` 200 with the published `Cache-Control`; a view 200 with
   `content-encoding: gzip` that `curl --compressed` decodes to bytes whose sha256 is its
   key; a missing key 403; a `PUT` 403; a `?list-type=2` listing 403.
3. The seed's views equal the local real-log rebuild (`.replay/real/pub`), as §5 item 3.

### 8.3 Outcome (2026-10-08)

Plan B is live: `https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/`.
`cdk deploy PublicStack` (cdn=off) in 36.8 s; the seed (`rebuild --epoch 1t-final`)
in 35.8 s: `seq` 11,387, 114 views, 0 rejected, reconciliation 56/56 sums equal.
Anonymously over HTTPS: `data/v1/latest.json` 200 with the §6.2 `Cache-Control`
(epoch `1t-final`, TSE totalizedAt 05/10 12:51:05); the national view 200,
`content-encoding: gzip`, `immutable`, and its decoded sha256 equals its key; a missing
key, an anonymous `PUT` and a listing are all 403. The 114 published view hashes equal the
local real-log rebuild's (`.replay/real/pub`). Template tests 11/11; full suite 34/34
(projector 14 tests, with the gzip one against RustFS). CloudFront (`cdn=on`) and the
projector on Fargate wait for the support case.

## 9. The projector on Fargate, smoke test without CloudFront (2026-10-09)

### 9.1 Current scenario

`ProjectorStack` has never been deployed. §7 held it back for the support case, but it only
depends on the public bucket, which exists since plan B (§8.3). Not running the projector
before 10-18 is by design (§2.6, §6 decision (a)): the 1st round is final, and the
`1t-final` seed is what the site shows. What's missing is §5 item 4: no proof yet that the
image, the role, the lease and the checkpoints work **on Fargate** against the real log. If
that breaks, better to find out on 10-10 than on 10-18.

### 9.2 Planned changes

No code changes expected. Context values only:

- `cdk deploy ProjectorStack -c projector=on -c elections=president=6257,governor=6259
  -c epoch=smoke-1t --exclusively` (no `promote`), with `ALERT_EMAIL` set as for every
  synth. The user runs it (an outward-facing deploy); I run `cdk diff` first.
- **`--exclusively` is required.** Without it CDK deploys the dependencies too, and
  `cdk diff` (10-09) shows `RecorderStack`'s task definition being **replaced** (a new
  image hash: the Docker context is the repo root, which changed since the recorder's last
  deploy). That would restart the recorder for no reason. `RawStack` and `PublicStack`
  show no differences; the exports `ProjectorStack` imports already exist.
- Epoch `smoke-1t`, not `2t-1`: `2t-1` is the night's, and a checkpoint left under it
  would be restored on 10-18. `6257/6259`, not `6258/6260`: the 2nd-round files don't
  exist, so the night's elections would fold nothing and prove nothing.
- The pointer stays `1t-final`: without `PROMOTE`, `advancePointer` returns `behind` for
  another epoch (`projector.ts:157`), on every publish and every 60 s refresh.
- After the test, `-c projector=on` is dropped (`desiredCount` 0); the stack stays, so
  10-18 is one deploy.
- Leftovers, kept on purpose: manifests under `data/v1/smoke-1t/m/` in the public bucket
  (no reader looks there; `epochs.json` doesn't list it) and checkpoints under
  `checkpoints/projector/smoke-1t/` in the raw bucket (not Object Locked). They are the
  evidence of the run.

Rejected: *a new task doc*: this is §5 item 4 of this one. *Running it with `2t-1` and
`6258/6260` as on the night*: tests the startup only, and leaves the night's epoch dirty.
*Waiting for CloudFront*: the projector never talks to CloudFront.

### 9.3 Why

It's the last piece of the night's pipeline that has never run in production. Cost: ~1 h
of Fargate ARM 0.5 vCPU / 1 GB ≈ $0.04, plus S3 requests (a full fold is ~12k blob GETs ≈
$0.01).

### 9.4 Affected files

| File | Change type | Notes |
|---|---|---|
| `docs/tasks/TASK-public-cdn.md` | edit | this section and its outcome |
| `README.md`, `CLAUDE.md` status | edit | only if the outcome changes what's live |
| `infra/*`, `apps/projector/*` | none expected | a fix found by the test gets its own note here |

### 9.5 Verification

1. `cdk diff ProjectorStack` with the context above: only new resources (task definition,
   service, two roles and their policies, log group, security group); the task role's S3
   statements are exactly those of §2.2. **Done 10-09: as expected.** After the deploy,
   `RecorderStack`'s task definition revision is still `:4`.
2. In `/apuracao26/projector` within 5 min of the deploy: `projector started` with
   `epoch: smoke-1t`, `no checkpoint: folding the log from the start`, then `published`
   lines with `pointer: "behind"`, and `checkpoint` lines; no `projector loop error`.
3. Once caught up (no new `published` for 2 min), the newest `smoke-1t` manifest's `views`
   map equals the `1t-final` manifest's map, view by view (same sha256: the Fargate fold
   is byte-identical to the laptop's). A difference is explained by a TSE version
   accepted after the 10-09 re-seed, or it's a bug.
4. `https://apuracao26-pub-860897618882.s3.sa-east-1.amazonaws.com/data/v1/latest.json`
   still says `epoch: "1t-final"`, same `manifest` as before the deploy.
5. `aws ecs stop-task` on the running task: the service starts a new one, which logs
   `restored checkpoint` (not a fold from the start) and publishes again within 60 s of
   starting; the lease generation in `lease/projector.json` went up by 1.
6. Deploy again without `projector=on`: the service at 0 tasks. The next day, Cost
   Explorer's Fargate line for 10-10 under $0.10.

### 9.6 Outcome (2026-10-09)

The projector runs on Fargate. `cdk deploy ProjectorStack --exclusively` in 241.7 s (the
first try stopped at CDK's IAM approval prompt, which `!` can't answer: the deploy needs
`--require-approval never` after the diff has been reviewed).

1. Diff as expected; `RecorderStack` still on task definition `:4` after the deploy.
2. 06:21:25 UTC `lease acquired` (generation 1), `projector started` (`smoke-1t`,
   `6257`/`6259`), `no checkpoint: folding the log from the start`; caught up at
   06:22:54 (**89 s** for the whole real log on 0.5 vCPU), `seq` 11,468, 198 views,
   `pointer: "behind"`, reconcile `identityFailures: 0`. No `projector loop error`.
3. **197 of 198 views byte-identical to `1t-final`.** The one that differs is
   `municipalities/president/zz`, one field: Rabat (`mu` 30406, `Africa/Casablanca`)
   `totalizedAt` `…12:51:05+00:00` on Fargate, `+01:00` in `1t-final`. Cause: the IANA
   time-zone data inside Node. The laptop's Node 24.19.0 carries tzdata **2026b**; the
   image's `node:24-slim` is Node 24.21.0 with **2026c**, whose release note reads
   *"Morocco moves to permanent +00 on 2026-09-20"*
   ([tzdb NEWS](https://data.iana.org/time-zones/tzdb/NEWS)). **Fargate is right;
   the published `1t-final` has Rabat's time one hour off** (a timestamp, not a count).
   The deeper defect: view bytes depend on the runtime's tzdata, so "a rebuild is
   byte-identical" only holds on the same Node version. Follow-up below.
4. `latest.json` stayed `1t-final`, manifest `d6e1a951…`, throughout.
5. `aws ecs stop-task` at 06:26:06: SIGTERM → `checkpoint`
   (`checkpoints/projector/smoke-1t/000000011468.json.gz`) → lease handed over. The new
   task: `lease acquired` generation 2 at 06:26:56, `restored checkpoint` 0.5 s later
   (11,468 paths, no refold), `published` the **same manifest** (`a7967e46…`) 2.3 s
   after that. Note: a checkpoint is written every 50 publishes or on SIGTERM, so a hard
   crash after a cold start refolds from zero (89 s today); acceptable, recorded for the
   runbook.
6. Switched off (`cdk deploy ProjectorStack --exclusively`): the service at 0/0 on task
   definition `:2` (the defaults `2t-1`, `6258`/`6260`, ready for 10-18); the recorder still
   1/1 on `:4`; the pointer unchanged. Cost check on 10-10.

**Follow-up: tzdata.** Needs its own plan before code (CLAUDE.md §1): pin the Node
version (and so the tzdata) identically for the laptop, CI and the images, and have the
projector refuse to start on tzdata older than 2026c; then re-seed `1t-final` with the
right offset. The re-seed can't reuse `1t-final`'s `seq` 11,468 (manifests are
write-once and the bytes differ), so it needs a new epoch name and an `epochs.json`
update.

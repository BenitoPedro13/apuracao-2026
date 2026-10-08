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

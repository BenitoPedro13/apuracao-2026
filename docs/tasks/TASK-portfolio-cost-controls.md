# TASK — Post-election archive and portfolio cost controls

## 1. Current scenario
Approved by the user on 2026-10-29 after the read-only AWS review. RecorderStack and ProjectorStack each maintain one Fargate task. Published national second-round results are final. October 26–28 gross costs averaged $5.53/day, predominantly São Paulo S3 requests and Fargate. Raw records and public snapshots must remain intact; no bucket, object, signature, or replay is deleted.

## 2. Planned changes
1. Save deployed templates, service settings and budgets outside Git. Download and hash-verify both rounds' published manifests and referenced views; check result statuses.
2. Gracefully scale the recorder to zero, let the projector drain, then scale it to zero. Persist the change using reviewed CloudFormation change sets of the existing templates; leave task definitions, IAM, networking, buckets and public hosting intact. Disable collection-specific alarm actions for the archived state.
3. Add recorder running/off configuration with off by default in CDK; preserve explicit on for intentional collection. Ensure recorder alarms follow the running state. Keep projector off by default. Record actual operation results and rollback.
4. Correct project budget scope and activate a consistent cost allocation tag after checking current resource tag keys. Preserve account-total and existing alert recipients/thresholds. Keep the annual account-wide credit-usage guardrail clearly documented.
5. Verify published views and the live dashboard after shutdown; record commands and evidence.
Alternatives: deleting stacks risks losing retained artifact references; direct task stopping alone restarts tasks; direct desired-count changes alone leave CloudFormation drift. Neither is sufficient.

## 3. Why
Retain the portfolio's public results and reproducible immutable history while removing continuous work after the election. Preserve the small live Renewable Pulse and Transit Pulse backends. No paid-plan upgrade, resource deletion, new commitments, or change to UniMeet production.

## 4. Affected files
| File | Change |
|---|---|
| infra/bin/infra.ts | Pass explicit recorder running context |
| infra/cdk.json | Recorder off by default |
| infra/lib/recorder-stack.ts | Desired count and alarm actions follow running state |
| infra/test/recorder-stack.test.ts | Verify active and archived modes |
| infra/test/projector-stack.test.ts | Pass recorder state explicitly |
| README.md, CLAUDE.md, infra/README.md, docs/architecture.md | Archive status and operating instructions |
| docs/tasks/TASK-portfolio-cost-controls.md | Plan and measured completion evidence |

## 5. Verification
- Account identity is 860897618882; Free plan stays ACTIVE.
- Both rounds' referenced files download successfully and match their SHA-256 hashes.
- All changes in each reviewed change set are limited to desired task count, alarm actions and explanatory metadata; no replacements or removals.
- ECS reports desired/running/pending counts all zero after each graceful stop.
- Projector checkpoint exists and public result pointers remain valid.
- Public dashboard, history, timeline and immutable view URLs remain available.
- CDK infrastructure tests, typecheck and lint pass; build/check commands relevant to the infra change pass.
- Budget filters and tag activation are verified by readback; historical costs may remain unallocated until a supported backfill completes.

## Results (2026-10-29)
- Local snapshot: two manifests and 272 unique SHA-256-verified views; 85 final result views and
  seven not_published governor views, preserved explicitly.
- Recorder archive change set: only DesiredCount 1 -> 0 and three ActionsEnabled false.
- Projector archive change set: only DesiredCount 1 -> 0. No replacements or removals.
- Recorder stopped 11:13:05 UTC, projector 11:19:54 UTC, both container exit codes 0.
- Final projector checkpoint at 11:19:13 UTC, seq 60888 under epoch 2t-2.
- Focused infra tests: 7 passed; infra typecheck and lint passed.
- Existing Project/project cost tags activated; Renewable Pulse filter corrected to its actual
  Project tag. Historical tag backfill requested from 2026-09-01 (PROCESSING on return).
- Native CloudFormation validate-template passed for both minimal deployed-template updates.
- cfn-lint and cfn-guard are not installed; their separate schema/compliance checks were not run.
  Native service validation, CDK assertions, typecheck and exact allowed-property comparisons
  were used. No security-sensitive property was changed.
- Published-view backup does not claim to be a complete offline raw-log export.

- Full infrastructure suite: 18 tests passed; infra typecheck, lint and CDK synth passed.
- Browser acceptance against the retained public site: dashboard, first-round selector URL and
  history page all HTTP 200, final national count visible, zero page JavaScript errors.
  Screenshots and browser report are saved outside Git with the backup evidence.

- Historical tag backfill completed successfully at 2026-10-29 11:38:36 UTC.

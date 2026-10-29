# Post-election archive

Apuração was archived on 2026-10-29. The public site continues to read immutable S3 views.
The recorder stopped at 11:13 UTC and the projector at 11:19 UTC; both containers exited 0.
The projector saved checkpoints/projector/2t-2/000000060888.json.gz at 11:19:13 UTC.

## Preserved data
- Raw signed files, observations, checkpoints and leases remain in apuracao26-raw-860897618882.
- The public bucket, both published rounds, history, timeline, frontend and hosting remain.
- A local backup outside Git holds 272 hash-verified unique views and both manifests under
  ../.portfolio-ops/2026-10-29/apuracao-public, with a SHA-256 manifest.
- Published result views include 85 final records and seven second-round governor records
  marked not_published. These are preserved gaps, not invented zero results.
- This is a published-view backup; it is not an offline copy of every raw bucket version.
  Copy the complete raw history before the Free plan/account expires.

## Infrastructure state
Both RecorderStack and ProjectorStack have DesiredCount 0. Recorder collection alarm actions
are disabled. The changes used reviewed CloudFormation change sets against the deployed
templates, preserving the deployed task definitions and IAM/network settings. No replacements
or removals were included. The existing task definitions are retained for intentional replay
or collection. CDK defaults to recorder=off and projector=off; an explicit opt-in is required.

Local recovery templates, service evidence and snapshot manifests are outside Git under
../.portfolio-ops/2026-10-29/. Keep this directory private because deployed templates can contain
operational configuration. Do not run a broad stack destroy.

## Intentional restart
First inspect cdk diff with the intended contexts, in particular epoch=2t-2, and review task
definition/image differences against the retained deployed definitions. To resume recording,
set -c recorder=on. To resume projection, use -c projector=on -c epoch=2t-2 and the correct
elections context. Start only the component needed. A desired-count-only CloudFormation
update based on the retained before templates can resume the exact deployed revision.
Restore collection alarm actions when resuming live recording. Never promote an old epoch
or overwrite the latest pointer accidentally.

## Budgets
account-total remains an account-wide $80 monthly usage budget.
renewable-pulse-monthly now filters user:Project$renewable-pulse.
transit-pulse-monthly filters user:project$transit-pulse.
Both tag keys were activated and a backfill from 2026-09-01 was requested on 2026-10-29.
Billing attribution is delayed until AWS finishes processing.
apuracao26-credit is a legacy-named, account-wide $100 annual gross-usage guardrail;
it is neither project-only spending nor the remaining credit balance. Its existing alert
recipients and thresholds are preserved. Read actual credit balance with:
aws freetier get-account-plan-state --region us-east-1

The annual budget is intentionally retained alongside account-total. No budget action stops
resources automatically. Inspect the account plan expiry as well as credit consumption.

## Verification and cost follow-up
Read both ECS services and confirm desired/running/pending are 0. Confirm both stacks are
UPDATE_COMPLETE, and disabled recorder alarm actions. Verify final results, first-round
selection, historical page and timeline in a browser. Next billing refresh must be inspected
before claiming measured savings; retained storage, alarms, hosting and small auxiliary costs
continue. The previous October 26–28 average was $5.53/day ($4.79/day in São Paulo).
No paid-plan upgrade or change to other portfolio backends was made.

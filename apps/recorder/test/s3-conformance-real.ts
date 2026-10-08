// Run once against the real raw bucket (TASK-recorder.md §2.4):
//   node apps/recorder/test/s3-conformance-real.ts <bucket>
// Uses the conformance/ prefix; the locked write gets a 1-day governance retention.
import { GetObjectRetentionCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { runS3Conformance } from './s3-conformance.ts';

const bucket = process.argv[2]!;
const s3 = new S3Client({ region: 'sa-east-1' });
const results = await runS3Conformance(s3, bucket, 'conformance');

const key = `conformance/locked-${Date.now()}.txt`;
try {
  const until = new Date(Date.now() + 24 * 3600 * 1000);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'locked', IfNoneMatch: '*', ObjectLockMode: 'GOVERNANCE', ObjectLockRetainUntilDate: until }));
  const r = await s3.send(new GetObjectRetentionCommand({ Bucket: bucket, Key: key }));
  results.push({ step: 'put If-None-Match:* + governance retention → retention set', ok: r.Retention?.Mode === 'GOVERNANCE', detail: `${r.Retention?.Mode} until ${r.Retention?.RetainUntilDate?.toISOString()}` });
} catch (err) {
  results.push({ step: 'put If-None-Match:* + governance retention → retention set', ok: false, detail: (err as Error).message });
}
for (const r of results) console.log(r.ok ? 'PASS' : 'FAIL', r.step, '|', r.detail);
process.exit(results.every((r) => r.ok) ? 0 : 1);

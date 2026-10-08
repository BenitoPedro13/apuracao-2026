// The five S3 behaviours the recorder depends on (TASK-recorder.md §2.4). Shared by the
// conformance test (emulator) and scripts/s3-conformance-real.ts (the real bucket, once).
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

export interface ConformanceResult {
  step: string;
  ok: boolean;
  detail: string;
}

const status = (err: unknown) => (err instanceof S3ServiceException ? err.$metadata.httpStatusCode : undefined);

export async function runS3Conformance(s3: S3Client, bucket: string, prefix: string): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  const key = `${prefix}/conformance-${Date.now()}.txt`;
  const record = (step: string, ok: boolean, detail: string) => results.push({ step, ok, detail });

  // 1. create-if-absent
  let etag: string | undefined;
  try {
    const r = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'one', IfNoneMatch: '*' }));
    etag = r.ETag;
    record('put If-None-Match:* on a new key → 200', true, `etag ${etag}`);
  } catch (err) {
    record('put If-None-Match:* on a new key → 200', false, `${status(err)} ${(err as Error).message}`);
  }

  // 2. create-if-absent again
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'two', IfNoneMatch: '*' }));
    record('put If-None-Match:* on an existing key → 412', false, 'succeeded (overwrote)');
  } catch (err) {
    record('put If-None-Match:* on an existing key → 412', status(err) === 412, `${status(err)}`);
  }

  // 3. compare-and-swap with the current etag
  let etag2: string | undefined;
  try {
    const r = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'three', IfMatch: etag }));
    etag2 = r.ETag;
    record('put If-Match:<current> → 200', true, `etag ${etag2}`);
  } catch (err) {
    record('put If-Match:<current> → 200', false, `${status(err)} ${(err as Error).message}`);
  }

  // 4. compare-and-swap with a stale etag
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'four', IfMatch: etag }));
    record('put If-Match:<stale> → 412', false, 'succeeded (lost update)');
  } catch (err) {
    record('put If-Match:<stale> → 412', status(err) === 412, `${status(err)}`);
  }

  // 5. read back + list
  try {
    const body = await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body?.transformToString();
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const found = listed.Contents?.some((o) => o.Key === key) ?? false;
    record('get + list round trip', body === 'three' && found, `body=${body} listed=${found}`);
  } catch (err) {
    record('get + list round trip', false, `${status(err)} ${(err as Error).message}`);
  }
  return results;
}
